import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { ConfigManager } from '@src/config/configManager.js';
import { validateProjectPreparationAuthority } from '@src/core/context/projectPreparationAuthority.js';
import { createTemplateContextProof, TemplateContextCapabilityStore } from '@src/core/context/templateContextTrust.js';
import { RuntimeIdentityService } from '@src/core/runtime/runtimeIdentityService.js';
import { type AgentConfig, AgentConfigManager } from '@src/core/server/agentConfig.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { ensureRequestContextInitialized } from '@src/transport/http/routes/inspectRequestContext.js';
import { StreamableSessionLifecycle, StreamableSessionStatus } from '@src/transport/http/streamableSessionLifecycle.js';
import {
  authorizeRequestTemplateContext,
  getRequestProjectPreparationAuthority,
} from '@src/transport/http/utils/templateContextAuthority.js';
import type { ContextData } from '@src/types/context.js';

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { ServerManager } from './serverManager.js';

describe('project preparation proof boundary wiring', () => {
  it('retains opaque authority through real initial transport connection and per-request canonical selection', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'preparation-inbound-')));
    const storageDir = path.join(directory, 'storage');
    const agent = AgentConfigManager.getInstance();
    const originalGet = agent.get.bind(agent);
    const configuredGet = ((key: keyof AgentConfig) => {
      if (key === 'runtimeScopeStoragePath') return storageDir;
      if (key === 'templateContext') return { trust: 'verified' };
      return originalGet(key);
    }) as typeof agent.get;
    const get = vi.spyOn(agent, 'get').mockImplementation(configuredGet);
    const load = vi
      .spyOn(ConfigManager.getInstance(), 'loadConfigWithTemplates')
      .mockResolvedValue({ staticServers: {}, templateServers: {}, errors: [] });
    const serverManager = ServerManager.getOrCreateInstance(
      { name: 'receipt-fixture', version: '1' },
      { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {}, completions: {} } },
      new Map(),
      {},
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'receipt-client', version: '1' });
    try {
      const runtimeScopeId = new RuntimeIdentityService({ storageDir }).getRuntimeScopeId();
      const capability = new TemplateContextCapabilityStore({ storageDir, runtimeScopeId }).getOrCreate();
      const rawContext: ContextData = {
        project: {},
        user: {},
        environment: {},
        sessionId: 'session-a',
        projectSet: { projects: [{ label: 'front', path: path.join(directory, '.') }], selection: ['front'] },
      };
      const proof = createTemplateContextProof(rawContext, capability);
      const authorization = authorizeRequestTemplateContext({
        context: rawContext,
        proof,
        transportSessionId: 'session-a',
        source: 'meta',
      });
      await serverManager.connectTransport(
        serverTransport,
        'session-a',
        {},
        rawContext,
        getRequestProjectPreparationAuthority(authorization),
      );
      await client.connect(clientTransport);
      const manager = serverManager.getTemplateServerManager();
      const initialBindingId = serverManager.getServer('session-a')!.bindingId!;
      const canonical = manager.getBindingContext(initialBindingId)!;
      expect(canonical.project.path).toBe(directory);
      const receipt = manager.getBindingAuthority(initialBindingId);
      expect(
        validateProjectPreparationAuthority(receipt, {
          bindingId: initialBindingId,
          context: canonical,
          ownerSessionId: 'session-a',
        }),
      ).toBe(true);
      expect(serverManager.getServer('session-a')).not.toHaveProperty('authority');

      const req: Partial<Request> = {
        headers: { 'mcp-session-id': 'session-a' },
        query: {},
        body: { params: { _meta: { context: rawContext, contextProof: proof } } },
      };
      const requestBindingId = await ensureRequestContextInitialized(
        serverManager,
        req as Request,
        { setHeader: vi.fn() } as unknown as Response,
        {},
      );
      expect(requestBindingId).toBe(initialBindingId);
      expect(manager.getBindingAuthority(requestBindingId!)).toBeDefined();
      await serverManager.disconnectTransport('session-a');
      expect(manager.getBindingAuthority(initialBindingId)).toBeUndefined();
    } finally {
      await client.close();
      await ServerManager.resetInstance();
      get.mockRestore();
      load.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['create', 'restore'] as const)(
    'passes a process-local receipt on signed streamable %s without persisting it',
    async (operation) => {
      const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'preparation-streamable-')));
      const agent = AgentConfigManager.getInstance();
      const originalGet = agent.get.bind(agent);
      const get = vi.spyOn(agent, 'get').mockImplementation(((key: keyof AgentConfig) => {
        if (key === 'runtimeScopeStoragePath') return directory;
        if (key === 'templateContext') return { trust: 'verified' };
        return originalGet(key);
      }) as typeof agent.get);
      try {
        const runtimeScopeId = new RuntimeIdentityService({ storageDir: directory }).getRuntimeScopeId();
        const capability = new TemplateContextCapabilityStore({ storageDir: directory, runtimeScopeId }).getOrCreate();
        const context: ContextData = {
          project: { path: directory },
          user: {},
          environment: {},
          sessionId: 'session-a',
          timestamp: new Date().toISOString(),
          version: '1',
          transport: { type: 'stdio-proxy' },
        };
        const proof = createTemplateContextProof(context, capability);
        const connectTransport = vi.fn().mockResolvedValue(undefined);
        const create = vi.fn();
        const lifecycle = new StreamableSessionLifecycle(
          { connectTransport } as unknown as ServerManager,
          {
            create,
            get: () => ({ context, contextProof: proof }),
            getSessionData: () => ({ initializeResponse: {} }),
            updateAccess: vi.fn(),
          } as never,
          undefined,
          {
            createTransport: (() => ({ sessionId: 'session-a' })) as never,
            createRestorableTransport: (() => ({
              sessionId: 'session-a',
              _webStandardTransport: { _initialized: false },
              markAsRestored: vi.fn(),
            })) as never,
          },
        );
        if (operation === 'create') {
          await lifecycle.createSession({}, context, 'session-a', StreamableSessionStatus.Created, proof);
          expect(create.mock.calls[0][1]).toEqual({ context, contextProof: proof });
        } else {
          expect((await lifecycle.restoreSession('session-a')).transport).toBeDefined();
          expect(create).not.toHaveBeenCalled();
        }
        expect(connectTransport.mock.calls[0][4]).toBeDefined();
        expect(JSON.stringify(connectTransport.mock.calls[0][4])).toBe('{}');
      } finally {
        get.mockRestore();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
