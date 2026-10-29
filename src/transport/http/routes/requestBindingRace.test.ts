import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as authority from '@src/transport/http/utils/templateContextAuthority.js';
import { ConfigManager } from '@src/config/configManager.js';
import { publishConfiguredToolSnapshot } from '@src/core/capabilities/configuredToolSnapshot.js';
import { SchemaCache } from '@src/core/capabilities/schemaCache.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { authorizeTemplateContext } from '@src/core/context/templateContextTrust.js';
import { prepareRequestContext } from '@src/core/server/requestContextPreparation.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { TemplateServerManager } from '@src/core/server/templateServerManager.js';
import { StreamableSessionStatus } from '@src/transport/http/streamableSessionLifecycle.js';
import type { ContextData } from '@src/types/context.js';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRequestContextPreparationDependencies,
  ensureRequestContextInitialized,
  registerHttpRequestContext,
} from './inspectRequestContext.js';
import {
  buildInstructionServerSummaries,
  buildServerSummaries,
  createInspectHandler,
  createServersHandler,
} from './inspectRoutes.js';
import { setupModernHttpRoutes } from './modernHttpRoutes.js';
import { setupStreamableHttpRoutes } from './streamableHttpRoutes.js';
import { createToolInvocationsHandler } from './toolRoutes.js';

