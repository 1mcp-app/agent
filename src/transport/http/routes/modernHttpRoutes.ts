import {
  createMcpHandler,
  hostHeaderValidationResponse,
  isLegacyRequest,
  originValidationResponse,
  ProtocolError,
  Server,
  type ServerContext,
} from '@modelcontextprotocol/server';

import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { MCP_SERVER_NAME, MCP_SERVER_VERSION, STREAMABLE_HTTP_ENDPOINT } from '@src/constants.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { ModernInboundEraAdapter } from '@src/gateway/adapters/modern/modernInboundEraAdapter.js';
import { createEffectiveRequestAuthority } from '@src/gateway/contracts/effectiveRequestAuthority.js';
import { type GatewayOperation, gatewayOperationSchema } from '@src/gateway/contracts/gatewayRequest.js';
import { toImmutableJsonValue } from '@src/gateway/contracts/immutableJson.js';
import {
  type GatewayFailure,
  gatewayFailureFromUnknown,
  gatewayFailureToMcp,
  type ImmutableJsonValue,
} from '@src/gateway/contracts/index.js';
import { MODERN_PROTOCOL_REVISION } from '@src/gateway/contracts/protocolEra.js';
import { GatewayDispatcher } from '@src/gateway/core/gatewayDispatcher.js';
import { GatewaySession } from '@src/gateway/core/gatewaySession.js';
import { InteractionBroker } from '@src/gateway/interactions/interactionBroker.js';
import { hasInteractionCapability } from '@src/gateway/interactions/interactionCapabilities.js';
import { withNativeInteractionRound } from '@src/gateway/interactions/interactionRoute.js';
import {
  validateInteractionRequest,
  validateInteractionResponse,
} from '@src/gateway/interactions/validateInteractionResponse.js';
import type { GatewayInteractionRequest } from '@src/gateway/ports/outboundEraAdapter.js';
import {
  getAuthInfo,
  getPresetName,
  getTagExpression,
  getTagFilterMode,
  getTagQuery,
  getValidatedTags,
  revalidateAuthInfo,
} from '@src/transport/http/middlewares/scopeAuthMiddleware.js';

import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import {
  createModernInteractionBinding,
  isModernInteractionBindingCurrent,
  watchModernInteractionBinding,
  withModernInteractionBinding,
} from './modernInteractionBinding.js';

const DEFAULT_MODERN_REQUEST_TIMEOUT_MS = 60_000;

export interface ModernInboundBridge {
  readonly targetConnectionId: string;
  readonly outbound: NonNullable<ReturnType<ConstructorParameters<typeof GatewayDispatcher>[0]['resolveOutbound']>>;
  close(): Promise<void>;
}

export interface ModernHttpRequestPolicy {
  allowsHost(host: string | undefined): boolean;
  allowsOrigin(origin: string | undefined, host: string | undefined): boolean;
}

function buildConfig(req: Request, res: Response) {
  return {
    tags: getValidatedTags(res),
    tagExpression: getTagExpression(res),
    tagFilterMode: getTagFilterMode(res),
    tagQuery: getTagQuery(res),
    presetName: getPresetName(res),
    enablePagination: req.query.pagination === 'true',
  };
}

export type ModernInboundBridgeFactory = (
  serverManager: ServerManager,
  config: ReturnType<typeof buildConfig>,
  options?: {
    capabilities?: ImmutableJsonValue;
    logLevel?: 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';
    interaction?: (input: GatewayInteractionRequest) => Promise<ImmutableJsonValue>;
  },
) => Promise<ModernInboundBridge>;

function isFrameRecord(value: ImmutableJsonValue): value is { readonly [key: string]: ImmutableJsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stripInboundRequestMeta(params: unknown): unknown {
  if (
    params === null ||
    typeof params !== 'object' ||
    Array.isArray(params) ||
    !Object.prototype.hasOwnProperty.call(params, '_meta')
  ) {
    return params;
  }
  const { _meta: _untrustedMeta, ...businessParams } = params as Record<string, unknown>;
  return businessParams;
}

function webRequest(req: Request, signal?: AbortSignal): globalThis.Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  // Admission checks the original Host header; URL construction must not trust it.
  return new globalThis.Request(`http://localhost${req.originalUrl}`, {
    method: req.method,
    headers,
    body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
    signal,
  });
}

