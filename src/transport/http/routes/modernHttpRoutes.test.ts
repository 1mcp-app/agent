import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { EventEmitter, once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';

import * as templateContextAuthority from '@src/transport/http/utils/templateContextAuthority.js';
import { type CatalogCursorOwner, isCatalogCursorOwnerCurrent } from '@src/core/capabilities/capabilityCatalog.js';
import { isResourceRouteOwnerActive, type ResourceRouteOwner } from '@src/core/capabilities/capabilityVisibility.js';
import {
  MAX_RUNTIME_CATALOG_SCOPES,
  RUNTIME_CATALOG_SCOPE_TTL_MS,
} from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { authorizeTemplateContext, createTemplateContextProof } from '@src/core/context/templateContextTrust.js';

import express from 'express';
import request, { type Response as HttpTestResponse } from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import * as bindings from './modernInteractionBinding.js';
import errorHandler from '../middlewares/errorHandler.js';
import {
  bindDisconnectAbort,
  type ModernHttpRequestPolicy,
  setupModernHttpRoutes,
  writeWebResponse,
} from './modernHttpRoutes.js';
import { setupStreamableHttpRoutes } from './streamableHttpRoutes.js';

const { createBridge } = vi.hoisted(() => ({ createBridge: vi.fn() }));

// These transport tests supply private bridges independently of provider catalogs.
// Catalog admission and header fences use real peers in modernHttpRoutes.paramHeaders.test.ts.
vi.mock('./modernToolHeaderRegistry.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./modernToolHeaderRegistry.js')>()),
  resolveModernToolHeaderRegistry: vi.fn(async () => undefined),
}));

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
  setupModernHttpRoutes(
    router,
    { registerCleanup: vi.fn(), getClients: () => new Map() } as never,
    [(_req, _res, next) => next()],
    createBridge,
    policy,
  );
  router.post('/mcp', (_req, res) => res.status(299).json({ legacy: true }));
  instance.use(router);
  return instance;
}

const requestServers = new Map<express.Express, Server>();

async function ensureListening(instance: express.Express): Promise<Server> {
  let server = requestServers.get(instance);
  if (!server) {
    // Reserve the same IPv4 address Supertest connects to, including on Darwin.
    server = instance.listen(0, '127.0.0.1');
    requestServers.set(instance, server);
  }
  if (!server.listening) await once(server, 'listening');
  return server;
}

afterEach(async () => {
  try {
    const servers = [...requestServers.values()].filter((server) => server.listening);
    for (const server of servers) server.closeAllConnections();
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
      ),
    );
    for (const server of requestServers.values()) expect(server.listening).toBe(false);
  } finally {
    requestServers.clear();
  }
});

function modernPost(instance: Server | string, body: object) {
  return request(instance)
    .post('/mcp')
    .set('MCP-Protocol-Version', '2026-07-28')
    .set('Mcp-Method', (body as { method: string }).method)
    .send(body);
}

