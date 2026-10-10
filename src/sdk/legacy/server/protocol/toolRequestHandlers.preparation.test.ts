import { createMockLegacyInboundConnection } from '@test/unit-utils/MockFactories.js';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { getBackendPreparationCoordinator } from '@src/application/backendPreparationCoordinator.js';
import { ConfigManager } from '@src/config/configManager.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import {
  bindProjectPreparationAuthority,
  createProjectPreparationAuthority,
  normalizeProjectPreparationAuthority,
} from '@src/core/context/projectPreparationAuthority.js';
import { authorizeTemplateContext, createTemplateContextProof } from '@src/core/context/templateContextTrust.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus } from '@src/core/types/index.js';
import { shutdownSchemaBoundary } from '@src/core/validation/schemaBoundary.js';
import { withProjectBinding } from '@src/domains/project-selection/projectBindingScope.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import { Protocol } from '@src/sdk/legacy/shared/protocol.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@src/sdk/legacy/types.js';
import type { ContextData } from '@src/types/context.js';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { registerToolHandlers } from './toolRequestHandlers.js';

const native = vi.hoisted(() => ({ inspect: vi.fn(), prepare: vi.fn() }));
let currentServer: ServerManager;
const definition = {
  command: 'fixture',
  tags: ['allowed'],
  template: {},
  preparation: {
    adapter: 'codegraph',
    executable: '/installed/codegraph',
    expectedVersion: '1.6.2',
    allowedActions: ['initialize', 'sync'],
  },
};

vi.mock('@src/core/capabilities/internalCapabilitiesProvider.js', () => ({
  InternalCapabilitiesProvider: {
    getInstance: () => ({ initialize: async () => undefined, getAvailableTools: () => [], executeTool: vi.fn() }),
  },
}));
vi.mock('@src/utils/core/errorHandling.js', () => ({ withErrorHandling: (operation: unknown) => operation }));

vi.mock('@src/config/configuredServerTargets.js', () => ({
  getConfiguredServerTargets: () => ({ codegraph: definition }),
}));
vi.mock('@src/config/configManager.js', () => ({ ConfigManager: { getInstance: vi.fn() } }));
vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return currentServer;
    },
  },
}));
vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: { getInstance: () => ({ get: () => undefined, isAuthEnabled: () => false }) },
}));
vi.mock('@src/core/runtime/runtimeIdentityService.js', () => ({
  RuntimeIdentityService: class {
    getRuntimeScopeId() {
      return 'runtime-a';
    }
  },
}));
vi.mock('@src/domains/backend-preparation/codegraphAdapter.js', () => ({
  requiresCodeGraphPreparation: (name: string) => name === 'codegraph_explore',
  CodeGraphPreparationAdapter: class {
    inspect = native.inspect;
    prepare = native.prepare;
    classifyFailure() {
      return { code: 'fixture', message: 'Fixture failure', retryable: false, instructions: 'Retry' };
    }
  },
}));
vi.mock('@src/domains/backend-preparation/codegraphReadOnly.js', () => ({
  getCodeGraphPreparationToolDefinition: async () => ({
    name: 'codegraph_explore',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  }),
  disposeCodeGraphPreparationToolMetadata: async () => undefined,
}));
vi.mock('@src/core/capabilities/runtimeCapabilityCatalog.js', () => ({ acquireRuntimeCapabilityCatalog: vi.fn() }));

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  vi.clearAllMocks();
});
afterAll(shutdownSchemaBoundary);