async function modernAdmission(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (req.get('mcp-protocol-version') === MODERN_PROTOCOL_REVISION) {
    next();
    return;
  }
  if (await isLegacyRequest(webRequest(req), req.body)) next('route');
  else next();
}

function gatewayFailureError(failure: GatewayFailure): ProtocolError {
  const projected = gatewayFailureToMcp(failure, 'modern');
  return new ProtocolError(projected.code, projected.message, projected.data);
}

let activeModernRequests = 0;
const MAX_ACTIVE_MODERN_REQUESTS = 256;

async function dispatchGateway(
  method: GatewayOperation,
  params: unknown,
  signal: AbortSignal,
  serverManager: ServerManager,
  config: ReturnType<typeof buildConfig>,
  createBridge: ModernInboundBridgeFactory,
  deadlineUnixMs: number,
  interactionOptions?: Parameters<ModernInboundBridgeFactory>[2],
): Promise<ImmutableJsonValue> {
  signal.throwIfAborted();
  const opening = createBridge(serverManager, config, interactionOptions);
  let rejectOpening!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectOpening = reject;
  });
  const abortOpening = () => rejectOpening(new ProtocolError(-32008, 'Gateway request interrupted'));
  signal.addEventListener('abort', abortOpening, { once: true });
  const openingTimer = setTimeout(abortOpening, Math.max(0, deadlineUnixMs - Date.now()));
  openingTimer.unref();
  let bridge: ModernInboundBridge;
  try {
    if (signal.aborted) abortOpening();
    bridge = await Promise.race([opening, interrupted]);
  } catch (error) {
    // A late-created private transport is an orphan, never an operation to retry.
    void opening.then((orphan) => orphan.close()).catch(() => undefined);
    throw gatewayFailureError(gatewayFailureFromUnknown(error));
  } finally {
    clearTimeout(openingTimer);
    signal.removeEventListener('abort', abortOpening);
  }
  const dispatcher = new GatewayDispatcher({
    resolveOutbound: (id) => (id === bridge.targetConnectionId ? bridge.outbound : undefined),
  });
  const session = new GatewaySession(dispatcher);
  const correlationId = randomUUID();
  let delivered = false;
  let cancellationDelivered = false;
  let settle!: (state: 'done' | 'cancel') => void;
  const settled = new Promise<'done' | 'cancel'>((resolve) => {
    settle = resolve;
  });
  const abort = () => settle('cancel');
  signal.addEventListener('abort', abort, { once: true });

  try {
    signal.throwIfAborted();
    return await new Promise<ImmutableJsonValue>((resolve, reject) => {
      const inbound = new ModernInboundEraAdapter({
        revision: MODERN_PROTOCOL_REVISION,
        receive: async () => {
          if (!delivered) {
            delivered = true;
            return {
              type: 'request',
              correlationId,
              operation: method,
              params: stripInboundRequestMeta(params),
            };
          }
          const state = await settled;
          if (state === 'cancel' && !cancellationDelivered) {
            cancellationDelivered = true;
            return { type: 'cancel', correlationId };
          }
          return undefined;
        },
        requestContext: () => ({
          requestId: `modern-${randomUUID()}`,
          targetConnectionId: bridge.targetConnectionId,
          authority: createEffectiveRequestAuthority({
            connectionIds: [bridge.targetConnectionId],
            provenance: ['authenticated-http-admission'],
          }),
          outbound: bridge.outbound.pin,
          deadlineUnixMs,
        }),
        respond: async (frame) => {
          if (isFrameRecord(frame) && frame.type === 'success') resolve(frame.result);
          else if (isFrameRecord(frame) && frame.type === 'failure') {
            reject(gatewayFailureError(frame.failure as unknown as GatewayFailure));
          } else reject(new ProtocolError(-32_603, 'Invalid gateway response'));
          settle('done');
        },
      });
      void session.run(inbound).catch((error: unknown) => {
        reject(
          typeof error === 'object' && error !== null && 'kind' in error
            ? gatewayFailureError(error as GatewayFailure)
            : error,
        );
      });
    });
  } finally {
    settle('done');
    signal.removeEventListener('abort', abort);
    await bridge.close();
  }
}

