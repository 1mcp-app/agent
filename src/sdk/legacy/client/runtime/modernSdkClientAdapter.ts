import { Client, type NotificationMethod, type RequestMethod } from '@modelcontextprotocol/client';

import { randomUUID } from 'node:crypto';

import { LegacyOutboundEraAdapter } from '@src/gateway/adapters/legacy/legacyOutboundEraAdapter.js';
import { ModernOutboundEraAdapter } from '@src/gateway/adapters/modern/modernOutboundEraAdapter.js';
import { createEffectiveRequestAuthority } from '@src/gateway/contracts/effectiveRequestAuthority.js';
import { toImmutableJsonValue } from '@src/gateway/contracts/immutableJson.js';
import type { OutboundEraAdapter } from '@src/gateway/ports/outboundEraAdapter.js';
import {
  createLegacyTimeoutMs,
  type JsonValue,
  type LegacyConnectionId,
  type LegacyRequestId,
  type LegacySdkAdapter,
  type LegacySdkEvent,
  type LegacySdkLifecycleState,
  type LegacySdkNotification,
  type LegacySdkRequest,
  type LegacySdkResponse,
  OneMcpProtocolError,
  toJsonValue,
} from '@src/sdk/contracts/index.js';

import type { AuthProviderTransport } from './legacyTransport.js';
import { stripInboundRequestMeta } from './outboundRequestParams.js';

const LIST_CHANGED_METHODS = [
  'notifications/tools/list_changed',
  'notifications/resources/list_changed',
  'notifications/prompts/list_changed',
] as const satisfies readonly NotificationMethod[];

interface ModernHandles {
  readonly client: Client;
  transport: AuthProviderTransport;
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
  private closePromise?: Promise<void>;

  constructor(client: Client, transport: AuthProviderTransport) {
    modernHandles.set(this, { client, transport });
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
                readonly operation: 'tools/list' | 'tools/call';
                readonly params?: JsonValue;
                readonly deadlineUnixMs: number;
              };
              return this.requestDirect({
                id: request.requestId as LegacyRequestId,
                method: request.operation,
                ...(request.params === undefined ? {} : { params: request.params }),
                timeoutMs: createLegacyTimeoutMs(Math.max(1, request.deadlineUnixMs - Date.now())),
              });
            },
            cancel: async (requestId) => this.cancelDirect(requestId as LegacyRequestId),
            close: async () => this.closeDirect(),
          })
        : new LegacyOutboundEraAdapter(direct, { era: 'legacy', revision });
  }

  get state(): LegacySdkLifecycleState {
    return this.lifecycleState;
  }

  async start(): Promise<void> {
    if (this.lifecycleState === 'stopped') throw new Error('Modern SDK adapter is stopped');
    this.lifecycleState = 'running';
  }

  nextEvent(): Promise<LegacySdkEvent> {
    const event = this.events.shift();
    return event ? Promise.resolve(event) : new Promise((resolve) => this.waiters.push(resolve));
  }

  async respond(_response: LegacySdkResponse): Promise<void> {
    throw new OneMcpProtocolError(-32_601, 'Outbound modern client does not accept responses');
  }

  async request(request: LegacySdkRequest): Promise<JsonValue> {
    const params = stripInboundRequestMeta(request.params);
    if (request.method !== 'tools/list' && request.method !== 'tools/call') {
      return this.requestDirect({ ...request, params });
    }
    this.gatewayRequests.add(request.id);
    try {
      const timeoutMs = request.timeoutMs ?? createLegacyTimeoutMs(60_000);
      return toJsonValue(
        await this.outbound.request({
          requestId: request.id,
          operation: request.method,
          ...(params === undefined ? {} : { params: toImmutableJsonValue(params) }),
          authority: createEffectiveRequestAuthority({
            connectionIds: [this.connectionId],
            provenance: ['configured-backend'],
          }),
          deadlineUnixMs: Date.now() + timeoutMs,
        }),
      );
    } finally {
      this.gatewayRequests.delete(request.id);
    }
  }

  async cancel(requestId: LegacyRequestId): Promise<void> {
    if (this.gatewayRequests.has(requestId)) return this.outbound.cancel(requestId);
    await this.cancelDirect(requestId);
  }

  async notify(notification: LegacySdkNotification): Promise<void> {
    try {
      await this.handles.client.notification({
        method: notification.method as NotificationMethod,
        ...(notification.params === undefined ? {} : { params: toJsonValue(notification.params) }),
      } as never);
    } catch (error) {
      throw toProtocolError(error);
    }
  }

  registerRequestHandler(schema: unknown, handler: (request: never) => unknown): void {
    const method = this.methodFromLegacySchema(schema) as RequestMethod;
    this.handles.client.setRequestHandler(method, async (request) => handler(request as never) as never);
  }

  registerNotificationHandler(
    schema: unknown,
    handler: (notification: { method: string; params?: Record<string, unknown> }) => unknown,
  ): void {
    const method = this.methodFromLegacySchema(schema) as NotificationMethod;
    this.handles.client.setNotificationHandler(method, async (notification) => {
      await handler(notification);
    });
  }

  close(): Promise<void> {
    return this.outbound.close();
  }

  private async requestDirect(request: LegacySdkRequest): Promise<JsonValue> {
    if (this.lifecycleState === 'stopped' || this.lifecycleState === 'stopping') {
      throw new OneMcpProtocolError(-32_603, 'Modern SDK adapter is closed');
    }
    const controller = new AbortController();
    this.controllers.set(request.id, controller);
    try {
      const result = await this.handles.client.request(
        {
          method: request.method as RequestMethod,
          ...(request.params === undefined ? {} : { params: toJsonValue(request.params) }),
        } as never,
        {
          signal: controller.signal,
          ...(request.timeoutMs === undefined ? {} : { timeout: request.timeoutMs }),
        },
      );
      return toJsonValue(result);
    } catch (error) {
      throw toProtocolError(error);
    } finally {
      this.controllers.delete(request.id);
    }
  }

  private async cancelDirect(requestId: LegacyRequestId): Promise<void> {
    this.controllers.get(requestId)?.abort();
  }

  private closeDirect(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.lifecycleState === 'stopped') return Promise.resolve();
    this.lifecycleState = 'stopping';
    this.closePromise = (async () => {
      for (const controller of this.controllers.values()) controller.abort();
      this.controllers.clear();
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
  modernHandles.get(adapter)!.transport = transport;
}
