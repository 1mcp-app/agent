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
import logger from '@src/logger/logger.js';

import { ClientFactory } from './clientFactory.js';
import type { AuthProviderTransport } from './legacyTransport.js';
import { TransportRecreator } from './transportRecreator.js';

const INTERNAL_ERROR = -32_603;
const POST_AUTH_UNAUTHORIZED_MESSAGE = 'Server returned 401 after successful authentication';

interface LegacySdkClientAdapterOptions {
  readonly createClient?: () => Client;
  readonly recreateHttpTransport?: (transport: AuthProviderTransport, serverName?: string) => AuthProviderTransport;
}

interface LegacyHandles {
  client: Client;
  transport: AuthProviderTransport;
  connection?: OutboundConnection;
  recovery?: Promise<void>;
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

/** Concrete boundary around one legacy v1 SDK Client. */
export class LegacySdkClientAdapter implements LegacySdkAdapter {
  readonly connectionId = randomUUID() as LegacyConnectionId;
  private lifecycleState: LegacySdkLifecycleState = 'idle';
  private readonly controllers = new Map<LegacyRequestId, AbortController>();
  private readonly events: LegacySdkEvent[] = [];
  private readonly waiters: Array<(event: LegacySdkEvent) => void> = [];
  private readonly createClient: () => Client;
  private readonly recreateHttpTransport: NonNullable<LegacySdkClientAdapterOptions['recreateHttpTransport']>;

  constructor(client: Client, transport: AuthProviderTransport, options: LegacySdkClientAdapterOptions = {}) {
    legacyHandles.set(this, { client, transport });
    const clientFactory = new ClientFactory();
    const transportRecreator = new TransportRecreator();
    this.createClient = options.createClient ?? (() => clientFactory.createClient());
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
      const result = await this.requestWithRecovery(request, controller, false);
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
    recovered: boolean,
  ): Promise<unknown> {
    const requestClient = this.handles.client;
    try {
      return await requestClient.request(
        { method: request.method, ...(request.params === undefined ? {} : { params: request.params }) } as never,
        ResultSchema,
        { signal: controller.signal, ...(request.timeoutMs === undefined ? {} : { timeout: request.timeoutMs }) },
      );
    } catch (error) {
      if (!recovered && isPostAuthUnauthorized(error)) {
        if (this.handles.client === requestClient) {
          await this.recoverPostAuthUnauthorized(error);
        }
        return this.requestWithRecovery(request, controller, true);
      }
      throw error;
    }
  }

  private async recoverPostAuthUnauthorized(error: StreamableHTTPError): Promise<void> {
    const handles = this.handles;
    if (handles.recovery) return handles.recovery;

    const recovery = this.performPostAuthRecovery(error);
    handles.recovery = recovery;
    try {
      await recovery;
    } finally {
      handles.recovery = undefined;
    }
  }

  private async performPostAuthRecovery(error: StreamableHTTPError): Promise<void> {
    const handles = this.handles;
    const { client: staleClient, transport: staleTransport, connection } = handles;
    const serverName = connection?.name;

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
    } catch {
      await staleTransport.close().catch(() => undefined);
    }

    const freshTransport = this.recreateHttpTransport(staleTransport, serverName);
    const freshClient = this.createClient();
    try {
      const timeout = freshTransport.connectionTimeout ?? freshTransport.timeout;
      await freshClient.connect(freshTransport, timeout ? { timeout } : undefined);
      handles.client = freshClient;
      handles.transport = freshTransport;
      this.registerListChangedNotifications();
      if (connection) this.publishConnectedSnapshot(connection, freshTransport, freshClient);
    } catch (recoveryError) {
      handles.client = freshClient;
      handles.transport = freshTransport;
      if (connection) {
        connection.status = ClientStatus.AwaitingOAuth;
        connection.tags = [...(freshTransport.tags ?? [])];
        connection.requestTimeoutMs = freshTransport.requestTimeout ?? freshTransport.timeout;
        connection.requiresOAuth = Boolean(freshTransport.oauthProvider);
        connection.authorizationUrl = freshTransport.oauthProvider?.getAuthorizationUrl?.();
        connection.oauthStartTime = new Date().toISOString();
        connection.lastError = snapshotError(error);
      }
      throw recoveryError;
    }
  }

  private publishConnectedSnapshot(
    connection: OutboundConnection,
    transport: AuthProviderTransport,
    client: Client,
  ): void {
    connection.status = ClientStatus.Connected;
    connection.tags = [...(transport.tags ?? [])];
    connection.requestTimeoutMs = transport.requestTimeout ?? transport.timeout;
    connection.requiresOAuth = Boolean(transport.oauthProvider);
    connection.authorizationUrl = undefined;
    connection.oauthStartTime = undefined;
    connection.lastError = undefined;
    connection.lastConnected = new Date().toISOString();
    const capabilities = toJsonValue(client.getServerCapabilities?.() ?? {});
    if (capabilities && !Array.isArray(capabilities) && typeof capabilities === 'object') {
      connection.capabilities = capabilities;
    }
    connection.instructions = client.getInstructions?.();
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
