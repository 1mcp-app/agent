import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { describe, expect, it } from 'vitest';

import { ConnectionHandler } from './connectionHandler.js';
import { TransportRecreator } from './transportRecreator.js';

describe('fresh-client HTTP retry', () => {
  it('initializes again after a session was allocated but the initialized notification failed', async () => {
    const methods: string[] = [];
    const initializeSessions: Array<string | null> = [];
    let failInitialized = true;
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      // Decline the optional SSE stream without opening a real connection.
      if (init?.method === 'GET') return new Response(null, { status: 405 });
      const message = JSON.parse(String(init?.body));
      methods.push(message.method);
      if (message.method === 'initialize') {
        initializeSessions.push(new Headers(init?.headers).get('mcp-session-id'));
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'backend', version: '1' },
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json', 'mcp-session-id': `session-${initializeSessions.length}` },
          },
        );
      }
      if (message.method === 'notifications/initialized' && failInitialized) {
        failInitialized = false;
        throw new Error('Simulated initialized notification network failure');
      }
      return new Response(null, { status: 202 });
    };
    const original = new StreamableHTTPClientTransport(new URL('https://example.invalid/mcp'), { fetch });
    const firstClient = new Client({ name: 'retry-check', version: '1' });
    const recreator = new TransportRecreator();
    const connected = await new ConnectionHandler().connectWithRetry(
      firstClient,
      original,
      'backend',
      undefined,
      (transport) => recreator.recreateForRetry(transport, 'backend', { preserveSessionId: false }),
      () => new Client({ name: 'retry-check', version: '1' }),
    );

    try {
      expect(original.sessionId).toBe('session-1');
      expect(connected.client).not.toBe(firstClient);
      expect(methods).toEqual(['initialize', 'notifications/initialized', 'initialize', 'notifications/initialized']);
      expect(initializeSessions).toEqual([null, null]);
      expect(connected.transport.sessionId).toBe('session-2');
      expect(connected.client.getServerCapabilities()).toEqual({ tools: {} });
      expect(connected.client.getServerVersion()).toEqual({ name: 'backend', version: '1' });
    } finally {
      await connected.client.close();
      await firstClient.close();
    }
  });
});
