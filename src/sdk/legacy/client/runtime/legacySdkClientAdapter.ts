import { randomUUID } from 'node:crypto';

import type { Client } from '@src/sdk/legacy/client/index.js';
import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResultSchema,
  ToolListChangedNotificationSchema,
} from '@src/sdk/legacy/types.js';

import {
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

const INTERNAL_ERROR = -32_603;
const legacyHandles = new WeakMap<LegacySdkClientAdapter, { client: Client; transport: AuthProviderTransport }>();

function toProtocolError(error: unknown): OneMcpProtocolError {
  try {
    return OneMcpProtocolError.fromUnknown(error);
  } catch {
    return new OneMcpProtocolError(INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
  }
}

/** Concrete boundary around one legacy v1 SDK Client. */
export class LegacySdkClientAdapter implements LegacySdkAdapter {
  readonly connectionId = randomUUID() as LegacyConnectionId;
  private lifecycleState: LegacySdkLifecycleState = 'idle';
  private readonly controllers = new Map<LegacyRequestId, AbortController>();
  private readonly events: LegacySdkEvent[] = [];
  private readonly waiters: Array<(event: LegacySdkEvent) => void> = [];

  constructor(client: Client, transport: AuthProviderTransport) {
    legacyHandles.set(this, { client, transport });
    this.registerNotification(ToolListChangedNotificationSchema);
    this.registerNotification(ResourceListChangedNotificationSchema);
    this.registerNotification(PromptListChangedNotificationSchema);
  }

  get state(): LegacySdkLifecycleState {
    return this.lifecycleState;
  }

  async start(): Promise<void> {
    if (this.lifecycleState === 'stopped') throw new Error('Legacy SDK adapter is stopped');
    this.lifecycleState = 'running';
  }

  nextEvent(): Promise<LegacySdkEvent> {
    const event = this.events.shift();
    return event ? Promise.resolve(event) : new Promise((resolve) => this.waiters.push(resolve));
  }

  async respond(_response: LegacySdkResponse): Promise<void> {
    throw new OneMcpProtocolError(-32_601, 'Outbound legacy client does not accept responses');
  }

  async request(request: LegacySdkRequest): Promise<JsonValue> {
    if (this.lifecycleState === 'stopped' || this.lifecycleState === 'stopping') {
      throw new OneMcpProtocolError(INTERNAL_ERROR, 'Legacy SDK adapter is closed');
    }
    const controller = new AbortController();
    this.controllers.set(request.id, controller);
    try {
      if (this.lifecycleState === 'idle') await this.start();
      const result = await this.handles.client.request(
        { method: request.method, ...(request.params === undefined ? {} : { params: request.params }) } as never,
        ResultSchema,
        { signal: controller.signal, ...(request.timeoutMs === undefined ? {} : { timeout: request.timeoutMs }) },
      );
      return toJsonValue(result);
    } catch (error) {
      throw toProtocolError(error);
    } finally {
      this.controllers.delete(request.id);
    }
  }

  async cancel(requestId: LegacyRequestId): Promise<void> {
    this.controllers.get(requestId)?.abort();
  }

  async notify(notification: LegacySdkNotification): Promise<void> {
    try {
      await this.handles.client.notification({
        method: notification.method,
        ...(notification.params === undefined ? {} : { params: notification.params }),
      } as never);
    } catch (error) {
      throw toProtocolError(error);
    }
  }

  async close(): Promise<void> {
    if (this.lifecycleState === 'stopped') return;
    this.lifecycleState = 'stopping';
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
  }

  private registerNotification(schema: unknown): void {
    this.handles.client.setNotificationHandler(schema as never, async (notification: { method: string; params?: unknown }) => {
      this.publish({
        type: 'notification',
        notification: {
          method: notification.method,
          ...(notification.params === undefined ? {} : { params: toJsonValue(notification.params) }),
        },
      });
    });
  }

  private publish(event: LegacySdkEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(event);
    else this.events.push(event);
  }

  private get handles() {
    return legacyHandles.get(this)!;
  }
}

export function getLegacySdkClient(adapter: LegacySdkAdapter): Client {
  const handles = adapter instanceof LegacySdkClientAdapter ? legacyHandles.get(adapter) : undefined;
  if (!handles) throw new TypeError('Connection is not backed by the legacy v1 client adapter');
  return handles.client;
}

export function getLegacySdkTransport(adapter: LegacySdkAdapter): AuthProviderTransport {
  const handles = adapter instanceof LegacySdkClientAdapter ? legacyHandles.get(adapter) : undefined;
  if (!handles) throw new TypeError('Connection is not backed by the legacy v1 client adapter');
  return handles.transport;
}

export function setLegacySdkTransport(adapter: LegacySdkAdapter, transport: AuthProviderTransport): void {
  const handles = adapter instanceof LegacySdkClientAdapter ? legacyHandles.get(adapter) : undefined;
  if (!handles) throw new TypeError('Connection is not backed by the legacy v1 client adapter');
  handles.transport = transport;
}
