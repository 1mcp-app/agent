import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import errorHandler from '../middlewares/errorHandler.js';
import { bindDisconnectAbort, type ModernHttpRequestPolicy, setupModernHttpRoutes } from './modernHttpRoutes.js';

const { createBridge } = vi.hoisted(() => ({ createBridge: vi.fn() }));

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'route-test', version: '1' },
};

const loopbackPolicy: ModernHttpRequestPolicy = {
  allowsHost: (host) => /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/u.test(host ?? ''),
  allowsOrigin: (origin) => origin === undefined || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/u.test(origin),
};

function app(policy: ModernHttpRequestPolicy = loopbackPolicy) {
  const instance = express();
  instance.use(express.json());
  instance.use(errorHandler);
  const router = express.Router();
  setupModernHttpRoutes(router, {} as never, [(_req, _res, next) => next()], createBridge, policy);
  router.post('/mcp', (_req, res) => res.status(299).json({ legacy: true }));
  instance.use(router);
  return instance;
}

function modernPost(instance: express.Express, body: object) {
  return request(instance)
    .post('/mcp')
    .set('MCP-Protocol-Version', '2026-07-28')
    .set('Mcp-Method', (body as { method: string }).method)
    .send(body);
}

describe('modern HTTP admission', () => {
  beforeEach(() => {
    createBridge.mockReset();
  });

  it('serves server/discover without allocating a legacy session', async () => {
    const response = await modernPost(app(), {
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
      params: { _meta: modernMeta },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        resultType: 'complete',
        ttlMs: 0,
        cacheScope: 'private',
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
      },
    });
    expect(response.headers['mcp-session-id']).toBeUndefined();
    expect(createBridge).not.toHaveBeenCalled();
  });

  it('routes claim-less legacy requests onward unchanged', async () => {
    const response = await request(app())
      .post('/mcp')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      });

    expect(response.status).toBe(299);
    expect(response.body).toEqual({ legacy: true });
  });

  it('owns malformed modern traffic and returns exact version errors', async () => {
    const mismatch = await request(app())
      .post('/mcp')
      .set('MCP-Protocol-Version', '2026-07-28')
      .send({
        jsonrpc: '2.0',
        id: 'bad',
        method: 'tools/list',
        params: { _meta: { ...modernMeta, 'io.modelcontextprotocol/protocolVersion': '2025-11-25' } },
      });

    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toEqual({
      code: -32020,
      message:
        'Bad Request: the request headers and body disagree: the body envelope names protocol version 2025-11-25 but the MCP-Protocol-Version header names 2026-07-28',
      data: {
        mismatch: {
          header: '2026-07-28',
          body: 'the body envelope names protocol version 2025-11-25 but the MCP-Protocol-Version header names 2026-07-28',
        },
      },
    });
    expect(createBridge).not.toHaveBeenCalled();
  });

  it.each([
    ['protocolVersion', { ...modernMeta, 'io.modelcontextprotocol/protocolVersion': undefined }],
    ['clientCapabilities', { ...modernMeta, 'io.modelcontextprotocol/clientCapabilities': undefined }],
    ['clientInfo', { ...modernMeta, 'io.modelcontextprotocol/clientInfo': { name: 1 } }],
  ])('rejects a missing or invalid %s envelope value through the SDK ladder', async (_field, meta) => {
    const response = await request(app())
      .post('/mcp')
      .set('MCP-Protocol-Version', '2026-07-28')
      .set('Mcp-Method', 'tools/list')
      .send({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: { _meta: meta } });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(-32602);
    expect(response.body.error.data).toHaveProperty('envelope');
    expect(createBridge).not.toHaveBeenCalled();
  });

  it('rejects malformed modern JSON before legacy admission while preserving a JSON-RPC parse error', async () => {
    const response = await request(app())
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('MCP-Protocol-Version', '2026-07-28')
      .send('{');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  });

  it.each([undefined, '2025-11-25'])(
    'keeps retained legacy malformed JSON unchanged for version %s',
    async (version) => {
      let pending = request(app()).post('/mcp').set('Content-Type', 'application/json');
      if (version) pending = pending.set('MCP-Protocol-Version', version);
      const response = await pending.send('{');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: { code: -32603, message: 'Internal server error' } });
    },
  );

  it.each(['2026-07-28', '2099-01-01'])('owns malformed JSON for claimed modern version %s', async (version) => {
    const response = await request(app())
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('MCP-Protocol-Version', version)
      .send('{');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  });

  it.each([
    ['missing Mcp-Method', {}, -32020],
    ['unsupported version', { 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' }, -32022],
    ['wrong content type', { 'Content-Type': 'text/plain', 'Mcp-Method': 'tools/list' }, -32000],
  ])('returns the SDK wire error for %s', async (_case, overrides, expectedCode) => {
    const headers = {
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2026-07-28',
      ...overrides,
    };
    const meta = {
      ...modernMeta,
      'io.modelcontextprotocol/protocolVersion': headers['MCP-Protocol-Version'],
    };
    let pending = request(app()).post('/mcp');
    for (const [name, value] of Object.entries(headers)) pending = pending.set(name, value);
    const body = { jsonrpc: '2.0', id: 12, method: 'tools/list', params: { _meta: meta } };
    const response = await pending.send(headers['Content-Type'] === 'text/plain' ? JSON.stringify(body) : body);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.error.code).toBe(expectedCode);
    expect(createBridge).not.toHaveBeenCalled();
  });

  it.each([
    ['external host', { Host: 'attacker.example' }],
    ['external origin', { Origin: 'https://attacker.example' }],
  ])('rejects %s before constructing a bridge', async (_case, headers) => {
    let pending = modernPost(app(), {
      jsonrpc: '2.0',
      id: 11,
      method: 'server/discover',
      params: { _meta: modernMeta },
    });
    for (const [name, value] of Object.entries(headers)) pending = pending.set(name, value);
    const response = await pending;

    expect(response.status).toBe(403);
    expect(createBridge).not.toHaveBeenCalled();
  });

  it('allows an explicit loopback Origin', async () => {
    const response = await modernPost(app(), {
      jsonrpc: '2.0',
      id: 13,
      method: 'server/discover',
      params: { _meta: modernMeta },
    }).set('Origin', 'http://localhost:3000');

    expect(response.status).toBe(200);
  });

  it('allows only the configured external host and Origin pair', async () => {
    const policy: ModernHttpRequestPolicy = {
      allowsHost: (host) => host === 'mcp.example.com',
      allowsOrigin: (origin, host) =>
        origin === undefined || (host === 'mcp.example.com' && origin === 'https://mcp.example.com'),
    };
    const body = { jsonrpc: '2.0', id: 14, method: 'server/discover', params: { _meta: modernMeta } };
    const allowed = await modernPost(app(policy), body)
      .set('Host', 'mcp.example.com')
      .set('Origin', 'https://mcp.example.com');
    const rejected = await modernPost(app(policy), { ...body, params: { _meta: { ...modernMeta } } })
      .set('Host', 'mcp.example.com')
      .set('Origin', 'https://other.example.com');

    expect(allowed.status).toBe(200);
    expect(rejected.status).toBe(403);
  });

  it('removes every disconnect listener after normal cleanup and repeated cleanup', () => {
    const req = new EventEmitter() as EventEmitter & { socket: EventEmitter };
    req.socket = new EventEmitter();
    const res = new EventEmitter();
    const binding = bindDisconnectAbort(req as never, res as never);

    expect(req.listenerCount('aborted')).toBe(1);
    expect(res.listenerCount('close')).toBe(1);
    expect(req.socket.listenerCount('close')).toBe(1);
    binding.cleanup();
    binding.cleanup();
    expect(req.listenerCount('aborted')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
    expect(req.socket.listenerCount('close')).toBe(0);
  });

  it('dispatches tools/list through a request-private gateway bridge and emits no session id', async () => {
    const close = vi.fn(async () => undefined);
    const outbound = {
      role: 'outbound' as const,
      pin: Object.freeze({ era: 'legacy' as const, revision: '2025-11-25' }),
      request: vi.fn(async () => ({ tools: [{ name: 'one', inputSchema: { type: 'object' } }] })),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    createBridge.mockResolvedValueOnce({ targetConnectionId: 'private-bridge', outbound, close });

    const response = await modernPost(app(), {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: { _meta: modernMeta },
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      resultType: 'complete',
      ttlMs: 0,
      cacheScope: 'private',
      tools: [{ name: 'one' }],
    });
    expect(response.headers['mcp-session-id']).toBeUndefined();
    expect(outbound.request).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('maps bridge creation and gateway protocol failures through the v2 error funnel', async () => {
    createBridge.mockRejectedValueOnce(new Error('bridge unavailable'));
    const unavailable = await modernPost(app(), {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/list',
      params: { _meta: { ...modernMeta } },
    });
    expect(unavailable.status).toBe(200);
    expect(unavailable.body.error).toMatchObject({ code: -32603, message: 'bridge unavailable' });

    const close = vi.fn(async () => undefined);
    createBridge.mockResolvedValueOnce({
      targetConnectionId: 'failure-bridge',
      outbound: {
        role: 'outbound',
        pin: Object.freeze({ era: 'legacy', revision: '2025-11-25' }),
        request: async () => {
          throw { code: -32602, message: 'Invalid tool arguments', data: { field: 'name' } };
        },
        cancel: async () => undefined,
        close: async () => undefined,
      },
      close,
    });
    const invalid = await modernPost(app(), {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/list',
      params: { _meta: { ...modernMeta } },
    });
    expect(invalid.body.error).toMatchObject({
      code: -32602,
      message: 'Invalid tool arguments',
      data: { field: 'name' },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('dispatches direct tools/call through the gateway and validates Mcp-Name exactly', async () => {
    const close = vi.fn(async () => undefined);
    const outbound = {
      role: 'outbound' as const,
      pin: Object.freeze({ era: 'legacy' as const, revision: '2025-11-25' }),
      request: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    createBridge.mockResolvedValueOnce({ targetConnectionId: 'private-call', outbound, close });
    const body = {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'echo', arguments: {}, _meta: modernMeta },
    };

    const response = await modernPost(app(), body).set('Mcp-Name', 'echo');
    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      resultType: 'complete',
      content: [{ type: 'text', text: 'ok' }],
    });
    expect(outbound.request).toHaveBeenCalledTimes(1);

    const mismatch = await modernPost(app(), {
      ...body,
      params: { ...body.params, _meta: { ...modernMeta } },
    }).set('Mcp-Name', 'other');
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toEqual({
      code: -32020,
      message:
        'Bad Request: the request headers and body disagree: the body carries params.name="echo" but the Mcp-Name header names "other"',
      data: {
        mismatch: {
          header: 'other',
          body: 'the body carries params.name="echo" but the Mcp-Name header names "other"',
        },
      },
    });
    expect(createBridge).toHaveBeenCalledTimes(1);
  });

  it('supports request-scoped SSE without enabling GET or redelivery semantics', async () => {
    const response = await modernPost(app(), {
      jsonrpc: '2.0',
      id: 3,
      method: 'server/discover',
      params: { _meta: modernMeta },
    }).set('Accept', 'text/event-stream');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('event: message');
    expect(response.text).toContain('"supportedVersions":["2026-07-28"]');
    expect((await request(app()).get('/mcp').set('MCP-Protocol-Version', '2026-07-28')).status).toBe(404);
  });

  it('cancels and closes a long-running request when the response socket closes', async () => {
    let settleRequest!: (value: object) => void;
    const close = vi.fn(async () => undefined);
    const cancel = vi.fn(async () => settleRequest({ tools: [] }));
    const outbound = {
      role: 'outbound' as const,
      pin: Object.freeze({ era: 'legacy' as const, revision: '2025-11-25' }),
      request: vi.fn(
        () =>
          new Promise<object>((resolve) => {
            settleRequest = resolve;
          }),
      ),
      cancel,
      close: vi.fn(async () => undefined),
    };
    createBridge.mockResolvedValueOnce({ targetConnectionId: 'cancel-bridge', outbound, close });
    const instance = app();
    const server = await new Promise<ReturnType<express.Express['listen']>>((resolve) => {
      const listening = instance.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/list',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 30, method: 'tools/list', params: { _meta: modernMeta } }),
    });

    try {
      await vi.waitFor(() => expect(outbound.request).toHaveBeenCalledTimes(1));
      controller.abort();
      await expect(pending).rejects.toThrow();
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    } finally {
      settleRequest({ tools: [] });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('serves discovery, identity, list, and call to the real pinned v2 client', async () => {
    createBridge.mockImplementation(async () => ({
      targetConnectionId: 'real-client-bridge',
      outbound: {
        role: 'outbound',
        pin: Object.freeze({ era: 'legacy', revision: '2025-11-25' }),
        request: async ({ operation }: { operation: string }) =>
          operation === 'tools/list'
            ? { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] }
            : { content: [{ type: 'text', text: 'ok' }] },
        cancel: async () => undefined,
        close: async () => undefined,
      },
      close: async () => undefined,
    }));
    const instance = app();
    const server = await new Promise<ReturnType<express.Express['listen']>>((resolve) => {
      const listening = instance.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const { port } = server.address() as AddressInfo;
    const client = new Client(
      { name: 'real-v2-test', version: '1' },
      { capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );

    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      expect(client.getServerVersion()).toEqual({ name: '1mcp', version: expect.any(String) });
      expect((await client.listTools()).tools).toEqual([expect.objectContaining({ name: 'echo' })]);
      expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
        content: [{ type: 'text', text: 'ok' }],
      });
    } finally {
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
