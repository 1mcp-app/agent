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
import type { GatewayFailure, ImmutableJsonValue } from '@src/gateway/contracts/index.js';
import { MODERN_PROTOCOL_REVISION } from '@src/gateway/contracts/protocolEra.js';
import { GatewayDispatcher } from '@src/gateway/core/gatewayDispatcher.js';
import { GatewaySession } from '@src/gateway/core/gatewaySession.js';
import {
  getPresetName,
  getTagExpression,
  getTagFilterMode,
  getTagQuery,
  getValidatedTags,
} from '@src/transport/http/middlewares/scopeAuthMiddleware.js';

import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

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
  return new globalThis.Request(`http://${req.get('host') ?? 'localhost'}${req.originalUrl}`, {
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
  const numericCode = Number(failure.code);
  const fallback =
    failure.kind === 'authorization'
      ? -32_001
      : failure.kind === 'deadline-exceeded'
        ? -32_008
        : failure.kind === 'invalid-request' || failure.kind === 'protocol'
          ? -32_602
          : -32_603;
  return new ProtocolError(Number.isSafeInteger(numericCode) ? numericCode : fallback, failure.message, failure.data);
}

async function dispatchGateway(
  method: 'tools/list' | 'tools/call',
  params: unknown,
  signal: AbortSignal,
  serverManager: ServerManager,
  config: ReturnType<typeof buildConfig>,
  createBridge: ModernInboundBridgeFactory,
  deadlineUnixMs: number,
): Promise<ImmutableJsonValue> {
  const bridge = await createBridge(serverManager, config);
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
    return await new Promise<ImmutableJsonValue>((resolve, reject) => {
      const inbound = new ModernInboundEraAdapter({
        revision: MODERN_PROTOCOL_REVISION,
        receive: async () => {
          if (!delivered) {
            delivered = true;
            return { type: 'request', correlationId, operation: method, params: stripInboundRequestMeta(params) };
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

async function writeWebResponse(response: globalThis.Response, res: Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as never), res);
}

export function setupModernHttpRoutes(
  router: Router,
  serverManager: ServerManager,
  middlewares: RequestHandler[],
  createBridge: ModernInboundBridgeFactory,
  requestPolicy: ModernHttpRequestPolicy,
  requestTimeoutMs = DEFAULT_MODERN_REQUEST_TIMEOUT_MS,
): void {
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
            { capabilities: { tools: {} } },
          );
          server.setRequestHandler(
            'tools/list',
            async (message, context: ServerContext) =>
              (await dispatchGateway(
                'tools/list',
                message.params,
                context.mcpReq.signal,
                serverManager,
                config,
                createBridge,
                Date.now() + requestTimeoutMs,
              )) as never,
          );
          server.setRequestHandler(
            'tools/call',
            async (message, context: ServerContext) =>
              (await dispatchGateway(
                'tools/call',
                message.params,
                context.mcpReq.signal,
                serverManager,
                config,
                createBridge,
                Date.now() + requestTimeoutMs,
              )) as never,
          );
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
