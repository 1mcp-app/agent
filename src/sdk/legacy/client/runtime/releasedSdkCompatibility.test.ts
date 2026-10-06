import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { describe, expect, it, vi } from 'vitest';

const message = {
  jsonrpc: '2.0' as const,
  id: 0,
  method: 'tools/call',
  params: { name: 'echo', arguments: {}, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
};

function result() {
  return Response.json({ jsonrpc: '2.0', id: 0, result: { content: [] } });
}

describe('released SDK HTTP boundary', () => {
  it.each([
    ['https://peer.example/mcp', 'https://peer.example/final', true],
    ['http://peer.example/mcp', 'https://peer.example/final', true],
    ['https://peer.example/mcp', 'https://other.example/final', false],
    ['https://peer.example/mcp', 'https://peer.example:8443/final', false],
    ['http://peer.example:8080/mcp', 'https://peer.example/final', false],
    ['https://peer.example/mcp', 'http://peer.example/final', false],
  ])('preserves default redirect trust from %s to %s', async (source, target, allowed) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: target } }))
      .mockResolvedValueOnce(result());
    const transport = new StreamableHTTPClientTransport(new URL(source), {
      fetch,
      authProvider: { token: async () => 'private-token' },
    });
    await transport.start();
    transport.setProtocolVersion('2026-07-28');
    try {
      if (allowed) await expect(transport.send(message)).resolves.toBeUndefined();
      else await expect(transport.send(message)).rejects.toThrow(/not followed/);
      expect(fetch).toHaveBeenCalledTimes(allowed ? 2 : 1);
      expect(fetch.mock.calls[0][1].redirect).toBe('manual');
      if (allowed) expect(String(fetch.mock.calls[1][0])).toBe(target);
    } finally {
      await transport.close();
    }
  });

  it('gives managed authorization/session/protocol headers precedence over configured headers', async () => {
    const fetch = vi.fn(async (_input: string | URL, _init?: RequestInit) => result());
    const transport = new StreamableHTTPClientTransport(new URL('https://peer.example/mcp'), {
      fetch,
      authProvider: { token: async () => 'provider-token' },
      sessionId: 'managed-session',
      protocolVersion: '2026-07-28',
      requestInit: {
        headers: {
          authorization: 'Bearer stale-token',
          'mcp-session-id': 'stale-session',
          'mcp-protocol-version': '2025-11-25',
          'x-configured': 'retained',
        },
      },
    });
    await transport.start();
    try {
      await transport.send(message);
      const headers = new Headers(fetch.mock.calls[0][1]?.headers);
      expect(headers.get('authorization')).toBe('Bearer provider-token');
      expect(headers.get('mcp-session-id')).toBe('managed-session');
      expect(headers.get('mcp-protocol-version')).toBe('2026-07-28');
      expect(headers.get('x-configured')).toBe('retained');
    } finally {
      await transport.close();
    }
  });
});
