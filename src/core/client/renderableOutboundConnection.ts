import { randomUUID } from 'node:crypto';

import type { OutboundConnection } from '@src/core/types/client.js';
import { ClientStatus } from '@src/core/types/client.js';
import type {
  LegacyConnectionId,
  LegacySdkAdapter,
  LegacySdkNotification,
  LegacySdkRequest,
  LegacySdkResponse,
} from '@src/sdk/contracts/index.js';

function unavailable(): never {
  throw new Error('Render-only outbound connections cannot perform SDK operations');
}

function createInertAdapter(): LegacySdkAdapter {
  return {
    connectionId: randomUUID() as LegacyConnectionId,
    state: 'idle',
    async start() {
      unavailable();
    },
    async nextEvent() {
      return unavailable();
    },
    async respond(_response: LegacySdkResponse) {
      unavailable();
    },
    async request(_request: LegacySdkRequest) {
      return unavailable();
    },
    async cancel() {},
    async notify(_notification: LegacySdkNotification) {
      unavailable();
    },
    async close() {},
  };
}

/** Plain connection metadata used only while rendering configured-server instructions. */
export function createRenderableOutboundConnection(
  name: string,
  tags: readonly string[] | undefined,
  status: ClientStatus,
): OutboundConnection {
  return {
    name,
    adapter: createInertAdapter(),
    status,
    tags: [...(tags ?? [])],
    requiresOAuth: false,
  };
}
