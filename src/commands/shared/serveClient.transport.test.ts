import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { describe, expect, it, vi } from 'vitest';

import { StreamableServeClient } from './serveClient.js';

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(function () {
    return {
      close: vi.fn(),
      onclose: undefined,
      onerror: undefined,
      onmessage: undefined,
      send: vi.fn(),
      start: vi.fn(),
    };
  }),
}));

describe('StreamableServeClient transport security', () => {
  it('rejects redirects before sending proof-bearing initialize metadata', () => {
    new StreamableServeClient(new URL('https://runtime.example.com/mcp'), 'stream-session');

    expect(vi.mocked(StreamableHTTPClientTransport)).toHaveBeenCalledWith(
      new URL('https://runtime.example.com/mcp'),
      expect.objectContaining({
        requestInit: expect.objectContaining({ redirect: 'error' }),
      }),
    );
  });
});
