import { Client } from '@src/sdk/legacy/client/index.js';
import { StreamableHTTPError } from '@src/sdk/legacy/client/streamableHttp.js';
import { McpError } from '@src/sdk/legacy/types.js';

import { ClientStatus, type OutboundConnection } from '@src/core/types/client.js';
import { createLegacyTimeoutMs, OneMcpProtocolError } from '@src/sdk/contracts/index.js';

import { bindLegacySdkConnection, LegacySdkClientAdapter } from './legacySdkClientAdapter.js';
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

  it('recovers a terminal post-authentication 401 and retries once', async () => {
    const staleClient = createClient();
    const freshClient = createClient();
    const invalidateCredentials = vi.fn().mockResolvedValue(undefined);
    const staleTransport = {
      ...createTransport(),
      oauthProvider: { invalidateCredentials },
      tags: ['old'],
    } as AuthProviderTransport;
    const freshTransport = {
      ...createTransport(),
      oauthProvider: staleTransport.oauthProvider,
      tags: ['new'],
    } as AuthProviderTransport;
    const unauthorized = new StreamableHTTPError(401, 'Server returned 401 after successful authentication');
    vi.spyOn(staleClient, 'request').mockRejectedValue(unauthorized);
    vi.spyOn(staleClient, 'close').mockResolvedValue(undefined);
    vi.spyOn(freshClient, 'connect').mockResolvedValue(undefined);
    vi.spyOn(freshClient, 'request').mockResolvedValue({ tools: [] } as never);
    vi.spyOn(freshClient, 'getServerCapabilities').mockReturnValue({ tools: {} });
    vi.spyOn(freshClient, 'getInstructions').mockReturnValue('fresh instructions');
    const recreateHttpTransport = vi.fn().mockReturnValue(freshTransport);
    const adapter = new LegacySdkClientAdapter(staleClient, staleTransport, {
      createClient: () => freshClient,
      recreateHttpTransport,
    });
    const connection: OutboundConnection = {
      name: 'oauth-server',
      adapter,
      status: ClientStatus.Connected,
      tags: ['old'],
      requiresOAuth: true,
      authorizationUrl: 'https://example.com/authorize',
      oauthStartTime: new Date(0).toISOString(),
    };
    bindLegacySdkConnection(adapter, connection);

    await expect(adapter.request({ id: 'request-5' as never, method: 'tools/list' })).resolves.toEqual({ tools: [] });

    expect(invalidateCredentials).toHaveBeenCalledWith('tokens');
    expect(staleClient.close).toHaveBeenCalledOnce();
    expect(recreateHttpTransport).toHaveBeenCalledWith(staleTransport, 'oauth-server');
    expect(freshClient.connect).toHaveBeenCalledWith(freshTransport, undefined);
    expect(freshClient.request).toHaveBeenCalledOnce();
    expect(connection).toMatchObject({
      status: ClientStatus.Connected,
      tags: ['new'],
      authorizationUrl: undefined,
      oauthStartTime: undefined,
      instructions: 'fresh instructions',
    });
  });

  it('converts a non-terminal HTTP failure without attempting recovery', async () => {
    const client = createClient();
    const invalidateCredentials = vi.fn();
    const transport = { ...createTransport(), oauthProvider: { invalidateCredentials } } as AuthProviderTransport;
    vi.spyOn(client, 'request').mockRejectedValue(new StreamableHTTPError(403, 'Forbidden'));
    vi.spyOn(client, 'close').mockResolvedValue(undefined);
    const recreateHttpTransport = vi.fn();
    const adapter = new LegacySdkClientAdapter(client, transport, { recreateHttpTransport });

    await expect(adapter.request({ id: 'request-6' as never, method: 'tools/list' })).rejects.toBeInstanceOf(
      OneMcpProtocolError,
    );
    expect(invalidateCredentials).not.toHaveBeenCalled();
    expect(recreateHttpTransport).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
  });
});
