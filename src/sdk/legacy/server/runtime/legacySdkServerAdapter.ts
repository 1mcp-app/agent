import type { InboundConnectionAdapter } from '@src/core/types/server.js';
import { type JsonObject, toJsonValue } from '@src/sdk/contracts/jsonValue.js';
import type {
  LegacyConnectionId,
  LegacySdkLifecycleState,
  LegacySdkNotification,
} from '@src/sdk/contracts/legacySdkAdapter.js';
import { OneMcpProtocolError } from '@src/sdk/contracts/oneMcpProtocolError.js';
import type { Server } from '@src/sdk/legacy/server/index.js';
import type { Transport } from '@src/sdk/legacy/shared/transport.js';

interface LegacyServerHandles {
  readonly server: Server;
  readonly transport: Transport;
}

const serverHandles = new WeakMap<LegacySdkServerAdapter, LegacyServerHandles>();

function toProtocolError(error: unknown): OneMcpProtocolError {
  try {
    return OneMcpProtocolError.fromUnknown(error);
  } catch {
    return new OneMcpProtocolError(-32_603, error instanceof Error ? error.message : String(error));
  }
}

/** Owns the live v1 SDK server and transport inside the legacy runtime island. */
export class LegacySdkServerAdapter implements InboundConnectionAdapter {
  private lifecycleState: LegacySdkLifecycleState = 'idle';
  private readonly admittedInteractions = new Set<string | number>();
  private retiring = false;
  private subscriptionDelivery?: (notification: LegacySdkNotification) => void;
  private closePromise?: Promise<void>;
  private drainPromise?: Promise<void>;
  private resolveDrain?: () => void;
  private rejectDrain?: (error: unknown) => void;

  public constructor(
    public readonly connectionId: LegacyConnectionId,
    server: Server,
    transport: Transport,
  ) {
    serverHandles.set(this, { server, transport });
  }

  public get state(): LegacySdkLifecycleState {
    return this.lifecycleState;
  }

  public async start(): Promise<void> {
    if (this.lifecycleState === 'running') return;
    this.lifecycleState = 'starting';
    try {
      const { server, transport } = getHandles(this);
      await server.connect(transport);
      this.installInteractionDrain(transport);
      this.lifecycleState = 'running';
    } catch (error) {
      this.lifecycleState = 'stopped';
      throw toProtocolError(error);
    }
  }

  public async notify(notification: LegacySdkNotification): Promise<void> {
    const params = notification.params === undefined ? undefined : toJsonValue(notification.params);
    if (params !== undefined && (params === null || Array.isArray(params) || typeof params !== 'object')) {
      throw new TypeError('Legacy server notification params must be a JSON object');
    }
    try {
      await getHandles(this).server.notification({
        method: notification.method,
        params: params as JsonObject | undefined,
      });
    } catch (error) {
      throw toProtocolError(error);
    }
  }

  public setSubscriptionDelivery(deliver: (notification: LegacySdkNotification) => void): void {
    this.subscriptionDelivery = deliver;
  }

  public async notifySubscription(notification: LegacySdkNotification): Promise<void> {
    if (this.subscriptionDelivery) {
      this.subscriptionDelivery(notification);
      return;
    }
    await this.notify(notification);
  }

  /** Retire notification coverage without aborting already admitted interactions. */
  public closeWhenIdle(): Promise<void> {
    if (this.lifecycleState === 'stopped') return Promise.resolve();
    if (this.closePromise) return this.closePromise;
    if (this.drainPromise) return this.drainPromise;
    this.retiring = true;
    this.drainPromise = new Promise<void>((resolve, reject) => {
      this.resolveDrain = resolve;
      this.rejectDrain = reject;
    });
    if (!this.admittedInteractions.size) void this.close().catch(() => {});
    return this.drainPromise;
  }

  public close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.lifecycleState === 'stopped') return Promise.resolve();
    this.lifecycleState = 'stopping';
    this.closePromise = (async () => {
      try {
        await getHandles(this).transport.close();
        this.resolveDrain?.();
      } catch (error) {
        const failure = toProtocolError(error);
        this.rejectDrain?.(failure);
        throw failure;
      } finally {
        this.admittedInteractions.clear();
        this.lifecycleState = 'stopped';
      }
    })();
    return this.closePromise;
  }

  private installInteractionDrain(transport: Transport): void {
    const receive = transport.onmessage;
    const send = transport.send.bind(transport);
    const onclose = transport.onclose;
    transport.onclose = () => {
      this.admittedInteractions.clear();
      this.lifecycleState = 'stopped';
      this.resolveDrain?.();
      onclose?.();
    };
    transport.onmessage = (message, extra) => {
      if ('method' in message && 'id' in message) {
        if (this.admittedInteractions.has(message.id)) {
          void send(
            { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Duplicate active request ID' } },
            { relatedRequestId: message.id },
          ).catch(() => {});
          return;
        }
        const interaction = ['tools/call', 'prompts/get', 'resources/read'].includes(message.method);
        if (this.retiring || (interaction && this.admittedInteractions.size >= 128)) {
          void send(
            {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32000,
                message: this.retiring
                  ? 'Subscription coverage ended; reconnect required'
                  : 'Interaction admission limit exceeded',
              },
            },
            { relatedRequestId: message.id },
          ).catch(() => {});
          return;
        }
        if (interaction) this.admittedInteractions.add(message.id);
      }
      receive?.(message, extra);
      if ('method' in message && message.method === 'notifications/cancelled') {
        const id = message.params?.requestId;
        if (typeof id === 'string' || typeof id === 'number') this.admittedInteractions.delete(id);
        if (this.retiring && !this.admittedInteractions.size) void this.close().catch(() => {});
      }
    };
    transport.send = async (message, options) => {
      try {
        await send(message, options);
      } finally {
        if ('id' in message && !('method' in message) && message.id !== undefined) {
          this.admittedInteractions.delete(message.id);
          if (this.retiring && !this.admittedInteractions.size) void this.close().catch(() => {});
        }
      }
    };
  }
}

function getHandles(adapter: LegacySdkServerAdapter): LegacyServerHandles {
  const handles = serverHandles.get(adapter);
  if (!handles) throw new TypeError('Unknown legacy SDK server adapter');
  return handles;
}

export function getLegacyServerHandle(adapter: LegacySdkServerAdapter): Server {
  return getHandles(adapter).server;
}

export function getLegacyServerTransportHandle(adapter: LegacySdkServerAdapter): Transport | undefined {
  return getHandles(adapter).server.transport;
}

export function isLegacyServerConnected(adapter: LegacySdkServerAdapter): boolean {
  return adapter.state === 'running' && getHandles(adapter).server.transport !== undefined;
}
