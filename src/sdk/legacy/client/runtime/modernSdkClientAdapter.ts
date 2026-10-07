import {
  Client,
  MissingRequiredClientCapabilityError,
  type NotificationMethod,
  type RequestMethod,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

import { randomUUID } from 'node:crypto';

import { captureJson } from '@src/core/validation/schemaPolicy.js';
import { LegacyOutboundEraAdapter } from '@src/gateway/adapters/legacy/legacyOutboundEraAdapter.js';
import { ModernOutboundEraAdapter } from '@src/gateway/adapters/modern/modernOutboundEraAdapter.js';
import { createEffectiveRequestAuthority } from '@src/gateway/contracts/effectiveRequestAuthority.js';
import { createGatewayFailure, missingClientCapabilityFailure } from '@src/gateway/contracts/gatewayFailure.js';
import { type GatewayOperation, gatewayOperationSchema } from '@src/gateway/contracts/gatewayRequest.js';
import { toImmutableJsonValue } from '@src/gateway/contracts/immutableJson.js';
import { hasInteractionCapability } from '@src/gateway/interactions/interactionCapabilities.js';
import { assertInteractionRoute, currentNativeInteractionRound } from '@src/gateway/interactions/interactionRoute.js';
import { takeNativeInitialInputResponses } from '@src/gateway/interactions/nativeInputResponses.js';
import {
  validateInteractionRequest,
  validateInteractionResponse,
} from '@src/gateway/interactions/validateInteractionResponse.js';
import type { OutboundEraAdapter } from '@src/gateway/ports/outboundEraAdapter.js';
import { injectTraceContext, stripBaggage } from '@src/observability/tracing/context.js';
import { reportCatalogCoverageLoss } from '@src/sdk/contracts/catalogCoverageInvalidation.js';
import {
  createLegacyTimeoutMs,
  JSON_VALUE_LIMITS,
  type JsonValue,
  type JsonValueCost,
  type LegacyConnectionId,
  type LegacyRequestId,
  type LegacySdkAdapter,
  type LegacySdkEvent,
  type LegacySdkLifecycleState,
  type LegacySdkNotification,
  type LegacySdkRequest,
  type LegacySdkResponse,
  measureJsonValue,
  OneMcpProtocolError,
  toJsonValue,
} from '@src/sdk/contracts/index.js';
import { currentRequestProgress } from '@src/sdk/contracts/requestProgress.js';
import { captureCapabilityListResult } from '@src/sdk/legacy/shared/capabilityListCapture.js';

import { z } from 'zod';

import { observeBackendDispatchLifetime } from './backendDispatchLifetime.js';
import {
  assertCurrentLegacyInteraction,
  beginLegacyInteractionRequest,
  currentLegacyInteractionCapabilities,
  currentLegacyInteractionLogLevel,
  currentLegacyInteractionSignal,
} from './legacyInteractionLease.js';
import type { AuthProviderTransport } from './legacyTransport.js';
import { createMcpParamHeaders, type McpParamDeclaration, scanMcpParamDeclarations } from './mcpParamHeaders.js';
import {
  closeModernSubscriptions,
  type ModernSubscriptionFilter,
  type ModernSubscriptionHandle,
  type ModernSubscriptionNotification,
  openModernSubscription,
  rebindModernSubscriptionTransport,
  registerModernSubscriptions,
} from './modernSubscriptions.js';
import { stripInboundRequestMeta } from './outboundRequestParams.js';

const LIST_CHANGED_METHODS = [
  'notifications/tools/list_changed',
  'notifications/resources/list_changed',
  'notifications/prompts/list_changed',
] as const satisfies readonly NotificationMethod[];

// Catalog capture validates each source object independently, preserving healthy siblings.
const capabilityListResultSchema = z.looseObject({});
const capabilityListMethods = new Set(['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list']);

interface ModernHandles {
  readonly client: Client;
  transport: AuthProviderTransport;
  readonly clearToolHeaders: () => void;
}

const modernHandles = new WeakMap<ModernSdkClientAdapter, ModernHandles>();

function toProtocolError(error: unknown): OneMcpProtocolError {
  try {
    return OneMcpProtocolError.fromUnknown(error);
  } catch {
    return new OneMcpProtocolError(-32_603, error instanceof Error ? error.message : String(error));
  }
}

/** Plain-data compatibility boundary around one v2 Client and its negotiated era. */
export class ModernSdkClientAdapter implements LegacySdkAdapter {
  readonly connectionId = randomUUID() as LegacyConnectionId;
  private lifecycleState: LegacySdkLifecycleState = 'running';
  private readonly controllers = new Map<LegacyRequestId, AbortController>();
  private readonly events: LegacySdkEvent[] = [];
  private readonly waiters: Array<(event: LegacySdkEvent) => void> = [];
  private readonly gatewayRequests = new Set<LegacyRequestId>();
  private readonly outbound: OutboundEraAdapter;
  private readonly interactionHandlers = new Map<string, (request: never) => unknown>();
  private closePromise?: Promise<void>;
  private catalogSubscription?: Promise<ModernSubscriptionHandle>;
  private catalogCoverageLost = false;
  private readonly resourceSubscriptions = new Map<string, Promise<ModernSubscriptionHandle>>();
  private readonly subscriptionHandlers = new Map<string, (notification: ModernSubscriptionNotification) => unknown>();
  private readonly toolHeaders = new Map<
    string,
    { readonly declarations: readonly McpParamDeclaration[]; readonly cost: JsonValueCost }
  >();
  private readonly toolHeaderCursors = new Map<string, number>();
  private toolHeaderEpoch = 0;

  constructor(client: Client, transport: AuthProviderTransport) {
    modernHandles.set(this, { client, transport, clearToolHeaders: () => this.clearToolHeaders() });
    this.registerListChangedNotifications();

    const revision = client.getNegotiatedProtocolVersion() ?? '2025-11-25';
    const direct = this.createDirectAdapter();
    this.outbound =
      client.getProtocolEra() === 'modern'
        ? new ModernOutboundEraAdapter({
            revision,
            request: async (frame) => {
              const request = frame as {
                readonly requestId: string;
                readonly cancellationId?: string;
                readonly operation: GatewayOperation;
                readonly params?: JsonValue;
                readonly deadlineUnixMs: number;
                readonly inputResponses?: Record<string, unknown>;
                readonly requestState?: string;
              };
              return this.requestDirect(
                {
                  id: (request.cancellationId ?? request.requestId) as LegacyRequestId,
                  method: request.operation,
                  ...(request.params === undefined ? {} : { params: request.params }),
                  timeoutMs: createLegacyTimeoutMs(Math.max(1, request.deadlineUnixMs - Date.now())),
                },
                {
                  inputResponses: request.inputResponses,
                  requestState: request.requestState,
                },
              );
            },
            cancel: async (requestId) => this.cancelDirect(requestId as LegacyRequestId),
            close: async () => this.closeDirect(),
          })
        : new LegacyOutboundEraAdapter(direct, { era: 'legacy', revision });
    if (this.protocol.era === 'modern' && typeof transport.send === 'function') {
      registerModernSubscriptions(this, client, transport, async (filter) => {
        const accepted = (await this.ensureCatalogSubscription()).honoredFilter;
        return {
          ...(filter.toolsListChanged && accepted.toolsListChanged ? { toolsListChanged: true } : {}),
          ...(filter.promptsListChanged && accepted.promptsListChanged ? { promptsListChanged: true } : {}),
          ...(filter.resourcesListChanged && accepted.resourcesListChanged ? { resourcesListChanged: true } : {}),
        };
      });
    }
  }

  get protocolRevision(): string {
    return this.outbound.pin.revision;
  }

  get state(): LegacySdkLifecycleState {
    return this.lifecycleState;
  }

  get protocol() {
    return this.outbound.pin;
  }

  async start(): Promise<void> {
    if (this.lifecycleState === 'stopped') throw new Error('Modern SDK adapter is stopped');
    this.lifecycleState = 'running';
    if (this.protocol.era === 'modern') await this.ensureCatalogSubscription();
  }

  nextEvent(): Promise<LegacySdkEvent> {
    const event = this.events.shift();
    return event ? Promise.resolve(event) : new Promise((resolve) => this.waiters.push(resolve));
  }

  async respond(_response: LegacySdkResponse): Promise<void> {
    throw new OneMcpProtocolError(-32_601, 'Outbound modern client does not accept responses');
  }

  async request(request: LegacySdkRequest): Promise<JsonValue> {
    assertInteractionRoute(this, request.method, request.params);
    const params = stripInboundRequestMeta(request.params);
    if (this.protocol.era === 'modern' && ['resources/subscribe', 'resources/unsubscribe'].includes(request.method)) {
      return this.resourceSubscription(request, params);
    }
    const operation = gatewayOperationSchema.safeParse(request.method);
    if (!operation.success) {
      return this.requestDirect({ ...request, params });
    }
    if (this.gatewayRequests.has(request.id))
      throw createGatewayFailure({
        kind: 'invalid-request',
        code: 'modern_outbound_duplicate_request',
        message: 'The outbound request id is already active',
      });
    const release = beginLegacyInteractionRequest(this, request.method);
    const interactionHandlers = new Map(this.interactionHandlers);
    this.gatewayRequests.add(request.id);
    try {
      const timeoutMs = request.timeoutMs ?? createLegacyTimeoutMs(60_000);
      const nativeRound = currentNativeInteractionRound();
      const initialInputResponses =
        this.protocol.era === 'modern' ? takeNativeInitialInputResponses(this, request.method, params) : undefined;
      return toJsonValue(
        await this.outbound.request(
          {
            requestId: request.id,
            operation: operation.data,
            ...(params === undefined ? {} : { params: toImmutableJsonValue(params) }),
            authority: createEffectiveRequestAuthority({
              connectionIds: [this.connectionId],
              provenance: ['configured-backend'],
            }),
            deadlineUnixMs: Date.now() + timeoutMs,
          },
          {
            ...(initialInputResponses === undefined ? {} : { initialInputResponses }),
            interactionRound: nativeRound
              ? async (inputs) => {
                  if (
                    !Object.values(inputs).every((input) =>
                      hasInteractionCapability(currentLegacyInteractionCapabilities(), input),
                    )
                  ) {
                    throw new OneMcpProtocolError(-32021, 'Interaction capability required');
                  }
                  return nativeRound(inputs);
                }
              : undefined,
            interaction: async (input) => {
              if (!hasInteractionCapability(currentLegacyInteractionCapabilities(), input))
                throw new OneMcpProtocolError(-32021, 'Interaction capability required');
              const handler = interactionHandlers.get(input.method);
              if (!handler) throw new OneMcpProtocolError(-32021, 'Interaction capability required');
              const binding = {
                principal: 'request-scoped-provider',
                request: request.id,
                route: this.connectionId,
                generation: this.connectionId,
                inbound: 'legacy',
                outbound: 'modern',
              };
              await validateInteractionRequest(input, binding, currentLegacyInteractionSignal());
              currentLegacyInteractionSignal()?.throwIfAborted();
              const response = toImmutableJsonValue(await handler(input as never));
              await validateInteractionResponse(input, response, binding, currentLegacyInteractionSignal());
              currentLegacyInteractionSignal()?.throwIfAborted();
              if (!hasInteractionCapability(currentLegacyInteractionCapabilities(), input))
                throw new OneMcpProtocolError(-32021, 'Interaction capability required');
              return response;
            },
          },
        ),
      );
    } finally {
      this.gatewayRequests.delete(request.id);
      release();
    }
  }

  async cancel(requestId: LegacyRequestId): Promise<void> {
    if (this.gatewayRequests.has(requestId)) return this.outbound.cancel(requestId);
    await this.cancelDirect(requestId);
  }

  async notify(notification: LegacySdkNotification): Promise<void> {
    try {
      const params = stripInboundRequestMeta(notification.params);
      await this.handles.client.notification({
        method: notification.method as NotificationMethod,
        ...(params === undefined ? {} : { params: toJsonValue(params) }),
      } as never);
    } catch (error) {
      throw toProtocolError(error);
    }
  }

  registerRequestHandler(schema: unknown, handler: (request: never) => unknown): void {
    const method = this.methodFromLegacySchema(schema) as RequestMethod;
    // Modern inputs are driven by our request-local MRTR loop, not SDK reverse handlers.
    if (this.protocol.era === 'legacy') {
      this.handles.client.setRequestHandler(method, async (request) => handler(request as never) as never);
    }
    this.interactionHandlers.set(method, handler);
  }

  registerNotificationHandler(
    schema: unknown,
    handler: (notification: { method: string; params?: Record<string, unknown> }) => unknown,
  ): void {
    const method = this.methodFromLegacySchema(schema) as NotificationMethod;
    this.subscriptionHandlers.set(method, handler);
    if (method === 'notifications/progress' || method === ('notifications/1mcp/subscription_lost' as string)) return;
    this.handles.client.setNotificationHandler(method, async (notification) => {
      if (method === 'notifications/tools/list_changed') this.clearToolHeaders();
      if (
        this.protocol.era === 'modern' &&
        notification.params?._meta?.['io.modelcontextprotocol/subscriptionId'] !== undefined
      )
        return;
      await handler(notification);
    });
  }

  close(): Promise<void> {
    return this.outbound.close();
  }

  private async requestDirect(
    request: LegacySdkRequest,
    continuation?: {
      inputResponses?: Record<string, unknown>;
      requestState?: string;
    },
  ): Promise<JsonValue> {
    if (this.lifecycleState === 'stopped' || this.lifecycleState === 'stopping') {
      throw new OneMcpProtocolError(-32_603, 'Modern SDK adapter is closed');
    }
    const mirrorsHeaders =
      this.protocol.era === 'modern' && this.handles.transport instanceof StreamableHTTPClientTransport;
    const headers =
      mirrorsHeaders && request.method === 'tools/call' ? this.toolCallHeaders(request.params) : undefined;
    const controller = new AbortController();
    const ownerSignal = currentLegacyInteractionSignal();
    const abort = () => controller.abort();
    ownerSignal?.addEventListener('abort', abort, { once: true });
    if (ownerSignal?.aborted) abort();
    this.controllers.set(request.id, controller);
    let headerEpoch: number | undefined = this.toolHeaderEpoch;
    if (mirrorsHeaders && request.method === 'tools/list') {
      const params = request.params;
      const cursor =
        params !== null && typeof params === 'object' && !Array.isArray(params) ? params.cursor : undefined;
      if (cursor === undefined) {
        this.clearToolHeaders();
        headerEpoch = this.toolHeaderEpoch;
      } else {
        headerEpoch = typeof cursor === 'string' ? this.toolHeaderCursors.get(cursor) : undefined;
      }
    }
    try {
      controller.signal.throwIfAborted();
      const logLevel = currentLegacyInteractionLogLevel();
      const message: { method: RequestMethod; params?: unknown } = {
        method: request.method as RequestMethod,
      };
      if (continuation?.inputResponses !== undefined || continuation?.requestState !== undefined) {
        message.params = {
          ...((request.params as Record<string, unknown>) ?? {}),
          ...(continuation.inputResponses === undefined ? {} : { inputResponses: continuation.inputResponses }),
          ...(continuation.requestState === undefined ? {} : { requestState: continuation.requestState }),
        };
      } else if (request.params !== undefined) {
        message.params = toJsonValue(request.params);
      }
      if (
        this.protocol.era === 'modern' &&
        (logLevel || ['tools/call', 'prompts/get', 'resources/read'].includes(request.method))
      ) {
        message.params = {
          ...((message.params as Record<string, unknown>) ?? {}),
          _meta: {
            'io.modelcontextprotocol/clientCapabilities': currentLegacyInteractionCapabilities() ?? {},
            ...(logLevel === undefined ? {} : { 'io.modelcontextprotocol/logLevel': logLevel }),
          },
        };
      }
      message.params = injectTraceContext(message.params);
      assertCurrentLegacyInteraction();
      controller.signal.throwIfAborted();
      observeBackendDispatchLifetime(this.handles.transport);
      const options = {
        signal: controller.signal,
        allowInputRequired: true,
        onprogress: currentRequestProgress(),
        ...(request.timeoutMs === undefined ? {} : { timeout: request.timeoutMs }),
        ...(headers === undefined ? {} : { headers }),
      };
      const result = capabilityListMethods.has(request.method)
        ? await this.handles.client.request(message as never, capabilityListResultSchema, options)
        : await this.handles.client.request(message as never, options);
      // The SDK has decoded the modern MRTR variant; complete Tool validation belongs after the broker's loop.
      if (
        this.protocol.era === 'modern' &&
        ['tools/call', 'prompts/get', 'resources/read'].includes(request.method) &&
        result &&
        typeof result === 'object' &&
        'resultType' in result &&
        result.resultType === 'input_required'
      ) {
        return toJsonValue(captureJson(result, false, true).value);
      }
      const captured = captureCapabilityListResult(request.method, result);
      if (mirrorsHeaders && request.method === 'tools/list') this.captureToolHeaderPage(captured, headerEpoch);
      return stripBaggage(captured);
    } catch (error) {
      if (error instanceof MissingRequiredClientCapabilityError) {
        const failure = missingClientCapabilityFailure(error.requiredCapabilities);
        if (failure) throw failure;
      }
      throw toProtocolError(error);
    } finally {
      this.controllers.delete(request.id);
      ownerSignal?.removeEventListener('abort', abort);
    }
  }

  private clearToolHeaders(): void {
    this.toolHeaderEpoch++;
    this.toolHeaders.clear();
    this.toolHeaderCursors.clear();
  }

  private toolCallHeaders(params: JsonValue | undefined): Readonly<Record<string, string>> {
    if (params === null || typeof params !== 'object' || Array.isArray(params)) return {};
    if (typeof params.name !== 'string') return {};
    return createMcpParamHeaders(this.toolHeaders.get(params.name)?.declarations ?? [], params.arguments);
  }

  private captureToolHeaderPage(result: JsonValue, epoch: number | undefined): void {
    if (result === null || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.tools)) return;
    const current = epoch === this.toolHeaderEpoch && this.lifecycleState === 'running';
    const headers = new Map(this.toolHeaders);
    result.tools = result.tools.filter((tool) => {
      if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) return true;
      if (typeof tool.name !== 'string' || tool.inputSchema === undefined) return true;
      const scan = scanMcpParamDeclarations(tool.inputSchema);
      headers.delete(tool.name);
      if (!scan.valid) return false;
      if (scan.declarations.length) {
        headers.set(tool.name, {
          declarations: scan.declarations,
          cost: measureJsonValue({ name: tool.name, inputSchema: tool.inputSchema }, JSON_VALUE_LIMITS),
        });
      }
      return true;
    });
    if (!current) return;
    const cursors = new Map(this.toolHeaderCursors);
    if (typeof result.nextCursor === 'string') cursors.set(result.nextCursor, this.toolHeaderEpoch);
    const cursorCost = [...cursors.keys()].reduce(
      (total, cursor) => ({ nodes: total.nodes + 1, stringLength: total.stringLength + cursor.length }),
      { nodes: 0, stringLength: 0 },
    );
    const costs = [...headers.values()].reduce(
      (total, item) => ({
        nodes: total.nodes + item.cost.nodes,
        stringLength: total.stringLength + item.cost.stringLength,
      }),
      cursorCost,
    );
    if (costs.nodes > JSON_VALUE_LIMITS.maxNodes || costs.stringLength > JSON_VALUE_LIMITS.maxTotalStringLength)
      throw new OneMcpProtocolError(-32603, 'Tool header catalog exceeds the JSON budget');
    this.toolHeaders.clear();
    for (const [name, declarations] of headers) this.toolHeaders.set(name, declarations);
    this.toolHeaderCursors.clear();
    for (const [cursor, origin] of cursors) this.toolHeaderCursors.set(cursor, origin);
  }

  private async cancelDirect(requestId: LegacyRequestId): Promise<void> {
    this.controllers.get(requestId)?.abort();
  }

  private closeDirect(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.lifecycleState === 'stopped') return Promise.resolve();
    this.lifecycleState = 'stopping';
    this.clearToolHeaders();
    this.closePromise = (async () => {
      for (const controller of this.controllers.values()) controller.abort();
      this.controllers.clear();
      closeModernSubscriptions(this);
      const subscriptions = [...this.resourceSubscriptions.values()];
      if (this.catalogSubscription) subscriptions.push(this.catalogSubscription);
      this.resourceSubscriptions.clear();
      await Promise.allSettled(subscriptions.map(async (pending) => (await pending).close()));
      try {
        await this.handles.client.close();
      } catch (error) {
        throw toProtocolError(error);
      } finally {
        this.lifecycleState = 'stopped';
        this.publish({ type: 'closed' });
      }
    })();
    return this.closePromise;
  }

  private createDirectAdapter(): LegacySdkAdapter {
    const owner = this;
    return {
      connectionId: this.connectionId,
      get state() {
        return owner.state;
      },
      start: () => owner.start(),
      nextEvent: () => owner.nextEvent(),
      respond: (response) => owner.respond(response),
      request: (request) => owner.requestDirect(request),
      cancel: (requestId) => owner.cancelDirect(requestId),
      notify: (notification) => owner.notify(notification),
      close: () => owner.closeDirect(),
    };
  }

  private registerListChangedNotifications(): void {
    for (const method of LIST_CHANGED_METHODS) {
      this.handles.client.setNotificationHandler(method, async (notification) => {
        if (method === 'notifications/tools/list_changed') this.clearToolHeaders();
        if (this.protocol.era === 'modern') return;
        this.publish({
          type: 'notification',
          notification: {
            method,
            ...(notification.params === undefined ? {} : { params: toJsonValue(notification.params) }),
          },
        });
      });
    }
  }

  private ensureCatalogSubscription(): Promise<ModernSubscriptionHandle> {
    if (this.lifecycleState !== 'running')
      return Promise.reject(new OneMcpProtocolError(-32603, 'Modern SDK adapter is closed'));
    if (this.catalogSubscription) return this.catalogSubscription;
    const caps = this.handles.client.getServerCapabilities();
    const filter: ModernSubscriptionFilter = {
      ...(caps?.tools?.listChanged ? { toolsListChanged: true } : {}),
      ...(caps?.prompts?.listChanged ? { promptsListChanged: true } : {}),
      ...(caps?.resources?.listChanged ? { resourcesListChanged: true } : {}),
    };
    if (Object.keys(filter).length === 0) return Promise.resolve({ honoredFilter: {}, close: async () => {} });
    this.catalogCoverageLost = false;
    this.catalogSubscription = openModernSubscription(
      this,
      filter,
      (note) => this.deliverSubscription(note),
      () => {
        this.catalogSubscription = undefined;
        this.deliverSubscription({ method: 'notifications/1mcp/subscription_lost', params: { catalog: true } });
      },
    );
    void this.catalogSubscription.catch(() => {
      this.catalogSubscription = undefined;
    });
    return this.catalogSubscription;
  }

  private deliverSubscription(note: ModernSubscriptionNotification): void {
    if (note.method === 'notifications/tools/list_changed') this.clearToolHeaders();
    if (note.method === 'notifications/1mcp/subscription_lost' && note.params?.catalog === true) {
      this.clearToolHeaders();
      // This notice is emitted by an owned subscription closure/overflow, never
      // accepted as a public upstream notification. Invalidate before callbacks.
      reportCatalogCoverageLoss(this);
    }
    const handler = this.subscriptionHandlers.get(note.method);
    if (handler) {
      void Promise.resolve(handler(note)).catch(() => {});
      return;
    }
    if (LIST_CHANGED_METHODS.some((method) => method === note.method)) {
      if (this.catalogCoverageLost) return;
      const queued = this.events.filter(
        (event) =>
          event.type === 'notification' && LIST_CHANGED_METHODS.some((method) => method === event.notification.method),
      );
      const queuedBytes = queued.reduce((bytes, event) => bytes + Buffer.byteLength(JSON.stringify(event)), 0);
      if (
        !this.waiters.length &&
        (queued.length >= 64 || queuedBytes + Buffer.byteLength(JSON.stringify(note)) > 1024 * 1024)
      ) {
        const subscription = this.catalogSubscription;
        this.catalogSubscription = undefined;
        this.catalogCoverageLost = true;
        for (let index = this.events.length - 1; index >= 0; index--) {
          const event = this.events[index];
          if (
            event.type === 'notification' &&
            LIST_CHANGED_METHODS.some((method) => method === event.notification.method)
          )
            this.events.splice(index, 1);
        }
        void subscription?.then((handle) => handle.close()).catch(() => {});
        this.deliverSubscription({ method: 'notifications/1mcp/subscription_lost', params: { catalog: true } });
        return;
      }
    }
    if (note.method === 'notifications/1mcp/subscription_lost' && note.params?.catalog === true) {
      if (this.events.some((event) => event.type === 'notification' && event.notification.method === note.method))
        return;
    }
    this.publish({
      type: 'notification',
      notification: { method: note.method, ...(note.params ? { params: toJsonValue(note.params) } : {}) },
    });
  }

  private async resourceSubscription(request: LegacySdkRequest, params: JsonValue | undefined): Promise<JsonValue> {
    const { uri } = z.object({ uri: z.string().max(8192) }).parse(params);
    const existing = this.resourceSubscriptions.get(uri);
    if (request.method === 'resources/unsubscribe') {
      this.resourceSubscriptions.delete(uri);
      if (existing) await (await existing).close();
      return {};
    }
    if (existing) {
      await existing;
      return {};
    }
    const controller = new AbortController();
    const signal = currentLegacyInteractionSignal();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    this.controllers.set(request.id, controller);
    let pending: Promise<ModernSubscriptionHandle>;
    pending = openModernSubscription(
      this,
      { resourceSubscriptions: [uri] },
      (note) => this.deliverSubscription(note),
      () => {
        if (this.resourceSubscriptions.get(uri) === pending) this.resourceSubscriptions.delete(uri);
        this.deliverSubscription({ method: 'notifications/1mcp/subscription_lost', params: { uri } });
      },
      controller.signal,
    ).then(async (handle) => {
      if (!handle.honoredFilter.resourceSubscriptions?.includes(uri)) {
        await handle.close();
        throw new OneMcpProtocolError(-32602, 'Upstream did not accept the resource subscription');
      }
      return handle;
    });
    this.resourceSubscriptions.set(uri, pending);
    try {
      await pending;
      return {};
    } catch (error) {
      if (this.resourceSubscriptions.get(uri) === pending) this.resourceSubscriptions.delete(uri);
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      this.controllers.delete(request.id);
    }
  }

  private methodFromLegacySchema(schema: unknown): string {
    const method = (schema as { shape?: { method?: { value?: unknown } } }).shape?.method?.value;
    if (typeof method !== 'string') throw new TypeError('Legacy request schema does not declare a literal method');
    return method;
  }

  private publish(event: LegacySdkEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(event);
    else this.events.push(event);
  }

  private get handles(): ModernHandles {
    return modernHandles.get(this)!;
  }
}

export function getModernSdkClient(adapter: ModernSdkClientAdapter): Client {
  return modernHandles.get(adapter)!.client;
}

export function getModernSdkTransport(adapter: ModernSdkClientAdapter): AuthProviderTransport {
  return modernHandles.get(adapter)!.transport;
}

export function setModernSdkTransport(adapter: ModernSdkClientAdapter, transport: AuthProviderTransport): void {
  modernHandles.get(adapter)!.clearToolHeaders();
  modernHandles.get(adapter)!.transport = transport;
  rebindModernSubscriptionTransport(adapter, transport);
}
