import { Client as ModernClient } from '@modelcontextprotocol/client';
import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import type { ServerManager } from '@src/core/server/serverManager.js';
import type { InboundConnectionConfig } from '@src/core/types/server.js';
import { registerModernSubscriptions } from '@src/sdk/legacy/client/runtime/modernSubscriptions.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import type { Transport } from '@src/sdk/legacy/shared/transport.js';
import { getModernSubscriptionCapabilities } from '@src/transport/http/routes/modernSubscriptions.js';

import { expect, it, vi } from 'vitest';

import { createModernInboundLegacyBridge } from './modernInboundLegacyBridge.js';

vi.mock('@src/core/protocol/requestHandlerUtils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/core/protocol/requestHandlerUtils.js')>()),
  filterConnectionsForSession: (connections: unknown) => connections,
}));

it('publishes a declined upstream kind before pinning the modern inbound filter', async () => {
  const connection = createMockOutboundConnection({
    adapter: { protocol: { era: 'modern', revision: '2026-07-28' } },
    capabilities: { tools: { listChanged: true }, resources: { listChanged: true, subscribe: true } },
  });
  registerModernSubscriptions(
    connection.adapter,
    new ModernClient({ name: 'test', version: '1' }),
    {
      start: async () => {},
      send: async () => {},
      close: async () => {},
    },
    async () => ({ toolsListChanged: true }),
  );
  const server = new Server(
    { name: 'aggregate', version: '1' },
    { capabilities: { logging: {}, tools: {}, resources: {} } },
  );
  let captured: InboundConnectionConfig | undefined;
  const manager = {
    getClients: () => new Map([['peer', connection]]),
    connectTransport: async (transport: Transport, _id: string, config: InboundConnectionConfig) => {
      captured = config;
      await server.connect(transport);
    },
    disconnectTransport: async () => server.close(),
  } as unknown as ServerManager;
  const bridge = await createModernInboundLegacyBridge(
    manager,
    {},
    {
      subscriptionListKinds: ['resources'],
      subscriptionNotification: vi.fn(),
    },
  );
  try {
    expect(await bridge.prepareSubscriptions({ resourcesListChanged: true })).toEqual({});
    expect(captured?.subscriptionListKinds).toEqual([]);
    expect(getModernSubscriptionCapabilities(manager, {}).resources).toEqual({ subscribe: true });
  } finally {
    await bridge.close();
  }
});
