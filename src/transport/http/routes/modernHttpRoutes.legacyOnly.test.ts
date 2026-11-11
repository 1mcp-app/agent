import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { LEGACY_PROTOCOL_REVISIONS } from '@src/gateway/contracts/protocolEra.js';

import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { setupModernHttpRoutes } from './modernHttpRoutes.js';

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'legacy-only-test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

function app(auth: RequestHandler = (_req, _res, next) => next()) {
  const instance = express();
  instance.use(express.json());
  const createBridge = vi.fn();
  setupModernHttpRoutes(
    instance,
    {} as never,
    [auth],
    createBridge,
    {
      allowsHost: () => true,
      allowsOrigin: (origin) => origin === undefined,
    },
    undefined,
    'legacy-only',
  );
  instance.all('/mcp', (_req, res) => res.status(299).json({ legacy: true }));
  return { instance, createBridge };
}

describe('legacy-only inbound HTTP', () => {
  it.each(['server/discover', 'tools/list', 'tools/call', 'subscriptions/listen', 'notifications/cancelled'])(
    'rejects modern %s before creating a bridge, even without a version header',
    async (method) => {
      const { instance, createBridge } = app();
      const response = await request(instance)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 41,
          method,
          params: { _meta: meta },
        });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        id: 41,
        error: {
          code: -32022,
          data: { supported: [...LEGACY_PROTOCOL_REVISIONS], requested: '2026-07-28' },
        },
      });
      expect(createBridge).not.toHaveBeenCalled();
    },
  );

  it('rejects modern envelopes on the retained SSE message path', async () => {
    const { instance, createBridge } = app();
    const response = await request(instance)
      .post('/messages')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { _meta: meta, name: 'remember' },
      });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(-32022);
    expect(createBridge).not.toHaveBeenCalled();
    expect((await request(instance).get('/sse').set('mcp-protocol-version', '2026-07-28')).body.error.code).toBe(
      -32022,
    );
  });

  it.each(['get', 'delete', 'post'] as const)('rejects a modern-pinned %s request', async (method) => {
    const { instance } = app();
    const response = await request(instance)
      [method]('/mcp')
      .set('mcp-protocol-version', '2026-07-28')
      .send(
        method === 'post' ? { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: meta } } : undefined,
      );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(-32022);
  });

  it.each([
    [{ jsonrpc: '2.0', id: { invalid: true }, method: 'tools/list', params: { _meta: meta } }, null, -32600],
    [
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
      },
      8,
      -32602,
    ],
  ])('keeps malformed modern input rejection and safe request IDs', async (body, id, code) => {
    const { instance } = app();
    const response = await request(instance).post('/mcp').set('mcp-protocol-version', '2026-07-28').send(body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ id, error: { code } });
  });

  it('keeps retained legacy initialization and session requests on the legacy route', async () => {
    const { instance } = app();
    expect(
      (
        await request(instance)
          .post('/mcp')
          .send({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
          })
      ).status,
    ).toBe(299);
    expect((await request(instance).get('/mcp').set('mcp-session-id', 'legacy-session')).status).toBe(299);
    expect((await request(instance).delete('/mcp').set('mcp-session-id', 'legacy-session')).status).toBe(299);
  });

  it.each([401, 403, 503])('preserves HTTP %s without SDK fallback', async (status) => {
    const seen: string[] = [];
    const { instance } = app((req, res) => {
      seen.push(req.body.method);
      res.status(status).json({ error: 'unavailable' });
    });
    const server = instance.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const client = new Client({ name: 'auto', version: '1' }, { versionNegotiation: { mode: 'auto' } });
    try {
      await expect(
        client.connect(
          new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)),
        ),
      ).rejects.toThrow();
      expect(seen).toEqual(['server/discover']);
    } finally {
      await client.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('preserves origin policy before the unsupported-era response', async () => {
    const { instance } = app();
    const response = await request(instance)
      .post('/mcp')
      .set('origin', 'https://untrusted.example')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: { _meta: meta },
      });
    expect(response.status).toBe(403);
    expect(response.body.error?.code).not.toBe(-32022);
  });
});
