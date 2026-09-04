import { ClientStatus, type OutboundConnection } from '@src/core/types/client.js';
import { createLegacyTimeoutMs, OneMcpProtocolError } from '@src/sdk/contracts/index.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { StreamableHTTPError } from '@src/sdk/legacy/client/streamableHttp.js';
import { CallToolRequestSchema, McpError } from '@src/sdk/legacy/types.js';

import { bindLegacySdkConnection, getLegacySdkTransport, LegacySdkClientAdapter } from './legacySdkClientAdapter.js';
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

type OAuthProviderMock = Pick<NonNullable<AuthProviderTransport['oauthProvider']>, 'invalidateCredentials'>;

function createOAuthTransport(
  invalidateCredentials: OAuthProviderMock['invalidateCredentials'],
  tags?: string[],
): AuthProviderTransport {
  const transport = createTransport();
  Object.defineProperty(transport, 'oauthProvider', {
    configurable: true,
    enumerable: true,
    value: { invalidateCredentials } satisfies OAuthProviderMock,
  });
  transport.tags = tags;
  return transport;
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

    await expect(adapter.request({ id: 'request-2' as never, method: 'missing' })).rejects.toEqual(
      expect.objectContaining({ code: -32_601, message: expect.stringContaining('Method not found') }),
    );
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

  it('transitions a terminal post-authentication 401 to AwaitingOAuth without reconnecting', async () => {
    const staleClient = createClient();
    const invalidateCredentials = vi.fn().mockResolvedValue(undefined);
    const staleTransport = createOAuthTransport(invalidateCredentials, ['old']);
    const freshTransport = createOAuthTransport(invalidateCredentials, ['new']);
    const unauthorized = new StreamableHTTPError(401, 'Server returned 401 after successful authentication');
    vi.spyOn(staleClient, 'request').mockRejectedValue(unauthorized);
    vi.spyOn(staleClient, 'close').mockResolvedValue(undefined);
    const recreateHttpTransport = vi.fn().mockReturnValue(freshTransport);
    const adapter = new LegacySdkClientAdapter(staleClient, staleTransport, { recreateHttpTransport });
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

    await expect(adapter.request({ id: 'request-5' as never, method: 'tools/list' })).rejects.toEqual(
      expect.objectContaining({ code: 401, message: expect.stringContaining('Server returned 401') }),
    );

    expect(invalidateCredentials).toHaveBeenCalledWith('tokens');
    expect(staleClient.close).toHaveBeenCalledOnce();
    expect(recreateHttpTransport).toHaveBeenCalledWith(staleTransport, 'oauth-server');
    expect(getLegacySdkTransport(adapter)).toBe(freshTransport);
    expect(staleClient.request).toHaveBeenCalledOnce();
    expect(connection).toMatchObject({
      status: ClientStatus.AwaitingOAuth,
      tags: ['new'],
      authorizationUrl: undefined,
      oauthStartTime: undefined,
      lastError: { message: expect.stringContaining('Server returned 401') },
    });
  });

  it('coalesces concurrent terminal 401 recovery', async () => {
    const client = createClient();
    const invalidateCredentials = vi.fn().mockResolvedValue(undefined);
    const transport = createOAuthTransport(invalidateCredentials);
    const freshTransport = createTransport();
    const unauthorized = new StreamableHTTPError(401, 'Server returned 401 after successful authentication');
    vi.spyOn(client, 'request').mockRejectedValue(unauthorized);
    vi.spyOn(client, 'close').mockResolvedValue(undefined);
    const recreateHttpTransport = vi.fn().mockReturnValue(freshTransport);
    const adapter = new LegacySdkClientAdapter(client, transport, { recreateHttpTransport });
    const connection: OutboundConnection = {
      name: 'oauth-server',
      adapter,
      status: ClientStatus.Connected,
      tags: [],
      requiresOAuth: true,
    };
    bindLegacySdkConnection(adapter, connection);

    await Promise.allSettled([
      adapter.request({ id: 'request-6a' as never, method: 'tools/list' }),
      adapter.request({ id: 'request-6b' as never, method: 'tools/list' }),
    ]);

    expect(invalidateCredentials).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
    expect(recreateHttpTransport).toHaveBeenCalledOnce();
  });

  it('converts a non-terminal HTTP failure without attempting recovery', async () => {
    const client = createClient();
    const invalidateCredentials = vi.fn();
    const transport = createOAuthTransport(invalidateCredentials);
    vi.spyOn(client, 'request').mockRejectedValue(new StreamableHTTPError(403, 'Forbidden'));
    vi.spyOn(client, 'close').mockResolvedValue(undefined);
    const recreateHttpTransport = vi.fn();
    const adapter = new LegacySdkClientAdapter(client, transport, { recreateHttpTransport });

    await expect(adapter.request({ id: 'request-7' as never, method: 'tools/list' })).rejects.toBeInstanceOf(
      OneMcpProtocolError,
    );
    expect(invalidateCredentials).not.toHaveBeenCalled();
    expect(recreateHttpTransport).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
  });

  it('clones request and notification params before the SDK receives them', async () => {
    const client = createClient();
    const request = vi.spyOn(client, 'request').mockResolvedValue({ ok: true } as never);
    const notification = vi.spyOn(client, 'notification').mockResolvedValue(undefined);
    const adapter = new LegacySdkClientAdapter(client, createTransport());
    const params = { nested: { value: 'original' } };

    await adapter.request({ id: 'request-8' as never, method: 'tools/list', params });
    await adapter.notify({ method: 'notifications/initialized', params });
    params.nested.value = 'changed';

    expect(request).toHaveBeenCalledWith(
      { method: 'tools/list', params: { nested: { value: 'original' } } },
      expect.anything(),
      expect.anything(),
    );
    expect(notification).toHaveBeenCalledWith({
      method: 'notifications/initialized',
      params: { nested: { value: 'original' } },
    });
  });

  it('rejects schema objects before invoking the SDK client', async () => {
    const client = createClient();
    const request = vi.spyOn(client, 'request');
    const notification = vi.spyOn(client, 'notification');
    const adapter = new LegacySdkClientAdapter(client, createTransport());

    await expect(
      adapter.request({ id: 'request-9' as never, method: 'tools/list', params: CallToolRequestSchema as never }),
    ).rejects.toThrow('only Object.prototype and null-prototype objects are supported');
    await expect(
      adapter.notify({ method: 'notifications/test', params: CallToolRequestSchema as never }),
    ).rejects.toThrow('only Object.prototype and null-prototype objects are supported');
    expect(request).not.toHaveBeenCalled();
    expect(notification).not.toHaveBeenCalled();
  });
});
