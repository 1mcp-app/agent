import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from './apiClient.js';

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

function makeResponse(status: number, body: unknown, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'content-type' ? contentType : null) },
    json: async () => body,
  };
}

describe('ApiClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('makes a GET request with query params', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, { kind: 'servers', servers: [] }));

    const client = new ApiClient({ baseUrl: 'http://localhost:3050' });
    const response = await client.get('/api/inspect', { target: 'runner' });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ kind: 'servers', servers: [] });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3050/api/inspect?target=runner');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^1MCP\//);
    expect((init.headers as Record<string, string>)['Accept']).toBe('application/json');
  });

  it('includes Authorization header when bearerToken is provided', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, {}));

    const client = new ApiClient({ baseUrl: 'http://localhost:3050', bearerToken: 'my-token' });
    await client.get('/api/inspect');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-token');
  });

  it('returns error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(404, { error: 'Not found' }));

    const client = new ApiClient({ baseUrl: 'http://localhost:3050' });
    const response = await client.get('/api/inspect');

    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
    expect(response.error).toBe('Not found');
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const client = new ApiClient({ baseUrl: 'http://localhost:3050' });
    const response = await client.get('/api/inspect');

    expect(response.ok).toBe(false);
    expect(response.status).toBe(0);
    expect(response.error).toContain('ECONNREFUSED');
  });

  it('returns timeout error when request exceeds timeout', async () => {
    mockFetch.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => {
            const err = new Error('AbortError');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const client = new ApiClient({ baseUrl: 'http://localhost:3050', timeout: 50 });
    const response = await client.get('/api/inspect');

    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/timed out/i);
  });

  it('makes a POST request with JSON body', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, { result: 'ok' }));

    const client = new ApiClient({ baseUrl: 'http://localhost:3050' });
    const response = await client.post('/api/tools/call', { tool: 'echo', args: {} });

    expect(response.ok).toBe(true);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3050/api/tools/call');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ tool: 'echo', args: {} }));
  });

  it('strips trailing slash from baseUrl', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, {}));

    const client = new ApiClient({ baseUrl: 'http://localhost:3050/' });
    await client.get('/api/inspect');

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3050/api/inspect');
  });
});
