import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import {
  bindProjectPreparationAuthority,
  createProjectPreparationAuthority,
  normalizeProjectPreparationAuthority,
} from '@src/core/context/projectPreparationAuthority.js';
import { authorizeTemplateContext, createTemplateContextProof } from '@src/core/context/templateContextTrust.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import type { ContextData } from '@src/types/context.js';

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { createToolInvocationsHandler } from './toolRoutes.js';

const configs = vi.hoisted(() => ({ current: {} as Record<string, MCPServerParams> }));
vi.mock('@src/config/configManager.js', () => ({
  ConfigManager: {
    getInstance: () => ({
      loadDeclaredServerConfigs: () => ({ staticServers: configs.current, templateServers: {}, errors: [] }),
    }),
  },
}));
vi.mock('@src/config/mcpConfigManager.js', () => ({
  McpConfigManager: { getInstance: () => ({ getTransportConfig: () => configs.current }) },
}));
vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: () => ({
      get: (key: string) => (key === 'features' ? { scopeValidation: false } : undefined),
      isAuthEnabled: () => false,
    }),
  },
}));
vi.mock('@src/logger/logger.js', () => ({
  default: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  debugIf: vi.fn(),
  infoIf: vi.fn(),
  warnIf: vi.fn(),
}));
vi.mock('./inspectRequestContext.js', () => ({ ensureRequestContextInitialized: async () => 'binding' }));

function fixture(lazy: boolean, hidden: boolean) {
  const context: ContextData = { sessionId: 'owner', project: { path: '/selected' }, user: {}, environment: {} };
  const capability = {
    version: 1 as const,
    runtimeScopeId: 'runtime',
    secret: Buffer.alloc(32, 7).toString('base64url'),
  };
  const proof = createTemplateContextProof(context, capability);
  const verify = (signedContext: ContextData, signedProof: typeof proof, owner: string) =>
    authorizeTemplateContext({
      context: signedContext,
      proof: signedProof,
      transportSessionId: owner,
      mode: 'verified',
      capability,
    });
  const receipt = createProjectPreparationAuthority({
    context,
    proof,
    authorization: verify(context, proof, 'owner'),
    verify,
  });
  const authority = bindProjectPreparationAuthority(
    normalizeProjectPreparationAuthority(receipt, context, context),
    'binding',
    context,
  );
  configs.current = {
    backend: {
      command: 'node',
      tags: ['private'],
      disabledTools: ['lookup'],
      preparation: { adapter: 'configured-command', affectedTools: 'all', allowedActions: ['initialize'] },
    },
  };
  const callMetaTool = vi.fn();
  const manager = {
    getBindingContext: () => context,
    getBindingContexts: () => new Map([['binding', context]]),
    getBindingAuthority: () => authority,
    getBindingPolicies: () => [],
    getRenderedHashForSession: () => undefined,
    getAllRenderedHashesForSession: () => [],
  };
  const connection = Object.assign(createMockOutboundConnection({ name: 'backend' }), {
    transport: { tags: ['private'] },
  });
  const serverManager = {
    getTemplateServerManager: () => manager,
    getLazyLoadingOrchestrator: () => (lazy ? { callMetaTool } : undefined),
    getClients: () => new Map([['backend', connection]]),
  };
  const res = {
    locals: { tagFilterMode: hidden ? 'simple-or' : 'none', validatedTags: hidden ? ['public'] : [] },
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return { serverManager, callMetaTool, res };
}

describe('project-bound preparation invocation visibility', () => {
  it.each([false, true])('preserves hidden-server 404 before preparation (lazy=%s)', async (lazy) => {
    const f = fixture(lazy, true);
    await createToolInvocationsHandler(f.serverManager as never)(
      { body: { tool: 'backend/lookup' }, headers: { 'mcp-session-id': 'owner' } } as unknown as Request,
      f.res as unknown as Response,
      () => undefined,
    );
    expect(f.res.statusCode).toBe(404);
    expect(f.res.body).toEqual({ error: 'Server not found: backend' });
    expect(f.callMetaTool).not.toHaveBeenCalled();
  });
  it.each([false, true])('preserves visible disabled-tool 404 before preparation (lazy=%s)', async (lazy) => {
    const f = fixture(lazy, false);
    await createToolInvocationsHandler(f.serverManager as never)(
      { body: { tool: 'backend/lookup' }, headers: { 'mcp-session-id': 'owner' } } as unknown as Request,
      f.res as unknown as Response,
      () => undefined,
    );
    expect(f.res.statusCode).toBe(404);
    expect(f.res.body).toEqual({
      error: "Tool is disabled: backend:lookup. Use '1mcp mcp tools enable backend lookup' to re-enable it.",
    });
    expect(f.callMetaTool).not.toHaveBeenCalled();
  });
});