describe('modern HTTP admission', () => {
  it('reserves its IPv4 listener against a competing fixture and preserves modern dispatch', async () => {
    const instance = app();
    const server = await ensureListening(instance);
    const address = server.address() as AddressInfo;
    expect(address).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
    const contender = express().listen(address.port, '127.0.0.1');
    try {
      await expect(once(contender, 'listening')).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(contender.listening).toBe(false);
    } finally {
      if (contender.listening) await new Promise<void>((resolve) => contender.close(() => resolve()));
    }
    const response = await modernPost(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
      params: { _meta: modernMeta },
    });
    expect(response.status).toBe(200);
    expect(response.body.result.supportedVersions).toEqual(['2026-07-28']);
    expect(await ensureListening(instance)).toBe(server);
  });

  it('rejects a signed frontend proof paired with backend context before modern dispatch', async () => {
    const context = { project: { path: '/work/frontend' }, user: {}, environment: {}, sessionId: 'session-a' };
    const capability = {
      version: 1 as const,
      runtimeScopeId: 'scope-a',
      secret: Buffer.alloc(32, 7).toString('base64url'),
    };
    const proof = createTemplateContextProof(context, capability);
    const authorize = vi
      .spyOn(templateContextAuthority, 'authorizeRequestTemplateContext')
      .mockImplementation((input) => authorizeTemplateContext({ ...input, mode: 'verified', capability }));
    try {
      const response = await request(await ensureListening(app()))
        .post('/mcp')
        .set('MCP-Protocol-Version', '2026-07-28')
        .set('Mcp-Method', 'tools/call')
        .set('mcp-session-id', 'session-a')
        .send({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'checkout_source',
            arguments: {},
            _meta: { ...modernMeta, context: { ...context, project: { path: '/work/backend' } }, contextProof: proof },
          },
        });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        jsonrpc: '2.0',
        id: 3,
        error: { code: -32602, message: 'Request context proof rejected' },
      });
      expect(createBridge).not.toHaveBeenCalled();
      expect(authorize).toHaveBeenCalledOnce();
    } finally {
      authorize.mockRestore();
    }
  });

  it('rejects a malformed explicit proof without allocating a modern bridge', async () => {
    const response = await modernPost(await ensureListening(app()), {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'checkout_source', arguments: {}, _meta: { ...modernMeta, contextProof: null } },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({ code: -32602, message: 'Request context proof rejected' });
    expect(createBridge).not.toHaveBeenCalled();
  });
  it.each(['post', 'get', 'delete'] as const)('rejects malformed Host authorities on %s', async (method) => {
    const instance = app();
    const response = await request(await ensureListening(instance))
      [method]('/mcp')
      .set('Host', 'a b')
      .set('MCP-Protocol-Version', '2026-07-28')
      .send(
        method === 'post'
          ? { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: modernMeta } }
          : undefined,
      );
    expect(response.status).toBe(403);
  });

  it('treats premature stream closure as a completed disconnect', async () => {
    const sink = Object.assign(
      new Writable({
        write(_chunk, _encoding, done) {
          this.destroy();
          done();
        },
      }),
      {
        status: vi.fn(),
        setHeader: vi.fn(),
      },
    );
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event'));
      },
    });
    await expect(writeWebResponse(new Response(body), sink as unknown as express.Response)).resolves.toBeUndefined();
  });

  it.each([undefined, 'ERR_STREAM_PREMATURE_CLOSE'])(
    'preserves source stream error %s when pipeline destroys the response',
    async (code) => {
      const failure = Object.assign(new Error('source stream failed'), { code });
      const sink = Object.assign(
        new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        }),
        {
          status: vi.fn(),
          setHeader: vi.fn(),
        },
      );
      const body = new ReadableStream({
        start(controller) {
          controller.error(failure);
        },
      });
      await expect(writeWebResponse(new Response(body), sink as unknown as express.Response)).rejects.toBe(failure);
    },
  );
  beforeEach(() => {
    createBridge.mockReset();
  });

  it('serves server/discover without allocating a legacy session', async () => {
    const response = await modernPost(await ensureListening(app()), {
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
        capabilities: {
          tools: {},
          prompts: {},
          resources: {},
          completions: {},
        },
      },
    });
    expect(response.headers['mcp-session-id']).toBeUndefined();
    expect(response.body.result.capabilities.extensions).toBeUndefined();
    expect(response.body.result.capabilities.resources.subscribe).toBeUndefined();
    expect(response.body.result.capabilities.resources.listChanged).toBeUndefined();
    expect(createBridge).not.toHaveBeenCalled();
  });

  it('routes claim-less legacy requests onward unchanged', async () => {
    const response = await request(await ensureListening(app()))
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
    const mismatch = await request(await ensureListening(app()))
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
    const response = await request(await ensureListening(app()))
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
    const response = await request(await ensureListening(app()))
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
      let pending = request(await ensureListening(app()))
        .post('/mcp')
        .set('Content-Type', 'application/json');
      if (version) pending = pending.set('MCP-Protocol-Version', version);
      const response = await pending.send('{');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: { code: -32603, message: 'Internal server error' } });
    },
  );

  it.each(['2026-07-28', '2099-01-01'])('owns malformed JSON for claimed modern version %s', async (version) => {
    const response = await request(await ensureListening(app()))
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
    let pending = request(await ensureListening(app())).post('/mcp');
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
    let pending = modernPost(await ensureListening(app()), {
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
    const response = await modernPost(await ensureListening(app()), {
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
    const allowed = await modernPost(await ensureListening(app(policy)), body)
      .set('Host', 'mcp.example.com')
      .set('Origin', 'https://mcp.example.com');
    const rejected = await modernPost(await ensureListening(app(policy)), {
      ...body,
      params: { _meta: { ...modernMeta } },
    })
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

    const response = await modernPost(await ensureListening(app()), {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: { cursor: 'next-page', _meta: modernMeta },
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
    expect(outbound.request).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'tools/list', params: { cursor: 'next-page' } }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  async function resourceOwnerListener(
    operation: 'resources/read' | 'tools/call' = 'resources/read',
    lazyEnabled = true,
  ) {
    const instance = express();
    instance.use(express.json());
    const cleanups: Array<() => Promise<void>> = [];
    setupModernHttpRoutes(
      instance as never,
      {
        registerCleanup: (cleanup: () => Promise<void>) => cleanups.push(cleanup),
        getLazyLoadingOrchestrator: () => (operation === 'tools/call' ? { isEnabled: () => lazyEnabled } : undefined),
        getClients: () => new Map(),
      } as never,
      [
        (req, res, next) => {
          const token = req.get('x-test-verified-token');
          if (token)
            res.locals.auth = {
              token,
              clientId: 'same-client',
              grantedScopes: (req.get('x-test-verified-grant') ?? 'safe').split(','),
              grantedTags: ['safe'],
            };
          next();
        },
      ],
      createBridge,
      loopbackPolicy,
    );
    createBridge.mockImplementation(async () => ({
      targetConnectionId: 'private-resource',
      close: vi.fn(async () => undefined),
      outbound: {
        role: 'outbound',
        pin: { era: 'legacy', revision: '2025-11-25' },
        request: vi.fn(async () =>
          operation === 'resources/read'
            ? { contents: [{ uri: 'file:///value', text: 'value' }] }
            : { content: [{ type: 'text', text: 'ok' }] },
        ),
        cancel: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      },
    }));
    const server = await ensureListening(instance);
    const post = (token?: string, grant?: string, target: Server | string = server) => {
      const pending = modernPost(target, {
        jsonrpc: '2.0',
        id: 'resource',
        method: operation,
        params:
          operation === 'resources/read'
            ? { uri: 'file:///value', _meta: modernMeta }
            : { name: 'tool_list', arguments: { limit: 1 }, _meta: modernMeta },
      }).set('Mcp-Name', operation === 'resources/read' ? 'file:///value' : 'tool_list');
      if (token) pending.set('x-test-verified-token', token);
      if (grant) pending.set('x-test-verified-grant', grant);
      return pending;
    };
    return { instance, post, cleanups };
  }

  it('preserves provider-binding discovery and does not mint cursor authority when lazy mode is disabled', async () => {
    const binding = vi.spyOn(bindings, 'createModernInteractionBinding').mockResolvedValue(undefined);
    const listener = await resourceOwnerListener('tools/call', false);
    try {
      await listener.post('token-a');
      expect(binding).toHaveBeenCalledOnce();
      expect(createBridge.mock.calls.at(-1)?.[2]).not.toHaveProperty('catalogCursorOwner');
    } finally {
      await Promise.all(listener.cleanups.map((cleanup) => cleanup()));
      binding.mockRestore();
    }
  });

  it('keeps native cursor owners private, listener-local, grant-separated and revoked by cleanup', async () => {
    const binding = vi.spyOn(bindings, 'createModernInteractionBinding').mockResolvedValue(undefined);
    const first = await resourceOwnerListener('tools/call');
    const second = await resourceOwnerListener('tools/call');
    try {
      await first.post('token-a', 'safe,other');
      await first.post('token-a', 'other,safe');
      await first.post('token-b', 'safe,other');
      await first.post('token-a', 'narrow');
      await first.post();
      await first.post();
      expect(binding).not.toHaveBeenCalled();
      const owners = createBridge.mock.calls.map((call) => call[2].catalogCursorOwner as CatalogCursorOwner);
      expect(owners[1]).toBe(owners[0]);
      expect(owners[2]).not.toBe(owners[0]);
      expect(owners[3]).not.toBe(owners[0]);
      expect(owners[5]).toBe(owners[4]);
      await second.post('token-a', 'safe,other');
      const foreignOwner = createBridge.mock.calls.at(-1)?.[2].catalogCursorOwner as CatalogCursorOwner;
      expect(foreignOwner).not.toBe(owners[0]);
      expect(createBridge.mock.calls.every((call) => !('catalogCursorOwner' in call[1]))).toBe(true);
      await Promise.all(first.cleanups.map((cleanup) => cleanup()));
      expect(owners.every((owner) => !isCatalogCursorOwnerCurrent(owner))).toBe(true);
      expect(isCatalogCursorOwnerCurrent(foreignOwner)).toBe(true);
      const count = createBridge.mock.calls.length;
      expect((await first.post('token-a')).body.error.message).toBe('Capability cursor owner is unavailable');
      expect(createBridge).toHaveBeenCalledTimes(count);
    } finally {
      await Promise.all(second.cleanups.map((cleanup) => cleanup()));
      binding.mockRestore();
    }
  });

  it('expires native cursor authority from issuance despite repeated requests and reclaims bounded owner capacity', async () => {
    const binding = vi.spyOn(bindings, 'createModernInteractionBinding').mockResolvedValue(undefined);
    vi.useFakeTimers({ toFake: ['Date'] });
    const listener = await resourceOwnerListener('tools/call');
    // Keep one HTTP listener alive across the capacity loop, as in production;
    // posting the Express app directly would allocate and close a server per call.
    const server = await ensureListening(listener.instance);
    const requestPorts: number[] = [];
    let listenerCloses = 0;
    server.on('request', (incoming) => requestPorts.push(incoming.socket.localPort!));
    server.on('close', () => listenerCloses++);
    try {
      const { port } = server.address() as AddressInfo;
      const post = (token: string) =>
        listener
          .post(token, undefined, `http://127.0.0.1:${port}`)
          .on('response', (response: HttpTestResponse) => {
            if (response.body?.result === undefined && response.body?.error === undefined)
              console.info(
                'OWNED-CURSOR-WIRE',
                JSON.stringify({
                  status: response.status,
                  contentType: response.headers['content-type'],
                  body: response.body,
                  text: response.text,
                }),
              );
          })
          .on('error', (error: Error & { code?: string; status?: number }) => {
            console.info(
              'OWNED-CURSOR-REQUEST-ERROR',
              JSON.stringify({ message: error.message, code: error.code, status: error.status }),
            );
          });
      await post('token-a');
      const owner = createBridge.mock.calls.at(-1)?.[2].catalogCursorOwner as CatalogCursorOwner;
      vi.setSystemTime(Date.now() + RUNTIME_CATALOG_SCOPE_TTL_MS - 1);
      await post('token-a');
      expect(createBridge.mock.calls.at(-1)?.[2].catalogCursorOwner).toBe(owner);
      vi.setSystemTime(Date.now() + 1);
      await post('token-a');
      expect(isCatalogCursorOwnerCurrent(owner)).toBe(false);
      expect(createBridge.mock.calls.at(-1)?.[2].catalogCursorOwner).not.toBe(owner);
      for (let i = 1; i < MAX_RUNTIME_CATALOG_SCOPES; i++) await post(`token-${i}`);
      const count = createBridge.mock.calls.length;
      expect((await post('overflow')).body.error.message).toBe('Capability cursor owner capacity exceeded');
      expect(createBridge).toHaveBeenCalledTimes(count);
      vi.setSystemTime(Date.now() + RUNTIME_CATALOG_SCOPE_TTL_MS);
      expect((await post('recovered')).body.error).toBeUndefined();
      expect(server.listening).toBe(true);
      expect(listenerCloses).toBe(0);
      expect(requestPorts).toHaveLength(MAX_RUNTIME_CATALOG_SCOPES + 4);
      expect(new Set(requestPorts)).toEqual(new Set([port]));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await Promise.all(listener.cleanups.map((cleanup) => cleanup()));
      vi.useRealTimers();
      binding.mockRestore();
      expect(server.listening).toBe(false);
      expect(listenerCloses).toBe(1);
    }
  });

  it('mints listener-owned resource authority per verified token and grant, and revokes it through manager cleanup', async () => {
    const binding = vi.spyOn(bindings, 'createModernInteractionBinding').mockResolvedValue(undefined);
    try {
      const first = await resourceOwnerListener();
      await first.post('token-a', 'safe,other');
      await first.post('token-a', 'other,safe');
      await first.post('token-b', 'safe,other');
      await first.post('token-a', 'narrow');
      await first.post();
      await first.post();
      const owners = createBridge.mock.calls.map((call) => call[2].resourceOwner as ResourceRouteOwner);
      expect(owners[1]).toBe(owners[0]);
      expect(owners[2]).not.toBe(owners[0]);
      expect(owners[3]).not.toBe(owners[0]);
      expect(owners[5]).toBe(owners[4]);
      expect(owners[4]).not.toBe(owners[0]);
      expect(binding.mock.calls[0].at(-1)).toBe(owners[0]);
      const second = await resourceOwnerListener();
      await second.post('token-a', 'safe,other');
      const foreignOwner = createBridge.mock.calls.at(-1)?.[2].resourceOwner as ResourceRouteOwner;
      expect(foreignOwner).not.toBe(owners[0]);
      await Promise.all(first.cleanups.map((cleanup) => cleanup()));
      expect(owners.every((owner) => !isResourceRouteOwnerActive(owner))).toBe(true);
      expect(isResourceRouteOwnerActive(foreignOwner)).toBe(true);
      const bridgeCount = createBridge.mock.calls.length;
      expect((await first.post('token-a')).body.error.message).toBe('Resource route owner is unavailable');
      expect(createBridge).toHaveBeenCalledTimes(bridgeCount);
      await Promise.all(second.cleanups.map((cleanup) => cleanup()));
    } finally {
      binding.mockRestore();
    }
  });

  it('bounds retained verified owners and reclaims idle owner capacity at the existing TTL', async () => {
    const binding = vi.spyOn(bindings, 'createModernInteractionBinding').mockResolvedValue(undefined);
    vi.useFakeTimers({ toFake: ['Date'] });
    const listener = await resourceOwnerListener();
    const server = await ensureListening(listener.instance);
    try {
      const address = server.address() as AddressInfo;
      const post = (token: string) => listener.post(token, undefined, `http://127.0.0.1:${address.port}`);
      for (let index = 0; index < MAX_RUNTIME_CATALOG_SCOPES; index++) {
        const response = await post(`verified-${index}`);
        expect(response.body.error).toBeUndefined();
      }
      const original = createBridge.mock.calls[0][2].resourceOwner as ResourceRouteOwner;
      expect((await post('overflow')).body.error.message).toBe('Resource route owner capacity exceeded');
      expect(createBridge).toHaveBeenCalledTimes(MAX_RUNTIME_CATALOG_SCOPES);
      vi.setSystemTime(Date.now() + RUNTIME_CATALOG_SCOPE_TTL_MS);
      expect((await post('recovered')).body.error).toBeUndefined();
      expect(isResourceRouteOwnerActive(original)).toBe(false);
    } finally {
      await Promise.all(listener.cleanups.map((cleanup) => cleanup()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      binding.mockRestore();
      vi.useRealTimers();
    }
  });

  it('preserves anonymous request capabilities and log levels without inheriting them across requests', async () => {
    const capabilities = { roots: { listChanged: true }, sampling: {}, elicitation: { form: {} } };
    const outbound = {
      role: 'outbound' as const,
      pin: Object.freeze({ era: 'legacy' as const, revision: '2025-11-25' }),
      request: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const firstClose = vi.fn(async () => undefined);
    const secondClose = vi.fn(async () => undefined);
    createBridge.mockResolvedValueOnce({ targetConnectionId: 'first-private-call', outbound, close: firstClose });
    createBridge.mockResolvedValueOnce({ targetConnectionId: 'second-private-call', outbound, close: secondClose });
    const instance = app();
    const first = await modernPost(await ensureListening(instance), {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: {
        name: 'echo',
        arguments: {},
        _meta: {
          ...modernMeta,
          'io.modelcontextprotocol/clientCapabilities': capabilities,
          'io.modelcontextprotocol/logLevel': 'warning',
          'untrusted-business-meta': 'do not forward',
        },
      },
    }).set('Mcp-Name', 'echo');
    const second = await modernPost(await ensureListening(instance), {
      jsonrpc: '2.0',
      id: 31,
      method: 'tools/call',
      params: { name: 'echo', arguments: {}, _meta: modernMeta },
    }).set('Mcp-Name', 'echo');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.result.resultType).toBe('complete');
    expect(second.body.result.resultType).toBe('complete');
    expect(first.headers['mcp-session-id']).toBeUndefined();
    expect(second.headers['mcp-session-id']).toBeUndefined();
    expect(createBridge).toHaveBeenCalledTimes(2);
    expect(createBridge.mock.calls[0][2]).toEqual({ capabilities, logLevel: 'warning' });
    expect(createBridge.mock.calls[1][2]).toEqual({ capabilities: {}, logLevel: undefined });
    for (const [, , options] of createBridge.mock.calls) {
      expect(options).not.toHaveProperty('interaction');
    }
    expect(Object.isFrozen(createBridge.mock.calls[0][2].capabilities)).toBe(true);
    expect(outbound.request).toHaveBeenCalledTimes(2);
    for (const call of [1, 2]) {
      expect(outbound.request).toHaveBeenNthCalledWith(
        call,
        expect.objectContaining({ operation: 'tools/call', params: { name: 'echo', arguments: {} } }),
      );
    }
    expect(firstClose).toHaveBeenCalledOnce();
    expect(secondClose).toHaveBeenCalledOnce();
  });

  it('rejects anonymous requestState before allocating a bridge even with interaction capabilities', async () => {
    const response = await modernPost(await ensureListening(app()), {
      jsonrpc: '2.0',
      id: 32,
      method: 'tools/call',
      params: {
        name: 'echo',
        arguments: {},
        requestState: 'opaque-state',
        _meta: {
          ...modernMeta,
          'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } },
        },
      },
    }).set('Mcp-Name', 'echo');

    expect(response.status).toBe(200);
    expect(response.body.error).toMatchObject({ code: -32602, message: 'Interaction continuation rejected' });
    expect(createBridge).not.toHaveBeenCalled();
  });

  it('maps bridge creation and gateway protocol failures through the v2 error funnel', async () => {
    createBridge.mockRejectedValueOnce(new Error('bridge unavailable'));
    const unavailable = await modernPost(await ensureListening(app()), {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/list',
      params: { _meta: { ...modernMeta } },
    });
    expect(unavailable.status).toBe(200);
    expect(unavailable.body.error).toMatchObject({ code: -32603, message: 'Gateway internal failure' });

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
    const invalid = await modernPost(await ensureListening(app()), {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/list',
      params: { _meta: { ...modernMeta } },
    });
    expect(invalid.body.error).toMatchObject({
      code: -32602,
      message: 'Gateway transport failure',
      data: { 'app.1mcp/failure': { code: '-32602', kind: 'transport' } },
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

    const response = await modernPost(await ensureListening(app()), body).set('Mcp-Name', 'echo');
    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      resultType: 'complete',
      content: [{ type: 'text', text: 'ok' }],
    });
    expect(outbound.request).toHaveBeenCalledTimes(1);
    expect(outbound.request).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'tools/call', params: { name: 'echo', arguments: {} } }),
    );

    const mismatch = await modernPost(await ensureListening(app()), {
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
    const response = await modernPost(await ensureListening(app()), {
      jsonrpc: '2.0',
      id: 3,
      method: 'server/discover',
      params: { _meta: modernMeta },
    }).set('Accept', 'text/event-stream');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('event: message');
    expect(response.text).toContain('"supportedVersions":["2026-07-28"]');
    const unsupportedGet = await request(await ensureListening(app()))
      .get('/mcp')
      .set('MCP-Protocol-Version', '2026-07-28');
    expect(unsupportedGet.status).toBe(405);
    expect(unsupportedGet.body).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'Method not allowed.' },
    });
  });

  it.each(['get', 'delete'] as const)(
    'owns modern %s before real legacy streamable routes and never touches the legacy session',
    async (method) => {
      const instance = express();
      instance.use(express.json());
      instance.use(errorHandler);
      const router = express.Router();
      const pass = (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
      setupModernHttpRoutes(
        router,
        { registerCleanup: vi.fn(), getClients: () => new Map() } as never,
        [pass],
        createBridge,
        loopbackPolicy,
      );
      const legacyLifecycle = {
        resolveExistingSession: vi.fn(),
        completeExplicitDelete: vi.fn(),
      };
      setupStreamableHttpRoutes(
        router,
        {} as never,
        {} as never,
        pass,
        undefined,
        undefined,
        undefined,
        legacyLifecycle as never,
      );
      instance.use(router);

      const response = await request(await ensureListening(instance))
        [method]('/mcp')
        .set('MCP-Protocol-Version', '2026-07-28')
        .set('Mcp-Session-Id', 'legacy-session-that-must-not-be-used');

      expect(response.status).toBe(405);
      expect(response.body).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: 'Method not allowed.' },
      });
      expect(legacyLifecycle.resolveExistingSession).not.toHaveBeenCalled();
      expect(legacyLifecycle.completeExplicitDelete).not.toHaveBeenCalled();
      expect(createBridge).not.toHaveBeenCalled();
    },
  );

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
    const server = await ensureListening(instance);
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

  it('serves mixed capability kinds and operations to the real pinned v2 client', async () => {
    const tool = { name: 'echo', title: 'Echo title', inputSchema: { type: 'object' }, 'example.com/data': [1] };
    const prompt = { name: 'explain', arguments: [{ name: 'topic', required: true }], 'example.com/data': [2] };
    const resource = { name: 'guide', uri: 'file:///guide', mimeType: 'text/plain', 'example.com/data': [3] };
    const template = { name: 'guides', uriTemplate: 'file:///{name}', 'example.com/data': [4] };
    const results: Record<string, unknown> = {
      'tools/list': { tools: [tool] },
      'tools/call': { content: [{ type: 'text', text: 'ok' }] },
      'prompts/list': { prompts: [prompt] },
      'prompts/get': { messages: [{ role: 'user', content: { type: 'text', text: 'Explain' } }] },
      'resources/list': { resources: [resource] },
      'resources/templates/list': { resourceTemplates: [template] },
      'resources/read': { contents: [{ uri: resource.uri, text: 'Guide' }] },
      'completion/complete': { completion: { values: ['topic'] } },
    };
    createBridge.mockImplementation(async () => ({
      targetConnectionId: 'real-client-bridge',
      outbound: {
        role: 'outbound',
        pin: Object.freeze({ era: 'legacy', revision: '2025-11-25' }),
        request: async ({ operation }: { operation: string }) => results[operation],
        cancel: async () => undefined,
        close: async () => undefined,
      },
      close: async () => undefined,
    }));
    const instance = app();
    const server = await ensureListening(instance);
    const { port } = server.address() as AddressInfo;
    const client = new Client(
      { name: 'real-v2-test', version: '1' },
      { capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );

    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      expect(client.getServerVersion()).toEqual({ name: '1mcp', version: expect.any(String) });
      for (const method of ['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list']) {
        // Typed SDK convenience methods strip unknown fields; inspect the wire projection losslessly.
        expect(await client.request({ method }, z.looseObject({}))).toMatchObject(results[method] as object);
      }
      expect(await client.getPrompt({ name: prompt.name, arguments: { topic: 'test' } })).toMatchObject(
        results['prompts/get'] as object,
      );
      expect(await client.readResource({ uri: resource.uri })).toMatchObject(results['resources/read'] as object);
      expect(
        await client.complete({
          ref: { type: 'ref/prompt', name: prompt.name },
          argument: { name: 'topic', value: 't' },
        }),
      ).toMatchObject(results['completion/complete'] as object);
      expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
        content: [{ type: 'text', text: 'ok' }],
      });
    } finally {
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('isolates concurrent exchanges with the same wire id and completes them out of order', async () => {
    const pending: Array<{
      requestId: string;
      authority: { connectionIds: readonly string[] };
      release: (value: object) => void;
    }> = [];
    const closes: ReturnType<typeof vi.fn>[] = [];
    createBridge.mockImplementation(async () => {
      const targetConnectionId = `private-${closes.length}`;
      const close = vi.fn(async () => undefined);
      closes.push(close);
      return {
        targetConnectionId,
        close,
        outbound: {
          role: 'outbound',
          pin: { era: 'legacy', revision: '2025-11-25' },
          request: (request: { requestId: string; authority: { connectionIds: readonly string[] } }) =>
            new Promise<object>((release) => pending.push({ ...request, release })),
          cancel: vi.fn(async () => undefined),
          close,
        },
      };
    });
    const instance = app();
    const body = { jsonrpc: '2.0', id: 0, method: 'tools/list', params: { _meta: modernMeta } };
    const first = modernPost(await ensureListening(instance), body).then((response) => response);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const second = modernPost(await ensureListening(instance), body).then((response) => response);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0].requestId).not.toBe(pending[1].requestId);
    expect(pending[0].authority.connectionIds).toEqual(['private-0']);
    expect(pending[1].authority.connectionIds).toEqual(['private-1']);
    pending[1].release({ tools: [{ name: 'second', inputSchema: { type: 'object' } }] });
    expect((await second).body).toMatchObject({ id: 0, result: { tools: [{ name: 'second' }] } });
    expect(closes[0]).not.toHaveBeenCalled();
    pending[0].release({ tools: [{ name: 'first', inputSchema: { type: 'object' } }] });
    expect((await first).body).toMatchObject({ id: 0, result: { tools: [{ name: 'first' }] } });
    expect(closes[0]).toHaveBeenCalledOnce();
    expect(closes[1]).toHaveBeenCalledOnce();
  });

  it('bounds simultaneous HTTP exchanges before bridge allocation and releases admission', async () => {
    const instance = app();
    const server = await ensureListening(instance);
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    createBridge.mockImplementation(async () => {
      await gate;
      return {
        targetConnectionId: 'bounded',
        outbound: {
          role: 'outbound',
          pin: { era: 'legacy', revision: '2025-11-25' },
          request: async () => ({ tools: [] }),
          cancel: async () => undefined,
          close: async () => undefined,
        },
        close: async () => undefined,
      };
    });
    const pending = Array.from({ length: 256 }, (_, id) =>
      modernPost(endpoint, { jsonrpc: '2.0', id, method: 'tools/list', params: { _meta: modernMeta } }).then(
        (response) => response,
      ),
    );
    const settled = Promise.allSettled(pending);
    try {
      await vi.waitFor(() => expect(createBridge).toHaveBeenCalledTimes(256), { timeout: 5000 });
      const overloaded = await modernPost(endpoint, {
        jsonrpc: '2.0',
        id: 999,
        method: 'tools/list',
        params: { _meta: modernMeta },
      });
      expect(overloaded.body.error).toMatchObject({
        code: -32000,
        data: { 'app.1mcp/failure': { code: 'gateway_overloaded' } },
      });
      expect(createBridge).toHaveBeenCalledTimes(256);
      release();
      await Promise.all(pending);
      const recovered = await modernPost(endpoint, {
        jsonrpc: '2.0',
        id: 1000,
        method: 'tools/list',
        params: { _meta: modernMeta },
      });
      expect(recovered.body.result).toMatchObject({ tools: [], ttlMs: 0, cacheScope: 'private' });
    } finally {
      release();
      await settled;
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  }, 15_000);
});
