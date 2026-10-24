import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { FileStorageService } from '@src/auth/storage/fileStorageService.js';
import { AUTH_CONFIG, STREAMABLE_HTTP_ENDPOINT } from '@src/constants.js';
import { createTemplateContextProof, TemplateContextCapabilityStore } from '@src/core/context/templateContextTrust.js';
import { RuntimeIdentityService } from '@src/core/runtime/runtimeIdentityService.js';
import { type AgentConfig, AgentConfigManager } from '@src/core/server/agentConfig.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import logger from '@src/logger/logger.js';
import { createScopeAuthMiddleware } from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import { StreamableSessionLifecycle } from '@src/transport/http/streamableSessionLifecycle.js';
import { StdioProxyTransport } from '@src/transport/stdioProxyTransport.js';
import type { ContextData } from '@src/types/context.js';

import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupStreamableHttpRoutes } from './streamableHttpRoutes.js';

vi.mock('@src/sdk/legacy/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(function () {
    return { start: vi.fn(), close: vi.fn(), send: vi.fn(), onmessage: undefined };
  }),
}));

function transport(sessionId: string) {
  return {
    sessionId,
    _webStandardTransport: { _initialized: false, sessionId },
    markAsRestored: vi.fn(),
    handleRequest: vi.fn(async (req: Request, res: Response) => {
      if (req.body?.method === 'initialize') {
        res
          .set('mcp-session-id', sessionId)
          .status(200)
          .json({
            jsonrpc: '2.0',
            id: req.body.id,
            result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'test', version: '1' } },
          });
        return;
      }
      if (req.method === 'GET' && req.headers.accept === 'text/event-stream') {
        res.status(405).end();
        return;
      }
      res.set('mcp-session-id', sessionId).status(200).json({ method: req.method });
    }),
  };
}

