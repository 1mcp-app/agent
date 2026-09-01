import { Client } from '@src/sdk/legacy/client/index.js';
import { McpError } from '@src/sdk/legacy/types.js';

import { createLegacyTimeoutMs, OneMcpProtocolError } from '@src/sdk/contracts/index.js';

import { LegacySdkClientAdapter } from './legacySdkClientAdapter.js';
import type { AuthProviderTransport } from './legacyTransport.js';

function createClient(): Client {
  return new Client({ name: 'adapter-test', version: '1.0.0' }, { capabilities: {} });
}

function createTransport(): AuthProviderTransport {
  return {
    start: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
  };
}

describe('LegacySdkClientAdapter', () => {
  it('clones successful v1 SDK results before returning them', async () => {
    const client = createClient();
    const result = { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] };
    vi.spyOn(client, 'request').mockResolvedValue(result as never);
    const adapter = new LegacySdkClientAdapter(client, createTransport());

    const response = await adapter.request({
      id: 'request-1' as never,
      method: 'tools/list',
      timeoutMs: createLegacyTimeoutMs(1234),
    });

    expect(response).toEqual(result);
    expect(response).not.toBe(result);
    expect(client.request).toHaveBeenCalledWith(
      { method: 'tools/list' },
      expect.anything(),
      expect.objectContaining({ timeout: 1234, signal: expect.any(AbortSignal) }),
    );
  });

  it('converts foreign SDK protocol failures', async () => {
    const client = createClient();
    vi.spyOn(client, 'request').mockRejectedValue(new McpError(-32_601, 'Method not found', { method: 'missing' }));
    const adapter = new LegacySdkClientAdapter(client, createTransport());

    await expect(
      adapter.request({ id: 'request-2' as never, method: 'missing' }),
    ).rejects.toEqual(expect.objectContaining({ code: -32_601, message: expect.stringContaining('Method not found') }));
    await expect(adapter.request({ id: 'request-3' as never, method: 'missing' })).rejects.toBeInstanceOf(
      OneMcpProtocolError,
    );
  });

  it('keeps AbortController inside the island and cancels by opaque request id', async () => {
    const client = createClient();
    let observedSignal: AbortSignal | undefined;
    vi.spyOn(client, 'request').mockImplementation((_request, _schema, options) => {
      observedSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const adapter = new LegacySdkClientAdapter(client, createTransport());
    const requestId = 'request-4' as never;

    const pending = adapter.request({ id: requestId, method: 'tools/list' });
    await adapter.cancel(requestId);

    await expect(pending).rejects.toBeInstanceOf(OneMcpProtocolError);
    expect(observedSignal?.aborted).toBe(true);
  });
});
