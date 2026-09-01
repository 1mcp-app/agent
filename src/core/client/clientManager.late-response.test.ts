import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { getLegacyClient } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import logger from '@src/logger/logger.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientManager } from './clientManager.js';

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('ClientManager late responses', () => {
  afterEach(async () => {
    await ClientManager.shutdownCurrent();
    ClientManager.resetInstance();
  });

  it('bounds diagnostics when a backend returns a large response after timeout', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const sensitiveSchema = 'sensitive-schema-content'.repeat(5_000);
    serverTransport.onmessage = (message) => {
      if (!('method' in message) || !('id' in message)) return;
      if (message.method === 'initialize') {
        const params = message.params as { protocolVersion: string };
        void serverTransport.send({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'slow-server', version: '1.0.0' },
          },
        });
        return;
      }
      if (message.method === 'tools/list') {
        setTimeout(() => {
          void serverTransport.send({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: [
                {
                  name: 'large-tool',
                  inputSchema: { type: 'object', description: sensitiveSchema },
                },
              ],
            },
          });
        }, 20);
      }
    };
    await serverTransport.start();

    const clientManager = ClientManager.getOrCreateInstance();
    const connections = await clientManager.createClients({
      'slow-server': clientTransport as AuthProviderTransport,
    });

    await expect(getLegacyClient(connections.get('slow-server')!).listTools(undefined, { timeout: 1 })).rejects.toThrow(
      'Request timed out',
    );

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith('Client slow-server received a response for an unknown message ID');
    });
    const diagnostics = vi
      .mocked(logger.error)
      .mock.calls.map(([message]) => String(message))
      .join('\n');
    expect(diagnostics).not.toContain('sensitive-schema-content');
    expect(diagnostics.length).toBeLessThan(500);

    await serverTransport.close();
  });
});
