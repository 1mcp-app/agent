import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import * as toolSchemaBoundary from '@src/core/validation/toolSchemaBoundary.js';
import { ConfigManager } from '@src/config/configManager.js';
import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { CapabilityCatalog } from '@src/core/capabilities/capabilityCatalog.js';
import { buildCatalogGeneration } from '@src/core/capabilities/catalogGeneration.js';
import { SchemaCache } from '@src/core/capabilities/schemaCache.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import {
  bindProjectPreparationAuthority,
  createProjectPreparationAuthority,
  normalizeProjectPreparationAuthority,
} from '@src/core/context/projectPreparationAuthority.js';
import {
  authorizeTemplateContext,
  createTemplateContextProof,
  type TemplateContextTrustMode,
} from '@src/core/context/templateContextTrust.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { TemplateServerManager } from '@src/core/server/templateServerManager.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import { shutdownSchemaBoundary } from '@src/core/validation/schemaBoundary.js';
import type { ContextData } from '@src/types/context.js';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  admitBackendPreparationTool,
  createPreparationOwnerIdentity,
  revalidatePreparationAuthentication,
  withPreparationRequestScope,
} from './backendPreparationAdmission.js';
import type { BackendPreparationCoordinator, PreparationGrant } from './backendPreparationCoordinator.js';

vi.mock('@src/config/configuredServerTargets.js', () => ({
  getConfiguredServerTargets: () => ({ codegraph: definition }),
}));
vi.mock('@src/config/configManager.js', () => ({ ConfigManager: { getInstance: vi.fn() } }));
vi.mock('@src/core/runtime/runtimeIdentityService.js', () => ({
  RuntimeIdentityService: class {
    getRuntimeScopeId() {
      return 'runtime-a';
    }
  },
}));
vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: { getInstance: () => ({ get: () => undefined, isAuthEnabled: () => authenticationEnabled }) },
}));
let authenticationEnabled = true;

