import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { SSE_WIRE_LIMIT_BYTES, SseWireLimitError } from '@src/transport/sseWireLimit.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { StreamableServeClient } from './serveClient.js';

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(function () {
    return {
      close: vi.fn().mockResolvedValue(undefined),
      onclose: undefined,
      onerror: undefined,
      onmessage: undefined,
      send: vi.fn().mockResolvedValue(undefined),
      start: vi.fn(),
    };
  }),
}));

describe('StreamableServeClient transport security', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('rejects redirects before sending proof-bearing initialize metadata', () => {
    new StreamableServeClient(new URL('https://runtime.example.com/mcp'), 'stream-session');

    expect(vi.mocked(StreamableHTTPClientTransport)).toHaveBeenCalledWith(
      new URL('https://runtime.example.com/mcp'),
      expect.objectContaining({
        requestInit: expect.objectContaining({ redirect: 'error' }),
      }),
    );
  });
  it('cancels oversized SSE, rejects the pending Tool, and prevents another fetch', async () => {
    const cancel = vi.fn();
    const delegate = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(SSE_WIRE_LIMIT_BYTES + 1).fill(120));
          },
          cancel,
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    vi.stubGlobal('fetch', delegate);
    const client = new StreamableServeClient(new URL('http://127.0.0.1/mcp'));
    const transport = vi.mocked(StreamableHTTPClientTransport).mock.results.at(-1)?.value;
    transport.close.mockImplementation(async () => transport.onclose?.());
    const call = client.callTool('write', {});
    const rejected = expect(call).rejects.toBeInstanceOf(SseWireLimitError);
    const options = vi.mocked(StreamableHTTPClientTransport).mock.calls.at(-1)?.[1];
    if (!options?.fetch) throw new Error('Missing bounded fetch');
    const response = await options.fetch('http://127.0.0.1/mcp');
    await expect(response.arrayBuffer()).rejects.toBeInstanceOf(SseWireLimitError);
    await rejected;
    expect(transport.close).toHaveBeenCalledOnce();
    expect(transport.send).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    await expect(options.fetch('http://127.0.0.1/mcp')).rejects.toBeInstanceOf(SseWireLimitError);
    expect(delegate).toHaveBeenCalledOnce();
  });
});
