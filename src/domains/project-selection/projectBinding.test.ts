import { createMockClient, createMockTransport } from '@test/unit-utils/MockFactories.js';

import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { ConfigManager } from '@src/config/configManager.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import type { TrustedTemplateContext } from '@src/core/context/templateContextTrust.js';
import type { PooledClientInstance } from '@src/core/server/clientInstancePool.js';
import { ConnectionResolver } from '@src/core/server/connectionResolver.js';
import {
  prepareRequestContext,
  type RequestContextPreparationDependencies,
} from '@src/core/server/requestContextPreparation.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { TemplateServerManager } from '@src/core/server/templateServerManager.js';
import type { MCPServerParams, OutboundConnections } from '@src/core/types/index.js';
import { Client as InboundClient } from '@src/sdk/legacy/client/index.js';
import type { Client } from '@src/sdk/legacy/client/index.js';

import { describe, expect, it, vi } from 'vitest';

import { withProjectBinding } from './projectBindingScope.js';
import { withProjectSelection } from './projectSelection.js';

describe('target-bound template lifecycle', () => {
  it('expires ephemeral target metadata without templates and retains live transport bindings until owner cleanup', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'binding-expiry-')));
    vi.useFakeTimers();
    const manager = new TemplateServerManager({ idleTimeoutMs: 100, cleanupIntervalMs: 10000 });
    const outbound: OutboundConnections = new Map();
    try {
      const context = { project: { path: directory }, user: {}, environment: {}, sessionId: 'rest-owner' };
      const ephemeral = await manager.registerBindingContext('ignored', context);
      const persistent = await manager.registerBindingContext('ignored', { ...context, sessionId: 'transport-owner' });
      manager.trackPersistentClient(persistent);
      vi.advanceTimersByTime(101);
      await manager.cleanupIdleInstances(outbound, {});
      expect(manager.getBindingContext(ephemeral)).toBeUndefined();
      expect(manager.getBindingPolicies(ephemeral)).toEqual([]);
      expect(manager.getBindingContext(persistent)).toBeDefined();
      expect((manager as unknown as { ownerBindings: Map<string, Set<string>> }).ownerBindings.has('rest-owner')).toBe(
        false,
      );
      await manager.cleanupTemplateServers('transport-owner', outbound, {});
      expect(manager.getBindingContext(persistent)).toBeUndefined();
    } finally {
      await manager.shutdown();
      vi.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns unique checkout symbols through real stdio backends for one agent session', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'project-stdio-')));
    const manager = new TemplateServerManager();
    const outbound: OutboundConnections = new Map();
    const transports = {};
    try {
      await Promise.all(
        ['frontend', 'backend'].map(async (label) => {
          await mkdir(path.join(directory, label));
          await writeFile(path.join(directory, label, 'source.ts'), `export function ${label}OnlySymbol() {}`);
        }),
      );
      const script = path.join(directory, 'fixture.mjs');
      await writeFile(
        script,
        `import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'checkout-fixture', version: '1' } };
  else if (request.method === 'tools/list') result = { tools: [{ name: 'source', inputSchema: { type: 'object' } }] };
  else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: readFileSync(join(root, 'source.ts'), 'utf8') }] };
  else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
}
`,
      );
      const context = {
        project: {},
        user: {},
        environment: {},
        projectSet: {
          projects: ['frontend', 'backend'].map((label) => ({ label, path: path.join(directory, label) })),
        },
      };
      const deps: RequestContextPreparationDependencies = {
        deriveSessionId: () => 'one-agent-session',
        loadRenderedTemplates: async (selected) => ({
          checkout: {
            type: 'stdio',
            command: process.execPath,
            args: [script, selected.project.path!],
            protocolVersion: 'legacy',
            template: { shareable: true },
          },
        }),
        getRenderedHashForSession: manager.getRenderedHashForSession.bind(manager),
        touchEphemeralClient: manager.touchEphemeralClient.bind(manager),
        createTemplateBasedServers: manager.createTemplateBasedServers.bind(manager),
        registerBindingContext: manager.registerBindingContext.bind(manager),
        hasTemplateAdapter: () => true,
        registerTemplateAdapter: () => {},
        getOutboundConnections: () => outbound,
        getClientTransports: () => transports,
        refreshCapabilities: async () => {},
      };
      const results = await Promise.all(
        ['frontend', 'backend'].map(async (label) => {
          const selected = withProjectSelection(context, {
            ...context.projectSet,
            selection: [label],
          }) as TrustedTemplateContext;
          const prepared = await prepareRequestContext({
            deps,
            context: selected,
            transportSessionId: 'one-agent-session',
            filterConfig: {},
          });
          if (!('bindingId' in prepared)) throw new Error('Missing selected binding');
          const connection = new ConnectionResolver(outbound, manager).resolve('checkout', prepared.bindingId);
          if (!connection)
            throw new Error(`Fixture backend unavailable: ${JSON.stringify(manager.getFailedTemplates())}`);
          return requestLegacyAdapter(connection.adapter, 'tools/call', { name: 'source', arguments: {} });
        }),
      );
      expect(results).toEqual(
        ['frontend', 'backend'].map((label) => ({
          content: [{ type: 'text', text: `export function ${label}OnlySymbol() {}` }],
        })),
      );

      // Also exercise the real initialize / inbound configuration snapshot / tools-call path.
      const serverManager = ServerManager.getOrCreateInstance(
        { name: 'selection-fixture', version: '1' },
        { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {}, completions: {} } },
        outbound,
        transports,
      );
      const configManager = ConfigManager.getInstance();
      const load = vi.spyOn(configManager, 'loadConfigWithTemplates').mockImplementation(async (selected) => ({
        staticServers: {},
        templateServers: selected ? await deps.loadRenderedTemplates(selected) : {},
        errors: [],
      }));
      const declared = vi
        .spyOn(McpConfigManager.getInstance(), 'getConfiguredServerTargets')
        .mockReturnValue({ checkout: { type: 'stdio', command: process.execPath, template: {} } });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const inboundClient = new InboundClient({ name: 'worker-fixture', version: '1' });
      try {
        const initial = withProjectSelection(context, { ...context.projectSet, selection: ['frontend'] });
        await serverManager.connectTransport(serverTransport, 'initial-agent', {}, initial);
        await inboundClient.connect(clientTransport);
        expect(serverManager.getServer('initial-agent')?.bindingId).toMatch(/^binding-/);
        const source = await inboundClient.callTool({ name: 'checkout_1mcp_source', arguments: {} });
        expect(source.content).toEqual([{ type: 'text', text: 'export function frontendOnlySymbol() {}' }]);
        const backendContext = withProjectSelection(
          { ...context, sessionId: 'initial-agent' },
          { ...context.projectSet, selection: ['backend'] },
        );
        const runtimeTemplates = serverManager.getTemplateServerManager();
        const backendPreparation = await prepareRequestContext({
          deps: {
            ...deps,
            registerBindingContext: runtimeTemplates.registerBindingContext.bind(runtimeTemplates),
            getRenderedHashForSession: runtimeTemplates.getRenderedHashForSession.bind(runtimeTemplates),
            createTemplateBasedServers: runtimeTemplates.createTemplateBasedServers.bind(runtimeTemplates),
            touchEphemeralClient: runtimeTemplates.touchEphemeralClient.bind(runtimeTemplates),
          },
          context: backendContext as TrustedTemplateContext,
          transportSessionId: 'initial-agent',
          filterConfig: {},
        });
        if (!('bindingId' in backendPreparation)) throw new Error('Missing backend binding');
        const sourceCalls = await Promise.all([
          withProjectBinding(
            serverManager.getServer('initial-agent')!.bindingId!,
            { ...initial, sessionId: 'initial-agent' },
            () => inboundClient.callTool({ name: 'checkout_1mcp_source', arguments: {} }),
          ),
          withProjectBinding(backendPreparation.bindingId, backendContext, () =>
            inboundClient.callTool({ name: 'checkout_1mcp_source', arguments: {} }),
          ),
        ]);
        expect(sourceCalls.map((result) => result.content)).toEqual(
          ['frontend', 'backend'].map((label) => [{ type: 'text', text: `export function ${label}OnlySymbol() {}` }]),
        );
        const unresolvedContext = { ...context, sessionId: 'initial-agent' };
        const unresolved = await runtimeTemplates.registerBindingContext('ignored', unresolvedContext);
        await expect(
          withProjectBinding(unresolved, unresolvedContext, () =>
            inboundClient.callTool({ name: 'checkout_1mcp_source', arguments: {} }),
          ),
        ).rejects.toThrow('frontend, backend');
      } finally {
        await inboundClient.close();
        await serverManager.disconnectTransport('initial-agent');
        await ServerManager.resetInstance();
        load.mockRestore();
        declared.mockRestore();
      }
    } finally {
      await manager.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('routes concurrent workers in the same canonical session to their own source tree and cleans up only owned bindings', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'project-binding-')));
    const manager = new TemplateServerManager();
    const outbound: OutboundConnections = new Map();
    const transports = {};
    try {
      await Promise.all(
        ['frontend', 'backend'].map(async (label) => {
          const checkout = path.join(directory, label);
          await mkdir(checkout);
          await writeFile(path.join(checkout, 'source.txt'), `${label}-only-symbol`);
        }),
      );
      const instances = new Map<string, PooledClientInstance>();
      const pool = manager.getClientInstancePool();
      const create = vi
        .spyOn(pool, 'getOrCreateClientInstance')
        .mockImplementation(async (name, config, context, bindingId, options) => {
          expect(options).toMatchObject({ perClient: true, shareable: false });
          const client = createMockClient({
            getInstructions: () => '',
            getServerCapabilities: () => ({ tools: {} }),
            request: vi.fn(
              async () =>
                ({
                  content: [
                    { type: 'text', text: await readFile(path.join(context.project.path!, 'source.txt'), 'utf8') },
                  ],
                }) as never,
            ),
          }) as Client;
          const instance: PooledClientInstance = {
            id: bindingId,
            instanceKey: `${name}:same-rendered-config:${bindingId}`,
            templateName: name,
            client,
            transport: createMockTransport(),
            renderedHash: 'same-rendered-config',
            runtimeFingerprint: 'fixture',
            processedConfig: config,
            referenceCount: 1,
            createdAt: new Date(),
            lastUsedAt: new Date(),
            status: 'active',
            outboundKeys: new Set(),
            clientIds: new Set([bindingId]),
            idleTimeout: 300000,
          };
          instances.set(instance.instanceKey, instance);
          return instance;
        });
      vi.spyOn(pool, 'getInstance').mockImplementation((key) => instances.get(key));
      vi.spyOn(pool, 'getInstanceKeyById').mockImplementation(
        (id) => [...instances.values()].find((instance) => instance.id === id)?.instanceKey,
      );
      const config: MCPServerParams = {
        type: 'stdio',
        command: 'fixture',
        tags: ['frontend', 'backend'],
        template: { shareable: true },
      };
      const base = {
        project: {},
        user: {},
        environment: {},
        sessionId: 'shared-agent',
        projectSet: {
          projects: ['frontend', 'backend'].map((label) => ({ label, path: path.join(directory, label) })),
        },
      };
      const contexts = ['frontend', 'backend'].map(
        (label) => withProjectSelection(base, { ...base.projectSet, selection: [label] }) as TrustedTemplateContext,
      );
      const deps: RequestContextPreparationDependencies = {
        deriveSessionId: () => 'shared-agent',
        loadRenderedTemplates: async () => ({ checkout: config }),
        getRenderedHashForSession: manager.getRenderedHashForSession.bind(manager),
        touchEphemeralClient: manager.touchEphemeralClient.bind(manager),
        createTemplateBasedServers: manager.createTemplateBasedServers.bind(manager),
        registerBindingContext: manager.registerBindingContext.bind(manager),
        hasTemplateAdapter: () => true,
        registerTemplateAdapter: () => {},
        getOutboundConnections: () => outbound,
        getClientTransports: () => transports,
        refreshCapabilities: async () => {},
      };
      const prepared = await Promise.all(
        contexts.map((context) =>
          prepareRequestContext({ deps, context, transportSessionId: 'shared-agent', filterConfig: {} }),
        ),
      );
      const bindingIds = prepared.map((result) => {
        if (!('bindingId' in result)) throw new Error('Missing target binding');
        expect(result.sessionId).toBe('shared-agent');
        return result.bindingId;
      });
      expect(new Set(bindingIds).size).toBe(2);
      const resolver = new ConnectionResolver(outbound, manager);
      const evidence = await Promise.all(
        bindingIds.map(async (bindingId) => {
          const connection = resolver.resolve('checkout', bindingId)!;
          return requestLegacyAdapter(connection.adapter, 'tools/call', { name: 'checkout_evidence', arguments: {} });
        }),
      );
      expect(evidence).toEqual([
        { content: [{ type: 'text', text: 'frontend-only-symbol' }] },
        { content: [{ type: 'text', text: 'backend-only-symbol' }] },
      ]);
      await prepareRequestContext({ deps, context: contexts[0], transportSessionId: 'shared-agent', filterConfig: {} });
      expect(create).toHaveBeenCalledTimes(2);
      const filtered = await prepareRequestContext({
        deps,
        context: contexts[0],
        transportSessionId: 'shared-agent',
        filterConfig: { tagFilterMode: 'simple-or', tags: ['frontend'] },
      });
      if (!('bindingId' in filtered)) throw new Error('Missing filtered binding');
      expect(filtered.bindingId).not.toBe(bindingIds[0]);
      expect(create).toHaveBeenCalledTimes(3);
      await prepareRequestContext({ deps, context: contexts[0], transportSessionId: 'other-agent', filterConfig: {} });
      expect(create).toHaveBeenCalledTimes(4);
      await manager.cleanupTemplateServers('shared-agent', outbound, transports);
      expect(bindingIds.map((bindingId) => resolver.resolve('checkout', bindingId))).toEqual([undefined, undefined]);
      expect(outbound.size).toBe(1);
    } finally {
      await manager.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