const definition: MCPServerParams = {
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
const nativeDefinition = {
  name: 'codegraph_explore',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};
const pending = {
  state: 'pending' as const,
  operationExecuted: false as const,
  operationQueued: false as const,
  status: { id: 'opaque-id' },
  instructions: 'Wait using preparation controls, then explicitly invoke again.',
};

function fixture(waitMs = 5000) {
  let currentDefinition = structuredClone(definition);
  const renderConfig = vi.fn(async () => ({
    staticServers: {},
    templateServers: { codegraph: currentDefinition },
    errors: [] as string[],
  }));
  vi.mocked(ConfigManager.getInstance).mockReturnValue({
    getAppConfig: () => ({ preparation: { requestWaitMs: waitMs } }),
    loadDeclaredServerConfigs: () => ({
      staticServers: {},
      templateServers: { codegraph: currentDefinition },
      errors: [],
    }),
    loadConfigWithTemplates: renderConfig,
  } as never);
  const context: ContextData = {
    project: { path: '/repo/frontend' },
    user: {},
    environment: {},
    sessionId: 'session-a',
  };
  let bindingPresent = true;
  const capability = {
    version: 1 as const,
    runtimeScopeId: 'runtime-a',
    secret: Buffer.alloc(32, 7).toString('base64url'),
  };
  const proof = createTemplateContextProof(context, capability);
  let trust: TemplateContextTrustMode = 'verified';
  const verify = vi.fn((signedContext, signedProof, ownerSessionId) =>
    authorizeTemplateContext({
      context: signedContext,
      proof: signedProof,
      transportSessionId: ownerSessionId,
      mode: trust,
      capability,
      maxAgeMs: 1000000,
    }),
  );
  const receipt = createProjectPreparationAuthority({
    context,
    proof,
    authorization: verify(context, proof, context.sessionId),
    verify,
  })!;
  let authority = bindProjectPreparationAuthority(
    normalizeProjectPreparationAuthority(receipt, context, context),
    'binding-a',
    context,
  );
  const manager = {
    getBindingContext: () => context,
    getBindingContexts: () => new Map(bindingPresent ? [['binding-a', context]] : []),
    getBindingAuthority: () => authority,
  };
  const serverManager = { getTemplateServerManager: () => manager } as unknown as ServerManager;
  const grant: PreparationGrant = {
    owner: 'owner',
    target: {
      checkoutRoot: '/repo/frontend',
      backendName: 'codegraph',
      backendIdentity: 'identity',
      configurationKey: 'config',
    },
    policy: { allowedActions: ['initialize', 'sync'] },
    preferences: { codegraph: { enabled: true } },
  };
  const coordinator = {
    resolveGrant: vi.fn(async () => grant),
    admit: vi.fn<BackendPreparationCoordinator['admit']>(async () => ({
      state: 'ready' as const,
      readiness: {
        state: 'ready' as const,
        evidence: { freshness: 'current' as const, coverage: 'complete' as const, detail: 'native journal' },
      },
    })),
  };
  const toolDefinition = vi.fn(async () => nativeDefinition);
  const validateArguments = vi.fn(async () => undefined);
  const refresh = vi.fn(async () => undefined);
  const input = {
    serverManager,
    bindingId: 'binding-a',
    ownerSessionId: 'session-a',
    filterConfig: { tags: ['allowed'], tagFilterMode: 'simple-or' as const },
    authentication: ['fixture-client', 'fixture-token', ['tag:allowed'], ['allowed']],
    revalidateAuth: vi.fn(async () => true),
    request: { name: `codegraph${MCP_URI_SEPARATOR}codegraph_explore`, arguments: { query: 'Symbol' } },
  };
  return {
    input,
    ports: { coordinator, toolDefinition, validateArguments, refresh },
    grant,
    renderConfig,
    configureVisibility: (value: string) => {
      currentDefinition = { ...currentDefinition, env: { CODEGRAPH_MCP_TOOLS: value } };
    },
    verify,
    removeAuthority: () => {
      authority = undefined;
    },
    removeBinding: () => {
      bindingPresent = false;
      authority = undefined;
    },
    cloneAuthority: () => {
      authority = JSON.parse(JSON.stringify(authority));
    },
    revoke: () => {
      trust = 'legacy';
    },
    changeConfig: () => {
      currentDefinition = { ...currentDefinition, disabled: true };
    },
  };
}

beforeEach(() => {
  vi.useRealTimers();
  authenticationEnabled = true;
});
afterAll(() => shutdownSchemaBoundary());

describe('source operation preparation admission', () => {
  it.each([
    'changed',
    'warm',
    'revoked',
    'cancelled',
    'late-revoked',
    'late-cancelled',
    'cold-ready',
    'exhausted',
  ] as const)(
    'checks %s state after actual catalog schema validation before original source dispatch',
    async (outcome) => {
      let now = Date.now();
      const clock =
        outcome === 'cold-ready' || outcome === 'exhausted'
          ? vi.spyOn(Date, 'now').mockImplementation(() => now)
          : undefined;
      const f = fixture(clock ? 100 : 5000);
      const controller = new AbortController();
      let sourceChanged = false;
      f.ports.coordinator.admit.mockImplementation(async () => {
        if (outcome === 'cold-ready' && f.ports.coordinator.admit.mock.calls.length === 1) now += 20;
        return sourceChanged
          ? {
              ...pending,
              status: {
                ...pending.status,
                target: { checkoutRoot: '/repo/frontend', backendName: 'codegraph' },
                operation: 'codegraph_explore',
                action: 'sync',
                state: 'running',
                attempt: 1,
                executionDeadlineMs: 120000,
              },
            }
          : ({
              state: 'ready',
              readiness: {
                state: 'ready',
                evidence: { freshness: 'current', coverage: 'complete', detail: 'native barrier' },
              },
            } as never);
      });
      const admission = await admitBackendPreparationTool({ ...f.input, signal: controller.signal }, f.ports);
      expect(admission.kind).toBe('ready');
      if (admission.kind !== 'ready') throw new Error('Expected ready admission');
      const request = vi.fn(async () => ({ content: [] }));
      const connection = createMockOutboundConnection({ name: 'codegraph', adapter: { request } });
      const connections = new Map([['codegraph', connection]]);
      const registry = ToolRegistry.fromGeneration(
        buildCatalogGeneration(1, [
          {
            kind: 'tools',
            server: 'codegraph',
            connectionKey: 'codegraph',
            object: nativeDefinition,
          },
        ]),
      ).withConnections(connections);
      const catalog = new CapabilityCatalog({
        getToolRegistry: () => registry,
        schemaCache: new SchemaCache({ maxEntries: 10 }),
        outboundConnections: connections,
        getServerConfigs: () => ({ codegraph: definition }),
      });
      const original = toolSchemaBoundary.prepareToolValidation;
      const validation = vi.spyOn(toolSchemaBoundary, 'prepareToolValidation').mockImplementation(async (...args) => {
        const prepared = await original(...args);
        if (outcome === 'cold-ready') now += 10;
        if (outcome === 'exhausted') now += 100;
        sourceChanged = outcome === 'changed';
        if (outcome === 'revoked') f.revoke();
        if (outcome === 'cancelled') controller.abort();
        return prepared;
      });
      try {
        const result = await catalog.invokeVisibleTool(
          { server: 'codegraph', toolName: 'codegraph_explore', args: { query: 'Symbol' } },
          undefined,
          {
            beforeDispatch: async () => {
              const decision = await admission.beforeDispatch();
              if (outcome === 'late-revoked') queueMicrotask(() => f.revoke());
              if (outcome === 'late-cancelled') queueMicrotask(() => controller.abort());
              return decision;
            },
          },
        );
        if (outcome === 'warm' || outcome === 'cold-ready') {
          expect(result.result).toEqual({ content: [] });
          expect(request).toHaveBeenCalledOnce();
          expect(f.ports.coordinator.admit).toHaveBeenCalledTimes(2);
          if (outcome === 'cold-ready') {
            expect(f.ports.coordinator.admit.mock.calls[0][2]?.waitMs).toBe(100);
            expect(f.ports.coordinator.admit.mock.calls[1][2]?.waitMs).toBe(70);
          }
          return;
        }
        if (outcome === 'changed')
          expect(result).toMatchObject({
            result: {
              preparation: { state: 'pending', status: { id: 'opaque-id' } },
              operationExecuted: false,
              operationQueued: false,
            },
          });
        if (outcome === 'exhausted')
          expect(result).toMatchObject({
            result: {
              preparation: { state: 'unknown', reason: 'inspection_timeout' },
              operationExecuted: false,
              operationQueued: false,
            },
          });
        expect(request).not.toHaveBeenCalled();
        expect(f.ports.coordinator.admit).toHaveBeenCalledTimes(
          outcome === 'changed' || outcome.startsWith('late-') ? 2 : 1,
        );
      } finally {
        validation.mockRestore();
        clock?.mockRestore();
      }
    },
  );
  it('keeps compatible concurrent requests authorized when the real manager renews the same verified binding', async () => {
    const f = fixture();
    const manager = new TemplateServerManager();
    const context = structuredClone(
      f.input.serverManager.getTemplateServerManager().getBindingContexts().get('binding-a')!,
    );
    const capability = {
      version: 1 as const,
      runtimeScopeId: 'runtime-a',
      secret: Buffer.alloc(32, 7).toString('base64url'),
    };
    const verify = (
      signedContext: ContextData,
      proof: ReturnType<typeof createTemplateContextProof>,
      ownerSessionId: string,
    ) =>
      authorizeTemplateContext({
        context: signedContext,
        proof,
        transportSessionId: ownerSessionId,
        mode: 'verified',
        capability,
        maxAgeMs: 1000000,
      });
    const renewedReceipt = () => {
      const proof = createTemplateContextProof(context, capability);
      return normalizeProjectPreparationAuthority(
        createProjectPreparationAuthority({
          context,
          proof,
          authorization: verify(context, proof, 'session-a'),
          verify,
        }),
        context,
        context,
      );
    };
    try {
      f.input.bindingId = await manager.registerBindingContext(
        'session-a',
        context,
        f.input.filterConfig,
        renewedReceipt(),
      );
      f.input.serverManager.getTemplateServerManager = () => manager;
      f.ports.coordinator.admit.mockImplementationOnce(async (_grant, _operation, options) => {
        expect(
          await manager.registerBindingContext(
            'session-a',
            structuredClone(context),
            f.input.filterConfig,
            renewedReceipt(),
          ),
        ).toBe(f.input.bindingId);
        expect(await options?.validateAdmission?.()).toBe(true);
        return {
          state: 'ready',
          readiness: { state: 'ready', evidence: { freshness: 'current', coverage: 'complete', detail: 'native' } },
        };
      });
      expect((await admitBackendPreparationTool(f.input, f.ports)).kind).toBe('ready');
      expect(f.ports.coordinator.admit).toHaveBeenCalledOnce();
    } finally {
      await manager.shutdown();
    }
  });
  it('revalidates current auth-disabled configuration while preserving provider-backed grants', async () => {
    const provider = vi.fn(async () => false);
    expect(await revalidatePreparationAuthentication(undefined, provider)).toBe(false);
    authenticationEnabled = false;
    expect(await revalidatePreparationAuthentication(undefined, provider)).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    expect(await revalidatePreparationAuthentication({}, provider)).toBe(false);
    expect(provider).toHaveBeenCalledOnce();
    authenticationEnabled = true;
    expect(await revalidatePreparationAuthentication(undefined, provider)).toBe(false);
  });
  it('rejects a lost selected binding before target work rather than falling back to unscoped dispatch', async () => {
    const f = fixture();
    f.removeBinding();
    expect((await admitBackendPreparationTool(f.input, f.ports)).kind).toBe('blocked');
    expect(f.ports.coordinator.resolveGrant).not.toHaveBeenCalled();
    expect(f.ports.coordinator.admit).not.toHaveBeenCalled();
  });
  it('rejects binding cleanup at the final post-ready dispatch fence', async () => {
    const f = fixture();
    const admission = await admitBackendPreparationTool(f.input, f.ports);
    if (admission.kind !== 'ready') throw new Error('expected ready admission');
    f.removeBinding();
    expect(await admission.revalidate()).toBe(false);
  });
  it('rechecks live proof after an awaited provider fence and denies target work when trust changes there', async () => {
    const f = fixture();
    f.input.revalidateAuth.mockImplementationOnce(async () => {
      f.revoke();
      return true;
    });
    expect((await admitBackendPreparationTool(f.input, f.ports)).kind).toBe('blocked');
    expect(f.ports.coordinator.resolveGrant).not.toHaveBeenCalled();
    expect(f.ports.coordinator.admit).not.toHaveBeenCalled();
  });

  it('rechecks removal during the last awaited provider fence before a scheduling assertion', async () => {
    const f = fixture();
    f.ports.coordinator.admit.mockImplementationOnce(async (_grant, _operation, options) => {
      f.input.revalidateAuth
        .mockImplementationOnce(async () => true)
        .mockImplementationOnce(async () => {
          f.removeBinding();
          return true;
        });
      expect(await options?.validateAdmission?.()).toBe(false);
      expect(() => options?.assertAdmission?.()).toThrow('Preparation authorization changed');
      return { state: 'forbidden', instructions: 'Authority revoked' };
    });
    expect((await admitBackendPreparationTool(f.input, f.ports)).kind).toBe('blocked');
  });
  it('preserves existing query dispatch without any new local preparation authority', async () => {
    const f = fixture();
    f.removeAuthority();
    expect(await admitBackendPreparationTool(f.input, f.ports)).toEqual({ kind: 'unaffected' });
    expect(f.ports.coordinator.resolveGrant).not.toHaveBeenCalled();
    expect(f.ports.toolDefinition).not.toHaveBeenCalled();
    expect(f.ports.coordinator.admit).not.toHaveBeenCalled();
  });
  it('uses only the resolved configured native visibility under the verified checkout and caller budget', async () => {
    vi.useFakeTimers();
    const f = fixture(50);
    f.configureVisibility('{{project.visibility}}');
    f.renderConfig.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 20);
      return {
        staticServers: {},
        templateServers: { codegraph: { ...definition, env: { CODEGRAPH_MCP_TOOLS: 'search,explore' } } },
        errors: [],
      };
    });
    await admitBackendPreparationTool(
      { ...f.input, request: { ...f.input.request, arguments: { query: 'Symbol', toolVisibility: 'files' } } },
      f.ports,
    );
    expect(f.renderConfig).toHaveBeenCalledWith(
      expect.objectContaining({ project: { path: '/repo/frontend' }, sessionId: 'session-a' }),
    );
    expect(f.ports.toolDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ toolVisibility: 'search,explore' }),
      expect.objectContaining({ executionDeadlineMs: 30 }),
    );
    expect(f.ports.coordinator.admit.mock.calls[0][2]).toMatchObject({ waitMs: 30 });
    vi.useRealTimers();
  });
  it.each([
    'unknown',
    `codegraph${MCP_URI_SEPARATOR}codegraph_status`,
    `codegraph${MCP_URI_SEPARATOR}not_a_native_tool`,
  ])('does no target or metadata work for %s', async (name) => {
    const f = fixture();
    expect(
      await admitBackendPreparationTool(
        {
          ...f.input,
          serverManager: () => {
            throw new Error('must not touch runtime target');
          },
          request: { name, arguments: {} },
        },
        f.ports,
      ),
    ).toEqual({ kind: 'unaffected' });
    expect(f.ports.coordinator.resolveGrant).not.toHaveBeenCalled();
    expect(f.ports.toolDefinition).not.toHaveBeenCalled();
  });
  it.each(['cloned', 'expired', 'owner', 'excluded'] as const)(
    'rejects %s authority/selection before checkout reads or preparation',
    async (failure) => {
      const f = fixture();
      if (failure === 'cloned') f.cloneAuthority();
      if (failure === 'expired') f.revoke();
      if (failure === 'owner') f.input.ownerSessionId = 'binding-a';
      if (failure === 'excluded') f.input.filterConfig.tags = ['other'];
      expect((await admitBackendPreparationTool(f.input, f.ports)).kind).toBe('blocked');
      expect(f.ports.coordinator.resolveGrant).not.toHaveBeenCalled();
      expect(f.ports.coordinator.admit).not.toHaveBeenCalled();
      expect(f.ports.toolDefinition).not.toHaveBeenCalled();
    },
  );
  it('validates pinned active native arguments before any index work', async () => {
    const f = fixture();
    const { validateArguments: _validator, ...ports } = f.ports;
    await expect(
      admitBackendPreparationTool({ ...f.input, request: { ...f.input.request, arguments: { query: 42 } } }, ports),
    ).rejects.toMatchObject({ code: 'schema_input_invalid' });
    expect(f.ports.coordinator.admit).not.toHaveBeenCalled();
  });
  it('never follows a caller projectPath into another checkout', async () => {
    const f = fixture();
    const result = await admitBackendPreparationTool(
      { ...f.input, request: { ...f.input.request, arguments: { query: 'Symbol', projectPath: '/foreign/checkout' } } },
      f.ports,
    );
    expect(result.kind).toBe('blocked');
    expect(f.ports.toolDefinition).not.toHaveBeenCalled();
    expect(f.ports.coordinator.admit).not.toHaveBeenCalled();
  });
  it('does not prepare a hidden native source tool absent from the installed active definitions', async () => {
    const f = fixture();
    f.ports.toolDefinition.mockResolvedValueOnce(undefined as never);
    expect((await admitBackendPreparationTool(f.input, f.ports)).kind).toBe('blocked');
    expect(f.ports.coordinator.admit).not.toHaveBeenCalled();
  });
  it('returns pending through empty tool_invoke inventory without executing, queuing, or replaying the source call', async () => {
    const f = fixture();
    f.ports.coordinator.admit.mockResolvedValueOnce(pending as never);
    const result = await admitBackendPreparationTool(
      {
        ...f.input,
        request: {
          name: 'tool_invoke',
          arguments: { server: 'codegraph', toolName: 'codegraph_explore', args: { query: 'Symbol' } },
        },
      },
      f.ports,
    );
    expect(result).toMatchObject({
      kind: 'blocked',
      result: {
        structuredContent: {
          result: { operationExecuted: false, operationQueued: false, preparation: { state: 'pending' } },
          server: 'codegraph',
          tool: 'codegraph_explore',
        },
      },
    });
    expect(f.ports.refresh).not.toHaveBeenCalled();
    expect(f.ports.coordinator.admit).toHaveBeenCalledOnce();
  });
  it('rechecks receipt/config/auth after native readiness and before returning a dispatch permission', async () => {
    const f = fixture();
    f.ports.coordinator.admit.mockImplementationOnce(async () => {
      f.revoke();
      return {
        state: 'ready',
        readiness: { state: 'ready', evidence: { freshness: 'current', coverage: 'complete', detail: '' } },
      };
    });
    expect((await admitBackendPreparationTool(f.input, f.ports)).kind).toBe('blocked');
    expect(f.ports.refresh).not.toHaveBeenCalled();
  });
  it('freshly probes every call and fences authority again after catalog refresh', async () => {
    const f = fixture();
    const first = await admitBackendPreparationTool(f.input, f.ports);
    expect(first.kind).toBe('ready');
    expect((await admitBackendPreparationTool(f.input, f.ports)).kind).toBe('ready');
    expect(f.ports.coordinator.admit).toHaveBeenCalledTimes(2);
    expect(f.ports.refresh).toHaveBeenCalledTimes(2);
    f.changeConfig();
    if (first.kind !== 'ready') throw new Error('expected readiness');
    expect(await first.revalidate()).toBe(false);
  });
  it('spends one total preparation deadline across metadata and nested admissions', async () => {
    vi.useFakeTimers();
    const f = fixture(50);
    f.ports.toolDefinition.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 35);
      return nativeDefinition;
    });
    await withPreparationRequestScope({}, async () => {
      await admitBackendPreparationTool(f.input, f.ports);
      expect(f.ports.coordinator.admit.mock.calls[0][2]).toMatchObject({ waitMs: 15 });
      vi.setSystemTime(Date.now() + 15);
      expect((await admitBackendPreparationTool(f.input, f.ports)).kind).toBe('blocked');
    });
    expect(f.ports.coordinator.admit).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
  it('includes initial grant/configuration reads in the same deadline', async () => {
    vi.useFakeTimers();
    const f = fixture(50);
    f.ports.coordinator.resolveGrant.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 25);
      return f.grant;
    });
    f.ports.toolDefinition.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 20);
      return nativeDefinition;
    });
    await admitBackendPreparationTool(f.input, f.ports);
    expect(f.ports.coordinator.admit.mock.calls[0][2]).toMatchObject({ waitMs: 5 });
    vi.useRealTimers();
  });
  it('bounds a stalled auth revalidation without starting checkout or native work', async () => {
    vi.useFakeTimers();
    const f = fixture(50);
    f.input.revalidateAuth.mockImplementationOnce(() => new Promise(() => undefined));
    const response = admitBackendPreparationTool(f.input, f.ports);
    await vi.advanceTimersByTimeAsync(50);
    expect(await response).toMatchObject({
      kind: 'blocked',
      result: { structuredContent: { preparation: { state: 'unknown', reason: 'inspection_timeout' } } },
    });
    expect(f.ports.coordinator.resolveGrant).not.toHaveBeenCalled();
    expect(f.ports.coordinator.admit).not.toHaveBeenCalled();
    expect(f.ports.toolDefinition).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('disconnected calls perform no native metadata or indexing', async () => {
    const f = fixture();
    expect((await admitBackendPreparationTool({ ...f.input, signal: AbortSignal.abort() }, f.ports)).kind).toBe(
      'blocked',
    );
    expect(f.ports.toolDefinition).not.toHaveBeenCalled();
    expect(f.ports.coordinator.admit).not.toHaveBeenCalled();
  });
  it('controls and admission normalize the same selector owner despite extra transport config fields', () => {
    expect(
      createPreparationOwnerIdentity('runtime', undefined, {
        tags: ['a'],
        tagFilterMode: 'simple-or',
        enablePagination: true,
      }),
    ).toBe(createPreparationOwnerIdentity('runtime', undefined, { tags: ['a'], tagFilterMode: 'simple-or' }));
  });
  it('enforces current auth tags independently of an explicit backend selector before target access', async () => {
    const f = fixture();
    expect(
      (
        await admitBackendPreparationTool(
          { ...f.input, authentication: ['client', 'token', ['tag:other'], ['other']] },
          f.ports,
        )
      ).kind,
    ).toBe('blocked');
    expect(f.ports.coordinator.resolveGrant).not.toHaveBeenCalled();
    expect(f.ports.toolDefinition).not.toHaveBeenCalled();
    expect(f.ports.coordinator.admit).not.toHaveBeenCalled();
  });
  it('normalizes auth-only filtering to the same exact owner used by preparation controls', () => {
    expect(
      createPreparationOwnerIdentity('runtime', ['client', 'token', ['tag:allowed'], ['allowed']], {
        tags: ['allowed'],
        tagFilterMode: 'none',
      }),
    ).toBe(
      createPreparationOwnerIdentity('runtime', ['client', 'token', ['tag:allowed'], ['allowed']], {
        tags: ['allowed'],
        tagFilterMode: 'simple-or',
        projectFilterMode: 'none',
      }),
    );
  });
});
