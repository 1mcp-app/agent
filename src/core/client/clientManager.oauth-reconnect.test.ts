import { StreamableHTTPClientTransport as ModernStreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { getLegacyClient, getLegacyTransport } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { createTransports } from '@src/transport/transportFactory.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientManager } from './clientManager.js';

describe('OAuth reconnect with real SDK clients', () => {
  afterEach(async () => {
    await ClientManager.shutdownCurrent();
    ClientManager.resetInstance();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(
    (['legacy', 'auto', '2026-07-28'] as const).flatMap((protocolVersion) =>
      ['configured', 'fallback'].flatMap((recreation) =>
        ['complete', 'initiate'].map((action) => ({ protocolVersion, recreation, action })),
      ),
    ),
  )(
    'negotiates fresh capabilities for $protocolVersion via $recreation recreation on $action',
    async ({ protocolVersion, recreation, action }) => {
      const handshakes: { method: string; sessionId: string | null }[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: unknown, init?: RequestInit) => {
          if (init?.method === 'GET') return new Response(null, { status: 405 });
          if (!init?.body) return new Response(null, { status: 202 });
          const request = JSON.parse(String(init.body));
          if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
          if (request.method !== 'initialize' && request.method !== 'server/discover') {
            throw new Error(`Unexpected request: ${request.method}`);
          }
          handshakes.push({ method: request.method, sessionId: new Headers(init.headers).get('mcp-session-id') });
          const capabilities = { tools: { listChanged: handshakes.length > 1 } };
          const result =
            request.method === 'initialize'
              ? {
                  protocolVersion: request.params.protocolVersion,
                  capabilities,
                  serverInfo: { name: 'upstream', version: '1' },
                }
              : {
                  resultType: 'complete',
                  ttlMs: 0,
                  cacheScope: 'private',
                  supportedVersions: ['2026-07-28'],
                  capabilities,
                };
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
            headers: {
              'content-type': 'application/json',
              ...(request.method === 'initialize' ? { 'mcp-session-id': `session-${handshakes.length}` } : {}),
            },
          });
        }),
      );

      const transport = createTransports({
        upstream: { type: 'http', url: 'https://example.com/mcp', protocolVersion, connectionTimeout: 1000 },
      }).upstream;
      if (recreation === 'fallback') delete transport.recreate;
      const manager = ClientManager.getOrCreateInstance();
      await manager.createSingleClient('upstream', transport);
      const originalClient = getLegacyClient(manager.getClient('upstream'));
      expect(originalClient.getServerCapabilities()).toEqual({ tools: { listChanged: false } });
      manager.getClient('upstream').authorizationUrl = 'https://example.com/expired-authorization';
      manager.getClient('upstream').oauthStartTime = '2020-01-01T00:00:00.000Z';

      // Closed SDK transports retain this ID. A fresh Client must not inherit it,
      // or connect resolves without negotiating or loading any capabilities.
      Object.assign(transport, { _sessionId: 'previous-session' });
      vi.spyOn(
        transport as StreamableHTTPClientTransport | ModernStreamableHTTPClientTransport,
        'finishAuth',
      ).mockResolvedValue(undefined);

      if (action === 'complete') await manager.completeOAuthAndReconnect('upstream', 'authorization-code');
      else await manager.initiateOAuth('upstream');

      const reconnected = manager.getClient('upstream');
      expect(transport.sessionId).toBe('previous-session');
      expect(getLegacyClient(reconnected)).not.toBe(originalClient);
      expect(handshakes).toEqual([
        { method: protocolVersion === 'legacy' ? 'initialize' : 'server/discover', sessionId: null },
        { method: protocolVersion === 'legacy' ? 'initialize' : 'server/discover', sessionId: null },
      ]);
      expect(getLegacyTransport(reconnected).sessionId).not.toBe('previous-session');
      expect(getLegacyClient(reconnected).getServerCapabilities()).toEqual({ tools: { listChanged: true } });
      expect(reconnected.capabilities).toEqual({ tools: { listChanged: true } });
      expect(reconnected.authorizationUrl).toBeUndefined();
      expect(reconnected.oauthStartTime).toBeUndefined();
    },
  );
});
