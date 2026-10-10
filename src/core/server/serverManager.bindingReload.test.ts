import { ConfigManager } from '@src/config/configManager.js';
import {
  createProjectPreparationAuthority,
  normalizeProjectPreparationAuthority,
  validateProjectPreparationAuthority,
} from '@src/core/context/projectPreparationAuthority.js';
import { authorizeTemplateContext, createTemplateContextProof } from '@src/core/context/templateContextTrust.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { TemplateServerManager } from '@src/core/server/templateServerManager.js';
import type { ContextData } from '@src/types/context.js';

import { expect, it, vi } from 'vitest';

vi.mock('@src/config/configManager.js', () => ({ ConfigManager: { getInstance: vi.fn() } }));

it('reloads a request binding with its exact B selectors while the transport retains A selectors and the original owner ID', async () => {
  const templates = new TemplateServerManager();
  const context: ContextData = {
    project: { path: '/repo/frontend' },
    user: {},
    environment: {},
    sessionId: 'session-a',
  };
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
    });
  const receipt = createProjectPreparationAuthority({
    context,
    proof,
    authorization: verify(context, proof, context.sessionId!),
    verify,
  })!;
  const normalized = normalizeProjectPreparationAuthority(receipt, context, context)!;
  const filterA = { tags: ['frontend'], tagFilterMode: 'simple-or' as const };
  const filterB = { tags: ['backend'], tagFilterMode: 'simple-or' as const };
  const bindingA = await templates.registerBindingContext('session-a', context, filterA, normalized);
  const bindingB = await templates.registerBindingContext('session-a', context, filterB, normalized);
  expect(bindingA).not.toBe(bindingB);
  const bound = templates.getBindingAuthority(bindingB)!;
  const configRead = templates.getBindingConfiguration(bindingB)!;
  configRead.tags!.push('caller-mutation');
  expect(templates.getBindingConfiguration(bindingB)?.tags).toEqual(['backend']);
  const inbound = { context: { ...context, metadata: { transport: 'streamable' } }, ...filterA };
  const outbound = new Map();
  const create = vi.spyOn(templates, 'createTemplateBasedServers');
  vi.spyOn(templates, 'retireTemplatesForRuntimeEnvironment').mockResolvedValue([
    { sessionId: bindingB, templateName: 'codegraph', lifecycle: 'ephemeral' },
  ]);
  vi.mocked(ConfigManager.getInstance).mockReturnValue({
    loadConfigWithTemplates: vi.fn(async () => ({ templateServers: {}, errors: [] })),
  } as never);
  const manager = Object.create(ServerManager.prototype) as ServerManager;
  Object.assign(manager, {
    templateServerManager: templates,
    connectionManager: { getInboundConnections: () => new Map([['session-a', inbound]]) },
    outboundConns: outbound,
    transports: {},
  });
  vi.spyOn(manager, 'notifyBackendCapabilityListsChanged').mockResolvedValue();
  try {
    await manager.reloadTemplatesForRuntimeEnvironment(['codegraph']);
    expect(create).toHaveBeenCalledWith(
      bindingB,
      context,
      expect.objectContaining(filterB),
      { mcpTemplates: {} },
      outbound,
      {},
      'ephemeral',
      bound,
    );
    expect(templates.getBindingAuthority(bindingB)).toBeDefined();
    expect(
      validateProjectPreparationAuthority(templates.getBindingAuthority(bindingB)!, {
        bindingId: bindingB,
        context,
        ownerSessionId: 'session-a',
      }),
    ).toBe(true);
    expect(templates.getBindingConfiguration(bindingB)?.tags).toEqual(['backend']);
  } finally {
    await templates.shutdown();
  }
  expect(templates.getBindingConfiguration(bindingB)).toBeUndefined();
});