export function bindDisconnectAbort(req: Request, res: Response): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once('aborted', abort);
  res.once('close', abort);
  req.socket?.once('close', abort);
  let cleaned = false;
  return {
    controller,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      req.removeListener('aborted', abort);
      res.removeListener('close', abort);
      req.socket?.removeListener('close', abort);
    },
  };
}

export async function writeWebResponse(response: globalThis.Response, res: Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) {
    res.end();
    return;
  }
  const source = Readable.fromWeb(response.body as never);
  let sourceFailedWhileConnected = false;
  source.once('error', () => {
    // pipeline destroys the response for source failures too; retain their origin.
    sourceFailedWhileConnected = !res.destroyed;
  });
  try {
    await pipeline(source, res);
  } catch (error) {
    if (
      sourceFailedWhileConnected ||
      !res.destroyed ||
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ERR_STREAM_PREMATURE_CLOSE'
    ) {
      throw error;
    }
  }
}

export function setupModernHttpRoutes(
  router: Router,
  serverManager: ServerManager,
  middlewares: RequestHandler[],
  createBridge: ModernInboundBridgeFactory,
  requestPolicy: ModernHttpRequestPolicy,
  requestTimeoutMs = DEFAULT_MODERN_REQUEST_TIMEOUT_MS,
): void {
  const interactions = new InteractionBroker({
    validate: validateInteractionResponse,
    validateRequest: validateInteractionRequest,
    authorize: () => true,
  });
  serverManager.registerCleanup(() => interactions.close());
  const rejectUnsupportedTransportMethod = async (req: Request, res: Response): Promise<void> => {
    const request = webRequest(req);
    const rejected =
      (!requestPolicy.allowsHost(req.get('host')) ? hostHeaderValidationResponse(request, []) : undefined) ??
      (!requestPolicy.allowsOrigin(req.get('origin'), req.get('host'))
        ? originValidationResponse(request, [])
        : undefined);
    if (rejected) {
      await writeWebResponse(rejected, res);
      return;
    }

    const handler = createMcpHandler(
      () => new Server({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }, { capabilities: { tools: {} } }),
      { legacy: 'reject' },
    );
    try {
      await writeWebResponse(await handler.fetch(request), res);
    } finally {
      await handler.close();
    }
  };

  router.get(STREAMABLE_HTTP_ENDPOINT, modernAdmission, ...middlewares, rejectUnsupportedTransportMethod);
  router.delete(STREAMABLE_HTTP_ENDPOINT, modernAdmission, ...middlewares, rejectUnsupportedTransportMethod);
  router.post(STREAMABLE_HTTP_ENDPOINT, modernAdmission, ...middlewares, async (req: Request, res: Response) => {
    const disconnect = bindDisconnectAbort(req, res);
    try {
      const request = webRequest(req, disconnect.controller.signal);
      const rejected =
        (!requestPolicy.allowsHost(req.get('host')) ? hostHeaderValidationResponse(request, []) : undefined) ??
        (!requestPolicy.allowsOrigin(req.get('origin'), req.get('host'))
          ? originValidationResponse(request, [])
          : undefined);
      if (rejected) {
        await writeWebResponse(rejected, res);
        return;
      }

      const config = buildConfig(req, res);
      const accepted = (req.get('accept') ?? '').split(',').map((value) => value.trim());
      const responseMode =
        accepted.includes('text/event-stream') && !accepted.includes('application/json') ? 'sse' : 'auto';
      const handler = createMcpHandler(
        () => {
          const server = new Server(
            { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
            {
              capabilities: {
                tools: {},
                prompts: {},
                resources: {},
                completions: {},
              },
            },
          );
          for (const operation of gatewayOperationSchema.options) {
            server.setRequestHandler(operation, async (message, context: ServerContext) => {
              if (activeModernRequests >= MAX_ACTIVE_MODERN_REQUESTS) {
                throw new ProtocolError(-32000, 'Gateway request capacity exceeded', {
                  'app.1mcp/failure': {
                    kind: 'transport',
                    code: 'gateway_overloaded',
                  },
                });
              }
              activeModernRequests++;
              try {
                const capabilities =
                  (context.mcpReq.envelope as Record<string, unknown> | undefined)?.[
                    'io.modelcontextprotocol/clientCapabilities'
                  ] ?? {};
                const logLevel = (context.mcpReq.envelope as Record<string, unknown> | undefined)?.[
                  'io.modelcontextprotocol/logLevel'
                ] as NonNullable<Parameters<ModernInboundBridgeFactory>[2]>['logLevel'];
                const binding = await createModernInteractionBinding(
                  serverManager,
                  config,
                  operation,
                  stripInboundRequestMeta(message.params),
                  getAuthInfo(res),
                  capabilities,
                );
                const requestState = context.mcpReq.requestState();
                if (requestState !== undefined) {
                  if (!binding || typeof requestState !== 'string')
                    throw new ProtocolError(-32602, 'Interaction continuation rejected');
                  return (await interactions.resume(
                    requestState,
                    binding,
                    context.mcpReq.inputResponses,
                    context.mcpReq.signal,
                    async () =>
                      JSON.stringify(binding) ===
                        JSON.stringify(
                          await createModernInteractionBinding(
                            serverManager,
                            config,
                            operation,
                            stripInboundRequestMeta(message.params),
                            getAuthInfo(res),
                            capabilities,
                          ),
                        ) &&
                      (await revalidateAuthInfo(getAuthInfo(res))) &&
                      isModernInteractionBindingCurrent(binding),
                  )) as never;
                }
                const deadline = Date.now() + requestTimeoutMs;
                if (binding) {
                  const verifyBinding = async () => {
                    const current = await createModernInteractionBinding(
                      serverManager,
                      config,
                      operation,
                      stripInboundRequestMeta(message.params),
                      getAuthInfo(res),
                      capabilities,
                    );
                    if (JSON.stringify(current) !== JSON.stringify(binding)) {
                      interactions.invalidate(binding);
                      throw new ProtocolError(-32602, 'Interaction route or authority changed');
                    }
                  };
                  return (await interactions.start(
                    binding,
                    deadline,
                    async (interaction, signal, interactionRound) => {
                      const unwatch = watchModernInteractionBinding(binding, () => interactions.invalidate(binding));
                      try {
                        await verifyBinding();
                        return await withModernInteractionBinding(binding, () =>
                          withNativeInteractionRound(
                            async (inputs) => {
                              await verifyBinding();
                              if (
                                !Object.values(inputs).every((input) => hasInteractionCapability(capabilities, input))
                              )
                                throw new ProtocolError(-32021, 'Interaction capability required');
                              return interactionRound(inputs);
                            },
                            () =>
                              dispatchGateway(
                                operation,
                                message.params,
                                signal,
                                serverManager,
                                config,
                                createBridge,
                                deadline,
                                {
                                  capabilities: toImmutableJsonValue(capabilities),
                                  logLevel,
                                  interaction: async (input) => {
                                    await verifyBinding();
                                    if (!hasInteractionCapability(capabilities, input))
                                      throw new ProtocolError(-32021, 'Interaction capability required');
                                    return interaction(input);
                                  },
                                },
                              ),
                          ),
                        );
                      } finally {
                        unwatch();
                      }
                    },
                    context.mcpReq.signal,
                  )) as never;
                }
                return (await dispatchGateway(
                  operation,
                  message.params,
                  context.mcpReq.signal,
                  serverManager,
                  config,
                  createBridge,
                  Date.now() + requestTimeoutMs,
                )) as never;
              } finally {
                activeModernRequests--;
              }
            });
          }
          return server;
        },
        { legacy: 'reject', responseMode },
      );

      try {
        await writeWebResponse(await handler.fetch(request, { parsedBody: req.body }), res);
      } finally {
        await handler.close();
      }
    } finally {
      disconnect.cleanup();
    }
  });
}
