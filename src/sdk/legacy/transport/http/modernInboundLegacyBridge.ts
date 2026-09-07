import { randomUUID } from 'node:crypto';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { ServerManager } from '@src/core/server/serverManager.js';
import type { InboundConnectionConfig } from '@src/core/types/index.js';
import { LegacyOutboundEraAdapter } from '@src/gateway/adapters/legacy/legacyOutboundEraAdapter.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { LegacySdkClientAdapter } from '@src/sdk/legacy/client/runtime/legacySdkClientAdapter.js';

const LEGACY_REVISION = '2025-11-25';

export interface ModernInboundLegacyBridge {
  readonly targetConnectionId: string;
  readonly outbound: LegacyOutboundEraAdapter;
  close(): Promise<void>;
}

/**
 * Gives one modern stateless exchange a private connection to the existing
 * aggregate legacy server. SDK-v1 objects stay inside the legacy island.
 */
export async function createModernInboundLegacyBridge(
  serverManager: ServerManager,
  config: InboundConnectionConfig,
): Promise<ModernInboundLegacyBridge> {
  const connectionId = `modern-${randomUUID()}`;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: '1mcp-modern-http-bridge', version: '1.0.0' }, { capabilities: {} });

  const connecting = [
    serverManager.connectTransport(serverTransport, connectionId, { ...config, requestOnly: true }),
    client.connect(clientTransport),
  ];
  try {
    await Promise.all(connecting);
  } catch (error) {
    await Promise.allSettled([clientTransport.close(), serverTransport.close()]);
    await Promise.allSettled(connecting);
    await serverManager.disconnectTransport(connectionId, true).catch(() => undefined);
    throw error;
  }

  const legacy = new LegacySdkClientAdapter(client, clientTransport);
  try {
    await legacy.start();
  } catch (error) {
    await Promise.allSettled([legacy.close(), serverManager.disconnectTransport(connectionId, true)]);
    throw error;
  }
  let closePromise: Promise<void> | undefined;
  return {
    targetConnectionId: connectionId,
    outbound: new LegacyOutboundEraAdapter(legacy, { era: 'legacy', revision: LEGACY_REVISION }),
    close: () =>
      (closePromise ??= Promise.allSettled([
        legacy.close(),
        serverManager.disconnectTransport(connectionId, true),
      ]).then((results) => {
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failed) throw failed.reason;
      })),
  };
}
