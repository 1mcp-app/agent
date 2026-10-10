import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as authority from '@src/transport/http/utils/templateContextAuthority.js';
import { ConfigManager } from '@src/config/configManager.js';
import { authorizeTemplateContext } from '@src/core/context/templateContextTrust.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { TemplateServerManager } from '@src/core/server/templateServerManager.js';
import { StreamableSessionStatus } from '@src/transport/http/streamableSessionLifecycle.js';
import type { ContextData } from '@src/types/context.js';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureRequestContextInitialized } from './inspectRequestContext.js';
import { buildServerSummaries, createInspectHandler, createServersHandler } from './inspectRoutes.js';
import { setupModernHttpRoutes } from './modernHttpRoutes.js';
import { setupStreamableHttpRoutes } from './streamableHttpRoutes.js';

describe('HTTP project binding lifetime and inspect admission', () => {
  let directory: string;
  let templates: TemplateServerManager;
  let manager: ServerManager;
  let load: ReturnType<typeof vi.spyOn>;
  const clients = new Map();
  const instructions = { hasInstructions: () => false, getServerInstructions: () => undefined };
  const registry = { getServerNames: () => [], get: () => undefined, has: () => true };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), '1mcp-binding-race-'));
    templates = new TemplateServerManager();
    clients.clear();
    manager = {
      getTemplateServerManager: () => templates,
      getClients: () => clients,
      getClientTransports: () => ({}),
      getServerRegistry: () => registry,
      getInstructionAggregator: () => instructions,
      getLazyLoadingOrchestrator: () => undefined,
      registerCleanup: vi.fn(),
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
      await Promise.resolve();
      await templates.cleanupTemplateServers(preparedContext.sessionId!, clients, {});
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
        .set('Mcp-Method', 'tools/call')
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
              'io.modelcontextprotocol/protocolVersion': protocolVersion,
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': { name: 'race-test', version: '1' },
            },
          },
        });
      expect(response.status).toBe(500);
      expect(load, JSON.stringify(response.body)).toHaveBeenCalledOnce();
      expect(handleRequest).not.toHaveBeenCalled();
      expect(createBridge).not.toHaveBeenCalled();
    },
  );

  it.each(['inspect', 'servers'] as const)('rejects removed bindings before %s backend inventory', async (route) => {
    removeBindingDuringPreparation();
    const connection = createMockOutboundConnection({ name: 'backend' });
    clients.set('backend', connection);
    const instance = express();
    instance.get('/inspect', route === 'inspect' ? createInspectHandler(manager) : createServersHandler(manager));
    const response = await request(instance)
      .get('/inspect')
      .query({ context: Buffer.from(JSON.stringify(context())).toString('base64url') });
    expect(response.status).toBe(500);
    expect(load).toHaveBeenCalledOnce();
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
    expect(selected.adapter.request).toHaveBeenCalledOnce();
    expect(sibling.adapter.request).not.toHaveBeenCalled();
  });
});
