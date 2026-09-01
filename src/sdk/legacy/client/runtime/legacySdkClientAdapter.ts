import { randomUUID } from 'node:crypto';

import type { Client } from '@src/sdk/legacy/client/index.js';
import { StreamableHTTPError } from '@src/sdk/legacy/client/streamableHttp.js';
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
import { ClientStatus, type OutboundConnection } from '@src/core/types/client.js';
import { LoadingState } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import logger from '@src/logger/logger.js';

import type { AuthProviderTransport } from './legacyTransport.js';
import { TransportRecreator } from './transportRecreator.js';

const INTERNAL_ERROR = -32_603;
const POST_AUTH_UNAUTHORIZED_MESSAGE = 'Server returned 401 after successful authentication';

export interface LegacySdkClientAdapterOptions {
  readonly recreateHttpTransport?: (transport: AuthProviderTransport, serverName?: string) => AuthProviderTransport;
}

interface LegacyHandles {
  client: Client;
  transport: AuthProviderTransport;
  connection?: OutboundConnection;
  recovery?: Promise<void>;
  recoveredClient?: Client;
}

const legacyHandles = new WeakMap<LegacySdkClientAdapter, LegacyHandles>();

function toProtocolError(error: unknown): OneMcpProtocolError {
  try {
    return OneMcpProtocolError.fromUnknown(error);
  } catch {
    return new OneMcpProtocolError(INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
  }
}

function isPostAuthUnauthorized(error: unknown): error is StreamableHTTPError {
  return (
    error instanceof StreamableHTTPError &&
    error.code === 401 &&
    error.message.includes(POST_AUTH_UNAUTHORIZED_MESSAGE)
  );
}

function snapshotError(error: unknown): { name: string; message: string } {
  return error instanceof Error ? { name: error.name, message: error.message } : { name: 'Error', message: String(error) };
}

function publishAwaitingOAuth(serverName: string, error: StreamableHTTPError): void {
  try {
    const tracker = McpLoadingManager.current.getStateTracker();
    tracker.registerServer(serverName);
    tracker.updateServerState(serverName, LoadingState.AwaitingOAuth, { error });
  } catch (trackerError) {
    logger.warn(`Failed to publish OAuth recovery state for ${serverName}`, { error: String(trackerError) });
  }
}

/** Concrete boundary around one legacy v1 SDK Client. */
export class LegacySdkClientAdapter implements LegacySdkAdapter {
  readonly connectionId = randomUUID() as LegacyConnectionId;
  private lifecycleState: LegacySdkLifecycleState = 'idle';
  private readonly controllers = new Map<LegacyRequestId, AbortController>();
  private readonly events: LegacySdkEvent[] = [];
  private readonly waiters: Array<(event: LegacySdkEvent) => void> = [];
  private readonly recreateHttpTransport: NonNullable<LegacySdkClientAdapterOptions['recreateHttpTransport']>;

  constructor(client: Client, transport: AuthProviderTransport, options: LegacySdkClientAdapterOptions = {}) {
    legacyHandles.set(this, { client, transport });
    const transportRecreator = new TransportRecreator();
    this.recreateHttpTransport =
      options.recreateHttpTransport ?? ((current, serverName) => transportRecreator.recreateHttpTransport(current, serverName));
    this.registerListChangedNotifications();
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
      const result = await this.requestWithRecovery(request, controller);
      return toJsonValue(result);
    } catch (error) {
      throw toProtocolError(error);
    } finally {
      this.controllers.delete(request.id);
    }
  }

  private async requestWithRecovery(
    request: LegacySdkRequest,
    controller: AbortController,
  ): Promise<unknown> {
    const requestClient = this.handles.client;
    const params = request.params === undefined ? undefined : toJsonValue(request.params);
    try {
      return await requestClient.request(
        { method: request.method, ...(params === undefined ? {} : { params }) } as never,
        ResultSchema,
        { signal: controller.signal, ...(request.timeoutMs === undefined ? {} : { timeout: request.timeoutMs }) },
      );
    } catch (error) {
      if (isPostAuthUnauthorized(error)) {
        await this.recoverPostAuthUnauthorized(requestClient, error);
      }
      throw error;
    }
  }

  private async recoverPostAuthUnauthorized(client: Client, error: StreamableHTTPError): Promise<void> {
    const handles = this.handles;
    if (handles.recoveredClient === client) return;
    if (handles.recovery) return handles.recovery;

    const recovery = this.performPostAuthRecovery(client, error);
    handles.recovery = recovery;
    try {
      await recovery;
    } finally {
      handles.recovery = undefined;
    }
  }

  private async performPostAuthRecovery(staleClient: Client, error: StreamableHTTPError): Promise<void> {
    const handles = this.handles;
    const { transport: staleTransport, connection } = handles;
    const serverName = connection?.name;

    if (connection) {
      connection.status = ClientStatus.AwaitingOAuth;
      connection.authorizationUrl = undefined;
      connection.oauthStartTime = undefined;
      connection.lastError = snapshotError(error);
      publishAwaitingOAuth(connection.name, error);
    }

    try {
      await staleTransport.oauthProvider?.invalidateCredentials('tokens');
    } catch (invalidationError) {
      logger.warn(`Failed to invalidate OAuth credentials for ${serverName ?? 'legacy backend'}`, {
        error: String(invalidationError),
      });
    }

    staleClient.onclose = undefined;
    try {
      await staleClient.close();
    } catch (closeError) {
      logger.warn(`Failed to close unauthorized client ${serverName ?? 'legacy backend'}`, {
        error: String(closeError),
      });
    }

    const freshTransport = this.recreateHttpTransport(staleTransport, serverName);
    handles.transport = freshTransport;
    handles.recoveredClient = staleClient;
    if (connection) {
      connection.tags = [...(freshTransport.tags ?? [])];
      connection.requestTimeoutMs = freshTransport.requestTimeout ?? freshTransport.timeout;
      connection.requiresOAuth = Boolean(freshTransport.oauthProvider);
    }
    logger.warn(`OAuth reauthorization required for ${serverName ?? 'legacy backend'} after authenticated request returned 401`);
  }

  async cancel(requestId: LegacyRequestId): Promise<void> {
    this.controllers.get(requestId)?.abort();
  }

  async notify(notification: LegacySdkNotification): Promise<void> {
    try {
      const params = notification.params === undefined ? undefined : toJsonValue(notification.params);
      await this.handles.client.notification({
        method: notification.method,
        ...(params === undefined ? {} : { params }),
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

  private registerListChangedNotifications(): void {
    this.registerNotification(ToolListChangedNotificationSchema);
    this.registerNotification(ResourceListChangedNotificationSchema);
    this.registerNotification(PromptListChangedNotificationSchema);
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

export function bindLegacySdkConnection(adapter: LegacySdkAdapter, connection: OutboundConnection): void {
  const handles = adapter instanceof LegacySdkClientAdapter ? legacyHandles.get(adapter) : undefined;
  if (!handles) throw new TypeError('Connection is not backed by the legacy v1 client adapter');
  handles.connection = connection;
}
