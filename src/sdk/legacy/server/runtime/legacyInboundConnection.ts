import type { InboundConnection, InboundConnectionError, ServerStatus } from '@src/core/types/server.js';
import type { LegacyConnectionId } from '@src/sdk/contracts/legacySdkAdapter.js';
import type { Server } from '@src/sdk/legacy/server/index.js';

import { getLegacyServerHandle, LegacySdkServerAdapter } from './legacySdkServerAdapter.js';

/** Internal connection shape. Never re-export this type through a shared compatibility path. */
export interface LegacyInboundConnection extends Omit<
  InboundConnection,
  'status' | 'lastError' | 'lastConnected' | 'connectedAt'
> {
  readonly connectionId: LegacyConnectionId;
  readonly adapter: LegacySdkServerAdapter;
  status: ServerStatus;
  lastError?: InboundConnectionError;
  lastConnected?: string;
  connectedAt?: string;
}

export function toInboundConnectionError(error: unknown): InboundConnectionError {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      name: error.name,
      message: error.message,
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    };
  }
  return { name: 'Error', message: String(error) };
}

export function requireLegacyInboundConnection(connection: InboundConnection): LegacyInboundConnection {
  if (!(connection.adapter instanceof LegacySdkServerAdapter)) {
    throw new TypeError('Inbound connection is not owned by the legacy SDK server adapter');
  }
  return connection as LegacyInboundConnection;
}

export function getLegacyInboundServer(connection: InboundConnection): Server {
  return getLegacyServerHandle(requireLegacyInboundConnection(connection).adapter);
}