describe('HTTP project binding lifetime and inspect admission', () => {
  let directory: string;
  let templates: TemplateServerManager;
  let manager: ServerManager;
  let load: ReturnType<typeof vi.spyOn>;
  let clients = new Map();
  const instructions = {
    hasInstructions: () => false,
    getServerInstructions: () => undefined,
    getEffectiveServerInstructions: () => undefined,
  };
  const registry = { getServerNames: () => [], get: () => undefined, has: () => true };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), '1mcp-binding-race-'));
    templates = new TemplateServerManager();
    // Runtime catalog caches are keyed by this map; each test needs a fresh runtime identity.
    clients = new Map();
    manager = {
      getTemplateServerManager: () => templates,
      getClients: () => clients,
      getClientTransports: () => ({}),
      getServerRegistry: () => registry,
      getInstructionAggregator: () => instructions,
      getLazyLoadingOrchestrator: () => undefined,
      registerCleanup: vi.fn(),
      retainLogicalTemplateSession: (id: string) => templates.retainLogicalTemplateSession(id),
      prepareLogicalTemplateSession: async (_id: string, context: ContextData, filterConfig: object) => {
        const result = await prepareRequestContext({
          deps: createRequestContextPreparationDependencies(manager),
          context: context as never,
          filterConfig,
        });
        return 'bindingId' in result ? result.bindingId : undefined;
      },
    } as unknown as ServerManager;
    vi.spyOn(authority, 'authorizeRequestTemplateContext').mockImplementation((input) =>
      authorizeTemplateContext({ ...input, mode: 'legacy' }),
    );
    load = vi.spyOn(ConfigManager.getInstance(), 'loadConfigWithTemplates');
    load.mockResolvedValue({ templateServers: {}, staticServers: {}, errors: [] });
    vi.spyOn(ConfigManager.getInstance(), 'loadDeclaredServerConfigs').mockReturnValue({
      templateServers: {},
      staticServers: {},
      errors: [],
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await templates.shutdown();
    await rm(directory, { recursive: true, force: true });
  });

  function context() {
    return { project: { path: directory }, user: {}, environment: {}, sessionId: 'session-a' };
  }

  function removeBindingDuringPreparation() {
    load.mockImplementation(async (preparedContext: ContextData) => {
      // Preparation has registered the real binding before awaiting template rendering.
      expect(templates.getBindingContexts().size).toBeGreaterThan(0);
      await Promise.resolve();
      await templates.cleanupTemplateServers(preparedContext.sessionId!, clients, {});
      expect(templates.getBindingContexts().size).toBe(0);
      return { templateServers: {}, staticServers: {}, errors: [] };
    });
  }

  it('rejects an actual removed binding in common request preparation', async () => {
    removeBindingDuringPreparation();
    await expect(
      ensureRequestContextInitialized(
        manager,
        {
          query: { context: Buffer.from(JSON.stringify(context())).toString('base64url') },
          headers: {},
        } as unknown as express.Request,
        { setHeader: vi.fn() } as unknown as express.Response,
        {},
      ),
    ).rejects.toThrow('Project binding is no longer available');
    expect(load).toHaveBeenCalledOnce();
  });

  it('registers current checkout policy without rendering or starting backends', async () => {
    await writeFile(join(directory, '.1mcprc'), JSON.stringify({ tags: ['frontend'] }));
    load.mockRejectedValue(new Error('Backend initialization must not delay instructions'));
    const start = vi.spyOn(templates, 'createTemplateBasedServers');
    const binding = await registerHttpRequestContext(
      manager,
      {
        query: { context: Buffer.from(JSON.stringify(context())).toString('base64url') },
        headers: {},
      } as unknown as express.Request,
      { setHeader: vi.fn() } as unknown as express.Response,
      {},
    );

    expect(binding).toBeDefined();
    expect(templates.getBindingContext(binding!)).toMatchObject({ project: { path: directory } });
    expect(templates.getBindingPolicies(binding!)).toEqual([expect.objectContaining({ tags: ['frontend'] })]);
    expect(load).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('rejects a binding removed during instruction registration', async () => {
    const register = templates.registerBindingContext.bind(templates);
    vi.spyOn(templates, 'registerBindingContext').mockImplementation(async (...args) => {
      const id = await register(...args);
      await templates.cleanupTemplateServers(args[1].sessionId!, clients, {});
      return id;
    });
    await expect(
      registerHttpRequestContext(
        manager,
        {
          query: { context: Buffer.from(JSON.stringify(context())).toString('base64url') },
          headers: {},
        } as unknown as express.Request,
        { setHeader: vi.fn() } as unknown as express.Response,
        {},
      ),
    ).rejects.toThrow('Project binding is no longer available');
  });

  it.each(['2024-11-05', '2025-11-25', '2026-07-28'])(
    'rejects a binding removed during preparation before %s transport dispatch',
    async (protocolVersion) => {
      removeBindingDuringPreparation();
      const handleRequest = vi.fn((_req, res) => res.json({ dispatched: true }));
      const createBridge = vi.fn();
      const instance = express();
      instance.use(express.json());
      const router = express.Router();
      setupModernHttpRoutes(router, manager, [(_req, _res, next) => next()], createBridge, {
        allowsHost: () => true,
        allowsOrigin: () => true,
      });
      setupStreamableHttpRoutes(
        router,
        manager,
        {} as never,
        (_req, _res, next) => next(),
        undefined,
        undefined,
        undefined,
        {
          resolvePostSession: async () => ({
            status: StreamableSessionStatus.Created,
            sessionId: 'session-a',
            persisted: true,
            transport: { handleRequest },
          }),
        } as never,
      );
      instance.use(router);
      instance.use((_error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: _error.message });
      });
      const response = await request(instance)
        .post('/mcp')
        .set('MCP-Protocol-Version', protocolVersion)
        .set(protocolVersion === '2026-07-28' ? { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'checkout_source' } : {})
        .set('mcp-session-id', 'session-a')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'checkout_source',
            arguments: {},
            _meta: {
              context: context(),
              ...(protocolVersion === '2026-07-28'
                ? { 'io.modelcontextprotocol/protocolVersion': protocolVersion }
                : {}),
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': { name: 'race-test', version: '1' },
            },
          },
        });
      expect(response.status, JSON.stringify(response.body)).toBe(500);
      expect(response.body.error).toBeDefined();
      expect(load, JSON.stringify(response.body)).toHaveBeenCalledOnce();
      expect(handleRequest).not.toHaveBeenCalled();
      expect(createBridge).not.toHaveBeenCalled();
    },
  );

  it.each(['inspect', 'servers'] as const)('rejects removed bindings before %s backend inventory', async (route) => {
    if (route === 'inspect') {
      const register = templates.registerBindingContext.bind(templates);
      vi.spyOn(templates, 'registerBindingContext').mockImplementation(async (...args) => {
        const id = await register(...args);
        await templates.cleanupTemplateServers(args[1].sessionId!, clients, {});
        return id;
      });
    } else {
      removeBindingDuringPreparation();
    }
    const connection = createMockOutboundConnection({ name: 'backend' });
    clients.set('backend', connection);
    const instance = express();
    instance.get('/inspect', route === 'inspect' ? createInspectHandler(manager) : createServersHandler(manager));
    const response = await request(instance)
      .get('/inspect')
      .query({ context: Buffer.from(JSON.stringify(context())).toString('base64url') });
    expect(response.status, JSON.stringify(response.body)).toBe(500);
    expect(load).toHaveBeenCalledTimes(route === 'inspect' ? 0 : 1);
    expect(connection.adapter.request).not.toHaveBeenCalled();
  });

  it('checks project policy before querying connected and registered backend inventories', async () => {
    const denied = createMockOutboundConnection({ name: 'denied' });
    const allowed = createMockOutboundConnection({ name: 'allowed' });
    const configs = {
      denied: { command: 'node', tags: ['backend'], projectTarget: { mode: 'single' as const } },
      allowed: { command: 'node', tags: ['frontend'], projectTarget: { mode: 'single' as const } },
    };
    const summaries = await buildServerSummaries(
      new Map([
        ['denied', denied],
        ['allowed', allowed],
      ]),
      undefined,
      undefined,
      { ...registry, getServerNames: () => ['denied', 'allowed'] } as never,
      instructions as never,
      { staticServers: configs, templateServers: {}, errors: [] },
      {},
      {
        bindingId: 'selected',
        projectContext: context(),
        projectPolicies: [{ tags: ['frontend'], tagFilterMode: 'simple-or' }],
      },
    );
    expect(summaries.map((entry) => entry.server)).toEqual(['allowed']);
    expect(allowed.adapter.request).toHaveBeenCalledOnce();
    expect(denied.adapter.request).not.toHaveBeenCalled();
  });

  it('applies current policy to instruction summaries without querying any backend', () => {
    const allowed = createMockOutboundConnection({ name: 'allowed' });
    const denied = createMockOutboundConnection({ name: 'denied' });
    const summaries = buildInstructionServerSummaries(
      new Map([
        ['allowed', allowed],
        ['denied', denied],
      ]),
      registry as never,
      instructions as never,
      {
        staticServers: {
          allowed: { command: 'node', tags: ['frontend'], projectTarget: { mode: 'single' } },
          denied: { command: 'node', tags: ['backend'], projectTarget: { mode: 'single' } },
        },
        templateServers: {},
        errors: [],
      },
      {},
      {
        bindingId: 'selected',
        projectContext: context(),
        projectPolicies: [{ tags: ['frontend'], tagFilterMode: 'simple-or' }],
      },
    );

    expect(summaries).toMatchObject([{ server: 'allowed', toolCountKnown: false }]);
    expect(summaries).toHaveLength(1);
    expect(allowed.adapter.request).not.toHaveBeenCalled();
    expect(denied.adapter.request).not.toHaveBeenCalled();
  });

  it('applies selected checkout policy to no-target inspect and preserves contextless summaries', async () => {
    await writeFile(join(directory, '.1mcprc'), JSON.stringify({ tags: ['frontend'] }));
    const denied = createMockOutboundConnection({ name: 'denied' });
    const allowed = createMockOutboundConnection({ name: 'allowed' });
    const independent = createMockOutboundConnection({ name: 'docs' });
    clients.set('denied', denied);
    clients.set('allowed', allowed);
    clients.set('docs', independent);
    vi.mocked(ConfigManager.getInstance().loadDeclaredServerConfigs).mockReturnValue({
      staticServers: {
        denied: { command: 'node', tags: ['backend'], projectTarget: { mode: 'single' } },
        allowed: { command: 'node', tags: ['frontend'], projectTarget: { mode: 'single' } },
        docs: { command: 'node', projectTarget: { mode: 'independent' } },
      },
      templateServers: {},
      errors: [],
    });
    const instance = express();
    instance.get('/inspect', createInspectHandler(manager));
    const selected = await request(instance)
      .get('/inspect')
      .query({ context: Buffer.from(JSON.stringify(context())).toString('base64url') });
    expect(selected.status).toBe(200);
    expect(selected.body.servers.map((entry: { server: string }) => entry.server)).toEqual(['allowed', 'docs']);
    expect(denied.adapter.request).not.toHaveBeenCalled();
    const contextless = await request(instance).get('/inspect');
    expect(contextless.status).toBe(200);
    expect(contextless.body.servers.map((entry: { server: string }) => entry.server)).toEqual(['docs']);
    expect(denied.adapter.request).not.toHaveBeenCalled();
  });

  it('counts only the selected live template instance in no-target inspect', async () => {
    const selected = createMockOutboundConnection({
      name: 'symbols',
      adapter: { request: vi.fn().mockResolvedValue({ tools: [{ name: 'frontend_symbol' }] }) },
    });
    const sibling = createMockOutboundConnection({ name: 'symbols' });
    clients.set('symbols:selected', selected);
    clients.set('symbols:sibling', sibling);
    publishConfiguredToolSnapshot(selected, [{ name: 'frontend_symbol', inputSchema: { type: 'object' } }]);
    publishConfiguredToolSnapshot(sibling, [
      { name: 'private_symbol', inputSchema: { type: 'object' } },
      { name: 'private_second', inputSchema: { type: 'object' } },
    ]);
    const cached = ToolRegistry.fromToolsWithServer([
      {
        server: 'symbols',
        connectionKey: 'symbols:selected',
        tool: { name: 'frontend_symbol', inputSchema: { type: 'object' } },
      },
      {
        server: 'symbols',
        connectionKey: 'symbols:sibling',
        tool: { name: 'private_symbol', inputSchema: { type: 'object' } },
      },
      {
        server: 'symbols',
        connectionKey: 'symbols:sibling',
        tool: { name: 'private_second', inputSchema: { type: 'object' } },
      },
    ]).withConnections(new Map(clients));
    vi.spyOn(manager, 'getLazyLoadingOrchestrator').mockReturnValue({ peekToolRegistry: () => cached } as never);
    vi.spyOn(templates, 'getAllRenderedHashesForSession').mockReturnValue(new Map([['symbols', 'selected']]));
    vi.mocked(ConfigManager.getInstance().loadDeclaredServerConfigs).mockReturnValue({
      staticServers: {},
      templateServers: {
        symbols: { command: 'node', template: {}, projectTarget: { mode: 'single' } },
      },
      errors: [],
    });
    const instance = express();
    instance.get('/inspect', createInspectHandler(manager));
    const response = await request(instance)
      .get('/inspect')
      .query({ context: Buffer.from(JSON.stringify(context())).toString('base64url') });
    expect(response.status).toBe(200);
    expect(response.body.servers).toMatchObject([{ server: 'symbols', toolCount: 1, available: true }]);
    expect(selected.adapter.request).not.toHaveBeenCalled();
    expect(sibling.adapter.request).not.toHaveBeenCalled();
  });
  it.each([
    [false, 'bound'],
    [true, 'bound'],
    [false, 'removed'],
    [true, 'removed'],
    [false, 'header-only'],
    [true, 'header-only'],
  ] as const)(
    'rechecks invocation binding without rejecting header-only sessions (lazy=%s, mode=%s)',
    async (lazy, mode) => {
      const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'called' }] }));
      clients.set(
        'shared',
        createMockOutboundConnection({
          name: 'shared',
          capabilities: { tools: {} },
          adapter: {
            request: vi.fn(async ({ method }) => {
              if (method === 'tools/list') {
                if (mode === 'removed') {
                  expect(templates.getBindingContexts().size).toBe(1);
                  const boundContext = [...templates.getBindingContexts().values()][0];
                  await templates.cleanupTemplateServers(boundContext.sessionId!, clients, {});
                  expect(templates.getBindingContexts().size).toBe(0);
                }
                return { tools: [{ name: 'call', inputSchema: { type: 'object' } }] };
              }
              return callTool();
            }),
          },
        }),
      );
      if (lazy)
        vi.spyOn(manager, 'getLazyLoadingOrchestrator').mockReturnValue({
          getToolRegistry: () => ToolRegistry.fromToolsWithServer([]),
          getSchemaCache: () => new SchemaCache({ maxEntries: 10 }),
          callMetaTool: vi.fn(),
        } as never);
      const app = express();
      app.use(express.json());
      app.post('/invoke', createToolInvocationsHandler(manager));
      let invocation = request(app).post('/invoke').set('mcp-session-id', 'session-a');
      if (mode !== 'header-only')
        invocation = invocation.query({ context: Buffer.from(JSON.stringify(context())).toString('base64url') });
      const response = await invocation.send({ tool: 'shared/call', args: {} });
      if (mode === 'removed') {
        expect(response.status, JSON.stringify(response.body)).toBe(503);
        expect(callTool).not.toHaveBeenCalled();
      } else {
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(callTool).toHaveBeenCalledOnce();
      }
    },
  );
});