describe('authenticated legacy Streamable HTTP session ownership', () => {
  let directory: string;
  let provider: SDKOAuthServerProvider;
  let storage: FileStorageService;
  let repository: StreamableSessionRepository;
  let features: AgentConfig['features'];
  let app: express.Express;
  let listener: Server;
  const active = new Map<string, ReturnType<typeof transport>>();
  const manager = {
    getTransport: vi.fn((id: string) => active.get(id)),
    connectTransport: vi.fn(async (value: ReturnType<typeof transport>, id: string) => {
      active.set(id, value);
    }),
    disconnectTransport: vi.fn(async (id: string) => {
      active.delete(id);
    }),
    getServer: vi.fn(),
  };

  function mount() {
    const lifecycle = new StreamableSessionLifecycle(manager as unknown as ServerManager, repository, undefined, {
      createTransport: transport as never,
      createRestorableTransport: transport as never,
      isStreamableTransport: ((value: unknown) => Boolean(value)) as never,
    });
    app = express();
    app.use(express.json());
    setupStreamableHttpRoutes(
      app,
      manager as unknown as ServerManager,
      repository,
      createScopeAuthMiddleware(provider),
      undefined,
      undefined,
      undefined,
      lifecycle,
    );
  }

  function token(
    clientId = 'owner',
    scopes = ['tag:files'],
    resource = new URL(AgentConfigManager.getInstance().getUrl()).href,
  ) {
    const id = randomUUID();
    provider.oauthStorage.sessionRepository.createWithId(id, clientId, resource, scopes, 60_000);
    return AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX + id;
  }

  async function initialize(bearer: string) {
    const response = await request(listener)
      .post(STREAMABLE_HTTP_ENDPOINT)
      .auth(bearer, { type: 'bearer' })
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    expect(response.status).toBe(200);
    return response.headers['mcp-session-id'] as string;
  }

  beforeEach(async () => {
    const config = AgentConfigManager.getInstance();
    features = config.get('features');
    config.updateConfig({ features: { ...features, auth: true, scopeValidation: true, sessionPersistence: true } });
    directory = mkdtempSync(join(tmpdir(), '1mcp-session-ownership-'));
    const get = config.get.bind(config);
    vi.spyOn(config, 'get').mockImplementation(((key: keyof AgentConfig) =>
      key === 'runtimeScopeStoragePath' ? directory : get(key)) as typeof config.get);

    provider = new SDKOAuthServerProvider(directory, 'session-ownership');
    storage = new FileStorageService(directory, 'streamable', { manageLifecycle: false });
    repository = new StreamableSessionRepository(storage);
    active.clear();
    vi.clearAllMocks();
    mount();
    listener = createServer((req, res) => app(req, res));
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    listener.closeAllConnections();
    await new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
    repository.stopPeriodicFlush();
    provider.shutdown();
    AgentConfigManager.getInstance().updateConfig({ features });
    rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function signedContext(sessionId = 'stream-' + randomUUID()) {
    const capability = new TemplateContextCapabilityStore({
      storageDir: directory,
      runtimeScopeId: new RuntimeIdentityService({ storageDir: directory }).getRuntimeScopeId(),
    }).getOrCreate();
    const context: ContextData = {
      project: { name: 'test', path: directory },
      user: {},
      environment: {},
      sessionId,
      timestamp: new Date().toISOString(),
      version: '1',
      transport: { type: 'stdio-proxy' },
    };
    return { context, contextProof: createTemplateContextProof(context, capability) };
  }

  it.each([false, true])('initializes a real first-party proxy using a valid bearer, signed=%s', async (signed) => {
    const meta = signed ? signedContext() : undefined;
    const proxy = new StdioProxyTransport({
      serverUrl: `http://127.0.0.1:${(listener.address() as AddressInfo).port}${STREAMABLE_HTTP_ENDPOINT}`,
      bearerToken: token(),
      ...(meta
        ? {
            context: meta.context,
            createContextProof: async (context: ContextData) =>
              createTemplateContextProof(
                context,
                new TemplateContextCapabilityStore({ storageDir: directory }).getOrCreate(),
              ),
          }
        : {}),
    });
    try {
      await proxy.start();
      await proxy['stdioTransport'].onmessage!({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      });
      expect(proxy['stdioTransport'].send).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, result: expect.objectContaining({ protocolVersion: '2025-06-18' }) }),
      );
      const id = proxy['httpTransport'].sessionId!;
      expect(repository.getSessionData(id)?.authorizationBinding?.clientId).toBe('owner');
      if (signed) expect(id).toBe(proxy['context'].sessionId);
    } finally {
      await proxy.close();
    }
  });

  it.each([false, true])(
    'creates a signed session and preserves its proof for restoration, header=%s',
    async (header) => {
      const meta = signedContext();
      const owner = token();
      const pending = request(listener).post(STREAMABLE_HTTP_ENDPOINT).auth(owner, { type: 'bearer' });
      if (header) pending.set('mcp-session-id', meta.context.sessionId!);
      const response = await pending.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', _meta: meta },
      });
      expect(response.status).toBe(200);
      const id = response.headers['mcp-session-id'] as string;
      expect(id).toBe(meta.context.sessionId);
      expect(repository.getSessionData(id)).toMatchObject(meta);
      restart();
      const restored = await request(listener)
        .post(STREAMABLE_HTTP_ENDPOINT)
        .auth(token(), { type: 'bearer' })
        .set('mcp-session-id', id)
        .send({ method: 'tools/list' });
      expect(restored.status).toBe(200);
    },
  );

  it.each(['forged', 'tampered', 'unsigned'] as const)(
    'rejects %s proof authority identically for unknown and foreign IDs',
    async (kind) => {
      const victim = await initialize(token());
      const before = repository.getSessionData(victim);
      const connects = manager.connectTransport.mock.calls.length;
      const responses = [];
      for (const id of [victim, 'stream-' + randomUUID()]) {
        const meta = signedContext(id);
        if (kind === 'forged') meta.contextProof.signature = 'forged';
        if (kind === 'tampered') meta.context.project.name = 'changed';
        const response = await request(listener)
          .post(STREAMABLE_HTTP_ENDPOINT)
          .auth(token('other'), { type: 'bearer' })
          .set('mcp-session-id', id)
          .send({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              _meta: kind === 'unsigned' ? { context: meta.context } : meta,
            },
          });
        expect(response.status).toBe(404);
        responses.push(response.body);
      }
      expect(responses[0]).toEqual(responses[1]);
      expect(manager.connectTransport).toHaveBeenCalledTimes(connects);
      expect(repository.getSessionData(victim)).toEqual(before);
    },
  );

  it.each(['active', 'persisted', 'legacy-active', 'legacy-persisted'] as const)(
    'does not use a valid local proof to replace a foreign %s session',
    async (state) => {
      const victim = await initialize(token());
      const data = repository.getSessionData(victim)!;
      if (state.startsWith('legacy')) delete data.authorizationBinding;
      storage.writeData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, victim, data);
      repository.stopPeriodicFlush();
      if (state.endsWith('persisted')) active.clear();
      repository = new StreamableSessionRepository(storage);
      mount();
      const meta = signedContext(victim);
      const connects = manager.connectTransport.mock.calls.length;
      for (const header of [false, true]) {
        const pending = request(listener).post(STREAMABLE_HTTP_ENDPOINT).auth(token('other'), { type: 'bearer' });
        if (header) pending.set('mcp-session-id', victim);
        const response = await pending.send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            _meta: meta,
          },
        });
        expect(response.status).toBe(404);
      }
      expect(manager.connectTransport).toHaveBeenCalledTimes(connects);
      expect(manager.disconnectTransport).not.toHaveBeenCalled();
      expect(repository.getSessionData(victim)).toEqual(data);
    },
  );

  it('does not treat legacy trust mode as verified-local creation authority', async () => {
    const config = AgentConfigManager.getInstance();
    const previous = config.get('templateContext');
    const meta = signedContext();
    config.updateConfig({ templateContext: { trust: 'legacy' } });
    try {
      const response = await request(listener)
        .post(STREAMABLE_HTTP_ENDPOINT)
        .auth(token(), { type: 'bearer' })
        .set('mcp-session-id', meta.context.sessionId!)
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { _meta: meta } });
      expect(response.status).toBe(404);
      expect(manager.connectTransport).not.toHaveBeenCalled();
    } finally {
      config.updateConfig({ templateContext: previous });
    }
  });

  it('requires current OAuth authentication before signed creation', async () => {
    const meta = signedContext();
    const response = await request(listener)
      .post(STREAMABLE_HTTP_ENDPOINT)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { _meta: meta } });
    expect(response.status).toBe(401);
    expect(manager.connectTransport).not.toHaveBeenCalled();
  });

  it('reserves a signed ID while creation is pending so another grant cannot replace it', async () => {
    const meta = signedContext();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    manager.connectTransport.mockImplementationOnce(async (value, id) => {
      await barrier;
      active.set(id, value);
    });
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', _meta: meta },
    };
    const first = request(listener)
      .post(STREAMABLE_HTTP_ENDPOINT)
      .auth(token(), { type: 'bearer' })
      .send(body)
      .then((r) => r);
    try {
      await vi.waitFor(() => expect(manager.connectTransport).toHaveBeenCalledOnce());
      const second = await request(listener)
        .post(STREAMABLE_HTTP_ENDPOINT)
        .auth(token('other'), { type: 'bearer' })
        .send(body);
      expect(second.status).toBe(404);
      expect(manager.connectTransport).toHaveBeenCalledOnce();
    } finally {
      release();
    }
    expect((await first).status).toBe(200);
    expect(repository.getSessionData(meta.context.sessionId!)?.authorizationBinding?.clientId).toBe('owner');
  });

  it('initializes and continues only the admitting grant through POST, GET and DELETE', async () => {
    const owner = token();
    const sessionId = await initialize(owner);
    const intruder = token('other', ['tag:search']);
    for (const method of ['post', 'get', 'delete'] as const) {
      const response = await request(listener)
        [method](STREAMABLE_HTTP_ENDPOINT)
        .auth(intruder, { type: 'bearer' })
        .set('mcp-session-id', sessionId)
        .send({ method: 'tools/list' });
      expect(response.status).toBe(404);
    }
    expect(manager.disconnectTransport).not.toHaveBeenCalled();
    const renewed = token('owner', ['tag:files', 'tag:files']);
    for (const method of ['post', 'get', 'delete'] as const) {
      const response = await request(listener)
        [method](STREAMABLE_HTTP_ENDPOINT)
        .auth(renewed, { type: 'bearer' })
        .set('mcp-session-id', sessionId)
        .send({ method: 'tools/list' });
      expect(response.status).toBe(200);
    }
    expect(repository.getSessionData(sessionId)).toBeNull();
  });
  function restart() {
    repository.stopPeriodicFlush();
    active.clear();
    repository = new StreamableSessionRepository(storage);
    mount();
  }

  it.each([false, true])('rejects changed scopes and initialize takeover, restored=%s', async (restored) => {
    const owner = token('owner', ['tag:files', 'tag:extra']);
    const sessionId = await initialize(owner);
    const admitted = repository.getSessionData(sessionId);
    if (restored) restart();
    const attempts = [
      token('other', ['tag:files', 'tag:extra']),
      token('owner', ['tag:files']),
      token('owner', ['tag:files', 'tag:extra', 'tag:new']),
    ];
    const connects = manager.connectTransport.mock.calls.length;
    for (const bearer of attempts) {
      for (const method of ['post', 'get', 'delete'] as const) {
        const response = await request(listener)
          [method](STREAMABLE_HTTP_ENDPOINT)
          .auth(bearer, { type: 'bearer' })
          .set('mcp-session-id', sessionId)
          .send({ method: 'tools/list' });
        expect(response.status).toBe(404);
        const unknown = await request(listener)
          [method](STREAMABLE_HTTP_ENDPOINT)
          .auth(bearer, { type: 'bearer' })
          .set('mcp-session-id', 'stream-' + randomUUID())
          .send({ method: 'tools/list' });
        expect(response.body.error.message).toBe(unknown.body.error.message);
      }
      const initialize = await request(listener)
        .post(STREAMABLE_HTTP_ENDPOINT)
        .auth(bearer, { type: 'bearer' })
        .set('mcp-session-id', sessionId)
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
      expect(initialize.status).toBe(404);
      const unknown = await request(listener)
        .post(STREAMABLE_HTTP_ENDPOINT)
        .auth(bearer, { type: 'bearer' })
        .set('mcp-session-id', 'stream-' + randomUUID())
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
      expect(initialize.body.error.message).toBe(unknown.body.error.message);
    }
    expect(manager.connectTransport).toHaveBeenCalledTimes(connects);
    expect(manager.disconnectTransport).not.toHaveBeenCalled();
    expect(repository.getSessionData(sessionId)).toEqual(admitted);
    const renewed = token('owner', ['tag:extra', 'tag:files', 'tag:extra']);
    const response = await request(listener)
      .post(STREAMABLE_HTTP_ENDPOINT)
      .auth(renewed, { type: 'bearer' })
      .set('mcp-session-id', sessionId)
      .send({ method: 'tools/list' });
    expect(response.status).toBe(200);
    if (restored) expect(manager.connectTransport).toHaveBeenCalledTimes(connects + 1);
  });

  it.each(['post', 'get', 'delete'] as const)('restores an owned persisted session through %s', async (method) => {
    const owner = token();
    const sessionId = await initialize(owner);
    restart();
    const response = await request(listener)
      [method](STREAMABLE_HTTP_ENDPOINT)
      .auth(token(), { type: 'bearer' })
      .set('mcp-session-id', sessionId)
      .send({ method: 'tools/list' });
    expect(response.status).toBe(200);
    expect(manager.connectTransport).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('fails closed for unbound legacy sessions, restored=%s', async (restored) => {
    const owner = token();
    const sessionId = await initialize(owner);
    const data = repository.getSessionData(sessionId)!;
    delete data.authorizationBinding;
    storage.writeData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, sessionId, data);
    repository.stopPeriodicFlush();
    if (restored) active.clear();
    repository = new StreamableSessionRepository(storage);
    mount();
    const connects = manager.connectTransport.mock.calls.length;
    for (const method of ['post', 'get', 'delete'] as const) {
      const response = await request(listener)
        [method](STREAMABLE_HTTP_ENDPOINT)
        .auth(owner, { type: 'bearer' })
        .set('mcp-session-id', sessionId)
        .send({ method: 'tools/list' });
      expect(response.status).toBe(404);
    }
    expect(manager.connectTransport).toHaveBeenCalledTimes(connects);
    expect(manager.disconnectTransport).not.toHaveBeenCalled();
    await initialize(owner);
  });

  it('retains active ownership when persistence fails before writing any session data', async () => {
    vi.spyOn(repository, 'create').mockImplementation(() => {
      throw new Error('disk unavailable');
    });
    const owner = token();
    const sessionId = await initialize(owner);
    expect(repository.getSessionData(sessionId)).toBeNull();
    for (const method of ['post', 'get', 'delete'] as const) {
      const response = await request(listener)
        [method](STREAMABLE_HTTP_ENDPOINT)
        .auth(token('other'), { type: 'bearer' })
        .set('mcp-session-id', sessionId)
        .send({ method: 'tools/list' });
      expect(response.status).toBe(404);
    }
    const response = await request(listener)
      .post(STREAMABLE_HTTP_ENDPOINT)
      .auth(token(), { type: 'bearer' })
      .set('mcp-session-id', sessionId)
      .send({ method: 'tools/list' });
    expect(response.status).toBe(200);
    expect(manager.disconnectTransport).not.toHaveBeenCalled();
  });

  it('rejects a foreign session before transport handling', async () => {
    const sessionId = await initialize(token());
    const handleRequest = active.get(sessionId)!.handleRequest;
    handleRequest.mockClear();
    const response = await request(listener)
      .post(STREAMABLE_HTTP_ENDPOINT)
      .auth(token('other'), { type: 'bearer' })
      .set('mcp-session-id', sessionId)
      .send({ method: 'tools/list' });
    expect(response.status).toBe(404);
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it('persists only canonical non-secret grant facts', async () => {
    const logs = [
      vi.spyOn(logger, 'info'),
      vi.spyOn(logger, 'warn'),
      vi.spyOn(logger, 'error'),
      vi.spyOn(logger, 'debug'),
    ];
    const bearer = token('owner', ['tag:files', 'tag:extra', 'tag:files']);
    const sessionId = await initialize(bearer);
    const data = storage.readData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, sessionId);
    expect(data).toMatchObject({
      authorizationBinding: {
        clientId: 'owner',
        resource: new URL(AgentConfigManager.getInstance().getUrl()).href,
        scopes: ['tag:extra', 'tag:files'],
      },
    });
    expect(JSON.stringify(data)).not.toContain(bearer);
    expect(JSON.stringify(logs.flatMap((log) => log.mock.calls))).not.toContain(bearer);
    expect(repository.getSessionData(sessionId)?.authorizationBinding).toEqual({
      clientId: 'owner',
      resource: new URL(AgentConfigManager.getInstance().getUrl()).href,
      scopes: ['tag:extra', 'tag:files'],
    });
  });

  it('authenticates and binds sessions while scope filtering is disabled', async () => {
    const config = AgentConfigManager.getInstance();
    config.updateConfig({ features: { ...config.get('features'), scopeValidation: false } });
    mount();
    const missing = await request(listener)
      .post(STREAMABLE_HTTP_ENDPOINT)
      .send({ jsonrpc: '2.0', method: 'initialize' });
    expect(missing.status).toBe(401);
    const owner = token();
    const sessionId = await initialize(owner);
    const response = await request(listener)
      .post(STREAMABLE_HTTP_ENDPOINT)
      .query({ tags: 'search' })
      .auth(owner, { type: 'bearer' })
      .set('mcp-session-id', sessionId)
      .send({ method: 'tools/list' });
    expect(response.status).toBe(200);
    const intruder = await request(listener)
      .post(STREAMABLE_HTTP_ENDPOINT)
      .auth(token('other'), { type: 'bearer' })
      .set('mcp-session-id', sessionId)
      .send({ method: 'tools/list' });
    expect(intruder.status).toBe(404);
  });

  it('preserves anonymous creation, continuation and restoration when auth is disabled', async () => {
    const config = AgentConfigManager.getInstance();
    config.updateConfig({ features: { ...config.get('features'), auth: false } });
    mount();
    const sessionId = await initialize('');
    expect(repository.getSessionData(sessionId)?.authorizationBinding).toBeUndefined();
    restart();
    for (const method of ['post', 'get', 'delete'] as const) {
      const response = await request(listener)
        [method](STREAMABLE_HTTP_ENDPOINT)
        .set('mcp-session-id', sessionId)
        .send({ method: 'tools/list' });
      expect(response.status).toBe(200);
    }
  });
});
