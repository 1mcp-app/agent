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

  public async close(): Promise<void> {
    if (this.lifecycleState === 'stopped' || this.lifecycleState === 'stopping') return;
    this.lifecycleState = 'stopping';
    try {
      await getHandles(this).transport.close();
    } catch (error) {
      throw toProtocolError(error);
    } finally {
      this.lifecycleState = 'stopped';
    }
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
