import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { SchemaCache } from '@src/core/capabilities/schemaCache.js';
import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import type { Tool } from '@src/sdk/contracts/index.js';
import { Client } from '@src/sdk/legacy/client/index.js';

import { describe, expect, it, vi } from 'vitest';

import { LegacySdkClientAdapter } from './legacySdkClientAdapter.js';
import type { AuthProviderTransport } from './legacyTransport.js';

describe('schema cache MCP cancellation', () => {
  it('aborts an unanswered SDK request at the cache deadline and recovers capacity', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let requests = 0;
    let cancellations = 0;
    const tool: Tool = { name: 'echo', inputSchema: { type: 'object' } };
    serverTransport.onmessage = (message) => {
      if (!('method' in message)) return;
      if (message.method === 'notifications/cancelled') {
        cancellations++;
        return;
      }
      if (!('id' in message)) return;
      if (message.method === 'initialize') {
        void serverTransport.send({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: (message.params as { protocolVersion: string }).protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'cache-test', version: '1' },
          },
        });
      } else if (message.method === 'tools/list' && ++requests > 1) {
        void serverTransport.send({ jsonrpc: '2.0', id: message.id, result: { tools: [tool] } });
      }
    };
    await serverTransport.start();
    const client = new Client({ name: 'cache-test', version: '1' }, { capabilities: {} });
    await client.connect(clientTransport);
    const adapter = new LegacySdkClientAdapter(client, clientTransport as AuthProviderTransport);
    vi.useFakeTimers();
    try {
      const cache = new SchemaCache({ maxEntries: 1 });
      const load = async (_server: string, _name: string, signal?: AbortSignal) =>
        (await requestLegacyAdapter<{ tools: Tool[] }>(adapter, 'tools/list', undefined, { signal })).tools[0];
      const pending = cache.getOrLoad('server', 'echo', load);
      const rejected = expect(pending).rejects.toThrow('deadline');
      await vi.advanceTimersByTimeAsync(30000);
      await rejected;
      expect(cancellations).toBe(1);
      expect(cache.has('server', 'echo')).toBe(false);
      await expect(cache.getOrLoad('server', 'echo', load)).resolves.toEqual(tool);
      expect(requests).toBe(2);
    } finally {
      vi.useRealTimers();
      await adapter.close();
      await serverTransport.close();
    }
  });
});
