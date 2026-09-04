import { ClientStatus } from '@src/core/types/client.js';
import { Client } from '@src/sdk/legacy/client/index.js';

import { describe, expect, it, vi } from 'vitest';

import { createLegacyOutboundConnection, requestLegacyOutbound } from './legacyOutboundConnection.js';
import type { AuthProviderTransport } from './legacyTransport.js';

describe('requestLegacyOutbound', () => {
  it('routes tool, resource, and prompt operations through the adapter request boundary', async () => {
    const client = new Client({ name: 'routing-test', version: '1.0.0' }, { capabilities: {} });
    const request = vi.spyOn(client, 'request').mockResolvedValue({ ok: true } as never);
    const transport: AuthProviderTransport = {
      start: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      requestTimeout: 4321,
    };
    const connection = createLegacyOutboundConnection({
      name: 'routing-test',
      client,
      transport,
      status: ClientStatus.Connected,
    });

    await requestLegacyOutbound(connection, 'tools/call', {
      name: 'echo',
      arguments: { value: 'hi' },
      _meta: { context: { secret: 'inbound-only' }, contextProof: { signature: 'do-not-forward' } },
    });
    await requestLegacyOutbound(connection, 'resources/read', {
      uri: 'file:///tmp/example',
      _meta: { context: { secret: 'resource-secret' } },
    });
    await requestLegacyOutbound(connection, 'prompts/get', {
      name: 'review',
      arguments: { strict: 'true' },
      _meta: { contextProof: { signature: 'prompt-proof' } },
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      { method: 'tools/call', params: { name: 'echo', arguments: { value: 'hi' } } },
      expect.anything(),
      expect.objectContaining({ timeout: 4321, signal: expect.any(AbortSignal) }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      { method: 'resources/read', params: { uri: 'file:///tmp/example' } },
      expect.anything(),
      expect.objectContaining({ timeout: 4321, signal: expect.any(AbortSignal) }),
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      { method: 'prompts/get', params: { name: 'review', arguments: { strict: 'true' } } },
      expect.anything(),
      expect.objectContaining({ timeout: 4321, signal: expect.any(AbortSignal) }),
    );
  });
});
