import {
  SSEClientTransport as ModernSSEClientTransport,
  StreamableHTTPClientTransport as ModernStreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { TransportRecreator } from '@src/core/client/transportRecreator.js';
import type { MCPServerParams } from '@src/core/types/index.js';

import { describe, expect, it, vi } from 'vitest';

import { createTransports, createTransportsWithContext } from './transportFactory.js';

vi.mock('@src/auth/sdkOAuthClientProvider.js', () => ({
  SDKOAuthClientProvider: class {},
}));

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: () => ({
      getUrl: () => 'http://localhost:3050',
      get: () => ({}),
      isEnvSubstitutionEnabled: () => false,
    }),
  },
}));

describe.each(['auto', 'legacy', '2026-07-28'] as const)('factory recreation (%s)', (protocolVersion) => {
  const recreator = new TransportRecreator();
  const config: Record<string, MCPServerParams> = {
    upstream: {
      type: 'http',
      url: 'https://example.com/mcp',
      protocolVersion,
      headers: { 'X-Configured': 'retained' },
      connectionTimeout: 1234,
      requestTimeout: 5678,
      timeout: 9000,
      tags: ['configured'],
    },
  };

  it.each([
    ['createTransports', createTransports],
    ['createTransportsWithContext', createTransportsWithContext],
  ] as const)('honors session preservation through %s and runtime recreation', async (_name, create) => {
    const original = (await create(config)).upstream;
    // Model a session assigned by the backend after construction.
    Object.assign(original, { _sessionId: 'live-session' });
    const HttpTransport =
      protocolVersion === 'legacy' ? StreamableHTTPClientTransport : ModernStreamableHTTPClientTransport;

    const replacements = [
      original.recreate!(),
      original.recreate!({}),
      original.recreate!({ preserveSessionId: true }),
      recreator.recreateForRetry(original),
      recreator.recreateHttpTransport(original),
      recreator.recreateHttpTransport(original, undefined, { preserveSessionId: true }),
    ];
    for (const replacement of replacements) {
      expect(replacement).not.toBe(original);
      expect(replacement).toBeInstanceOf(HttpTransport);
      expect(replacement.sessionId).toBe('live-session');
      expect(replacement).toMatchObject({
        outboundProtocolVersion: protocolVersion,
        connectionTimeout: 1234,
        requestTimeout: 5678,
        timeout: 9000,
        tags: ['configured'],
        _requestInit: { headers: { 'X-Configured': 'retained' } },
        recreate: expect.any(Function),
        oauthProvider: expect.any(Object),
      });
    }

    Object.assign(replacements[0], { _sessionId: 'next-session' });
    expect(replacements[0].recreate!().sessionId).toBe('next-session');
    expect(original.recreate!({ preserveSessionId: false }).sessionId).toBeUndefined();
    expect(recreator.recreateForRetry(original, undefined, { preserveSessionId: false }).sessionId).toBeUndefined();
    expect(
      recreator.recreateHttpTransport(original, undefined, { preserveSessionId: false }).sessionId,
    ).toBeUndefined();
    expect(recreator.recreateForSessionLoss(original).sessionId).toBeUndefined();
    expect(original.sessionId).toBe('live-session');
  });

  it('retains the SSE family and configuration on recreation', () => {
    const original = createTransports({ upstream: { ...config.upstream, type: 'sse' } }).upstream;
    const replacement = recreator.recreateForRetry(original);

    expect(replacement).toBeInstanceOf(protocolVersion === 'legacy' ? SSEClientTransport : ModernSSEClientTransport);
    expect(replacement).toMatchObject({
      outboundProtocolVersion: protocolVersion,
      connectionTimeout: 1234,
      requestTimeout: 5678,
      timeout: 9000,
      tags: ['configured'],
      _requestInit: { headers: { 'X-Configured': 'retained' } },
    });
  });
});