describe('legacy source preparation entrypoint', () => {
  it.each([true, false])(
    'admits before empty catalog discovery with initial transport context=%s',
    async (hasContext) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-preparation-'));
      const checkout = await fs.realpath(directory);
      cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
      await fs.writeFile(
        path.join(checkout, '.1mcprc'),
        JSON.stringify({ preparation: { codegraph: { enabled: true } } }),
      );
      vi.mocked(ConfigManager.getInstance).mockReturnValue({
        getAppConfig: () => ({ preparation: { requestWaitMs: 1000, executionDeadlineMs: 3000 } }),
        loadDeclaredServerConfigs: () => ({
          staticServers: {},
          templateServers: { codegraph: definition },
          errors: [],
        }),
      } as never);
      const context: ContextData = { project: { path: checkout }, user: {}, environment: {}, sessionId: 'session-a' };
      const capability = {
        version: 1 as const,
        runtimeScopeId: 'runtime-a',
        secret: Buffer.alloc(32, 7).toString('base64url'),
      };
      const proof = createTemplateContextProof(context, capability);
      const verify = (signedContext: ContextData, signedProof: typeof proof, ownerSessionId: string) =>
        authorizeTemplateContext({
          context: signedContext,
          proof: signedProof,
          transportSessionId: ownerSessionId,
          mode: 'verified',
          capability,
          maxAgeMs: 1000000,
        });
      const receipt = createProjectPreparationAuthority({
        context,
        proof,
        authorization: verify(context, proof, 'session-a'),
        verify,
      })!;
      const authority = bindProjectPreparationAuthority(
        normalizeProjectPreparationAuthority(receipt, context, context),
        'binding-a',
        context,
      );
      const manager = {
        getBindingContexts: () => new Map([['binding-a', context]]),
        getBindingAuthority: () => authority,
      };
      currentServer = {
        getTemplateServerManager: () => manager,
        registerOwnedCleanup: (cleanup: () => Promise<void>) => cleanups.unshift(cleanup),
      } as unknown as ServerManager;
      native.inspect.mockResolvedValue({
        state: 'required',
        action: 'initialize',
        instructions: 'Initialize',
        evidence: { freshness: 'unknown', coverage: 'unknown', detail: 'No index' },
      });
      native.prepare.mockImplementation(
        (_target, _action, { signal }) =>
          new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
      );
      let call!: (
        request: { params: { name: string; arguments: { query: string } } },
        extra: { signal: AbortSignal },
      ) => Promise<unknown>;
      const handlers: (typeof call)[] = [];
      const inbound = createMockLegacyInboundConnection({
        ...(hasContext ? { context } : {}),
        tags: ['allowed'],
        tagFilterMode: 'simple-or',
        server: { setRequestHandler: vi.fn((_schema, callback) => handlers.push(callback)) } as never,
      });
      // Runtime notification ownership adds an own function to the live adapter.
      Object.defineProperty(inbound.adapter, 'notify', { value: async () => undefined, enumerable: true });
      registerToolHandlers(new Map(), inbound);
      call = handlers[1];
      const result = await withProjectBinding('binding-a', context, () =>
        call(
          { params: { name: 'codegraph_1mcp_codegraph_explore', arguments: { query: 'Symbol' } } },
          { signal: new AbortController().signal },
        ),
      );
      expect(result).toMatchObject({
        structuredContent: {
          operationExecuted: false,
          operationQueued: false,
          preparation: { state: 'pending', status: { id: expect.any(String) } },
        },
      });
      expect(native.inspect).toHaveBeenCalled();
      expect(native.prepare).toHaveBeenCalledOnce();
      expect(acquireRuntimeCapabilityCatalog).not.toHaveBeenCalled();
      expect(getBackendPreparationCoordinator(currentServer).service.scheduler.counts()).toEqual({
        active: 1,
        queued: 0,
      });
    },
  );
  it.each(['warm', 'long-warm', 'changed', 'revoked', 'expired'] as const)(
    'rechecks %s after real private peer setup before source dispatch',
    async (outcome) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-preparation-'));
      const checkout = await fs.realpath(directory);
      cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
      await fs.writeFile(
        path.join(checkout, '.1mcprc'),
        JSON.stringify({ preparation: { codegraph: { enabled: true } } }),
      );
      vi.mocked(ConfigManager.getInstance).mockReturnValue({
        getAppConfig: () => ({
          preparation: { requestWaitMs: outcome === 'expired' ? 150 : 1200, executionDeadlineMs: 3000 },
        }),
        loadDeclaredServerConfigs: () => ({
          staticServers: {},
          templateServers: { codegraph: definition },
          errors: [],
        }),
      } as never);
      const context: ContextData = { project: { path: checkout }, user: {}, environment: {}, sessionId: 'session-a' };
      const capability = {
        version: 1 as const,
        runtimeScopeId: 'runtime-a',
        secret: Buffer.alloc(32, 7).toString('base64url'),
      };
      const proof = createTemplateContextProof(context, capability);
      let revoked = false;
      const verify = (signedContext: ContextData, signedProof: typeof proof, ownerSessionId: string) =>
        authorizeTemplateContext({
          context: signedContext,
          proof: signedProof,
          transportSessionId: ownerSessionId,
          mode: revoked ? 'legacy' : 'verified',
          capability,
          maxAgeMs: 1000000,
        });
      const receipt = createProjectPreparationAuthority({
        context,
        proof,
        authorization: verify(context, proof, 'session-a'),
        verify,
      })!;
      const authority = bindProjectPreparationAuthority(
        normalizeProjectPreparationAuthority(receipt, context, context),
        'binding-a',
        context,
      );
      const manager = {
        getBindingContexts: () => new Map([['binding-a', context]]),
        getBindingAuthority: () => authority,
        getBindingPolicies: () => [],
        getBindingConfiguration: () => ({ tags: ['allowed'], tagFilterMode: 'simple-or' }),
        getAllRenderedHashesForSession: () => new Map([['codegraph', 'hash']]),
        getRenderedHashForSession: () => 'hash',
      };
      currentServer = {
        getTemplateServerManager: () => manager,
        getClients: () => connections,
        getLazyLoadingOrchestrator: () => undefined,
        registerOwnedCleanup: (cleanup: () => Promise<void>) => cleanups.unshift(cleanup),
      } as unknown as ServerManager;

      let changed = false;
      const required = {
        state: 'required',
        action: 'sync',
        instructions: 'Sync',
        evidence: { freshness: 'stale', coverage: 'complete', detail: 'Edited' },
      };
      native.inspect.mockImplementation(async () =>
        changed
          ? required
          : { state: 'ready', evidence: { freshness: 'current', coverage: 'complete', detail: 'Native barrier' } },
      );
      native.prepare.mockImplementation(
        (_target, _action, { signal }) =>
          new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
      );
      const tools = [
        {
          name: 'codegraph_explore',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        },
      ];
      const sourceCall = vi.fn(async () => {
        if (outcome === 'long-warm') await new Promise((resolve) => setTimeout(resolve, 300));
        return { content: [], structuredContent: { value: 'source' } };
      });
      const peers: Server[] = [];
      const recreate = (): AuthProviderTransport => {
        const peer = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } });
        peers.push(peer);
        peer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
        peer.setRequestHandler(CallToolRequestSchema, sourceCall);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        void peer.connect(serverTransport);
        return Object.assign(clientTransport, { recreate });
      };
      const transport = recreate();
      const client = new Client({ name: 'source', version: '1' });
      await client.connect(transport);
      cleanups.push(async () => {
        await client.close();
        await Promise.all(peers.map((peer) => peer.close()));
      });
      const connection = createLegacyOutboundConnection({
        name: 'codegraph',
        client,
        transport,
        status: ClientStatus.Connected,
        capabilities: { tools: {} },
      });
      const connections = new Map([['codegraph:hash', connection]]);
      const entry = {
        route: {
          kind: 'tools',
          origin: 'external',
          server: 'codegraph',
          upstreamIdentity: 'codegraph_explore',
          connectionKey: 'codegraph:hash',
        },
        sourceObject: tools[0],
      };
      const validateOutput = Object.assign(
        vi.fn(async () => undefined),
        { assertCurrent: vi.fn(), targetArguments: { query: 'Symbol' } },
      );
      let catalogReads = 0;
      vi.mocked(acquireRuntimeCapabilityCatalog).mockImplementation(async (_connections, _visibility, options) => {
        catalogReads++;
        if (catalogReads === 2) {
          // This is the actual private peer catalog await after its native initialize.
          expect(peers).toHaveLength(2);
          if (outcome === 'long-warm') await new Promise((resolve) => setTimeout(resolve, 1000));
          if (outcome === 'expired')
            await new Promise<void>((resolve) =>
              options!.signal!.addEventListener('abort', () => resolve(), { once: true }),
            );
          await Promise.resolve();
          changed = outcome === 'changed';
          revoked = outcome === 'revoked';
        }
        return {
          generation: { entries: [entry] },
          resolve: () => ({ entry, connection }),
          prepareToolCall: async () => validateOutput,
          isCurrent: () => true,
        } as never;
      });
      const handlers: ((
        request: { params: { name: string; arguments: { query: string } } },
        extra: { signal: AbortSignal },
      ) => Promise<unknown>)[] = [];
      const inboundServer = new Server({ name: 'inbound', version: '1' });
      vi.spyOn(inboundServer, 'getClientCapabilities').mockReturnValue({ roots: {} });
      vi.spyOn(inboundServer, 'setRequestHandler').mockImplementation((_schema, callback) => {
        handlers.push(callback as never);
      });
      const inbound = createMockLegacyInboundConnection({
        context,
        canonicalSchemaProjection: true,
        tags: ['allowed'],
        tagFilterMode: 'simple-or',
        server: inboundServer,
      });
      const originalRegister = Protocol.prototype.setRequestHandler;
      const registration = vi.spyOn(Protocol.prototype, 'setRequestHandler').mockImplementation(function (
        this: unknown,
        schema,
        callback,
      ) {
        if (this === inboundServer) handlers.push(callback as never);
        else Reflect.apply(originalRegister, this, [schema, callback]);
      });
      registerToolHandlers(connections, inbound);
      registration.mockRestore();
      const invoke = () =>
        withProjectBinding('binding-a', context, () =>
          handlers[1](
            { params: { name: 'codegraph_1mcp_codegraph_explore', arguments: { query: 'Symbol' } } },
            { signal: new AbortController().signal },
          ),
        );
      if (outcome === 'expired') {
        await expect(invoke()).rejects.toThrow('interaction_lost');
        expect(native.inspect).toHaveBeenCalledOnce();
      } else {
        const result = await invoke();
        if (outcome === 'warm' || outcome === 'long-warm') {
          expect(sourceCall).toHaveBeenCalledOnce();
          expect(native.inspect).toHaveBeenCalledTimes(2);
          expect(validateOutput).toHaveBeenCalledOnce();
          expect(result).toMatchObject({ structuredContent: { value: 'source' } });
        } else {
          expect(result).toMatchObject({
            structuredContent: {
              operationExecuted: false,
              operationQueued: false,
              preparation: { state: outcome === 'changed' ? 'pending' : 'forbidden' },
            },
          });
          expect(validateOutput).not.toHaveBeenCalled();
        }
      }
      if (outcome !== 'warm' && outcome !== 'long-warm') expect(sourceCall).not.toHaveBeenCalled();
      expect(native.prepare).toHaveBeenCalledTimes(outcome === 'changed' ? 1 : 0);
      expect(catalogReads).toBe(2);
    },
  );
});
