import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ConfigManager } from '@src/config/configManager.js';
import {
  registerCapabilityPaginationNotifications,
  walkCapabilityPages,
} from '@src/core/capabilities/capabilityPagination.js';
import { publishConfiguredToolSnapshot } from '@src/core/capabilities/configuredToolSnapshot.js';
import {
  bindProjectPreparationAuthority,
  createProjectPreparationAuthority,
  normalizeProjectPreparationAuthority,
} from '@src/core/context/projectPreparationAuthority.js';
import { authorizeTemplateContext, createTemplateContextProof } from '@src/core/context/templateContextTrust.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import type { OutboundConnection } from '@src/core/types/index.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { refreshPreparedBackendCapabilities } from './backendPreparationCoordinator.js';

const definition = { command: 'fixture', template: {}, tags: ['allowed'] };
vi.mock('@src/config/configuredServerTargets.js', () => ({
  getConfiguredServerTargets: () => ({ codegraph: definition }),
}));
vi.mock('@src/config/configManager.js', () => ({ ConfigManager: { getInstance: vi.fn() } }));
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const checkoutRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'prepared-provider-')));
  directories.push(checkoutRoot);
  const context: ContextData = { project: { path: checkoutRoot }, user: {}, environment: {}, sessionId: 'session-a' };
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
    authorization: verify(context, proof, 'session-a'),
    verify,
  })!;
  const authority = bindProjectPreparationAuthority(
    normalizeProjectPreparationAuthority(receipt, context, context),
    'binding-a',
    context,
  )!;
  vi.mocked(ConfigManager.getInstance).mockReturnValue({
    loadDeclaredServerConfigs: () => ({ staticServers: {}, templateServers: { codegraph: definition }, errors: [] }),
  } as never);
  const connection = {
    name: 'codegraph',
    adapter: { nextEvent: () => new Promise(() => undefined) },
  } as unknown as OutboundConnection;
  const connections = new Map([['codegraph:binding-a', connection]]);
  const forward = vi.fn(async () => undefined);
  const refresh = vi.fn(async () => undefined);
  registerCapabilityPaginationNotifications(connections, connection, {}, forward);
  const manager = {
    getBindingContexts: () => new Map([['binding-a', context]]),
    getBindingContext: () => {
      throw new Error('background refresh must not renew binding lifetime');
    },
    getBindingPolicies: () => [],
    getBindingConfiguration: () => ({ tags: ['allowed'], tagFilterMode: 'simple-or' }),
    getBindingAuthority: () => authority,
    getRenderedHashForSession: () => undefined,
  };
  const server = {
    getClients: () => connections,
    getTemplateServerManager: () => manager,
    getLazyLoadingOrchestrator: () => ({ refreshCapabilities: refresh }),
  } as unknown as ServerManager;
  const target = {
    checkoutRoot,
    backendName: 'codegraph',
    backendIdentity: createHash('sha256').update(JSON.stringify(definition)).digest('hex'),
    configurationKey: 'configuration',
  };
  const options = {
    connections,
    providers: [
      {
        id: 'codegraph',
        name: 'codegraph',
        list: async (cursor?: string) => ({ items: [cursor ?? 'first'], nextCursor: cursor ? undefined : 'next' }),
      },
    ],
    kind: 'tools' as const,
    filterSelection: {},
    enablePagination: true,
  };
  return { connection, server, target, options, forward, refresh };
}

describe('ready catalog refresh', () => {
  it('refreshes a missing source inventory but preserves an already-declared modern header generation', async () => {
    const f = await fixture();
    publishConfiguredToolSnapshot(f.connection, []);
    const old = await walkCapabilityPages(f.options);
    await refreshPreparedBackendCapabilities(f.server, f.target, { missingTool: 'codegraph_explore' });
    await expect(walkCapabilityPages({ ...f.options, cursor: old.nextCursor })).rejects.toMatchObject({
      data: { reason: 'stale_generation' },
    });
    expect(f.forward).toHaveBeenCalledOnce();
    expect(f.refresh).toHaveBeenCalledOnce();
    publishConfiguredToolSnapshot(f.connection, [{ name: 'codegraph_explore', inputSchema: { type: 'object' } }]);
    const current = await walkCapabilityPages(f.options);
    // A source change between the modern outer probe and common probe requires sync,
    // but the pinned native source declaration remains the same after that sync.
    await refreshPreparedBackendCapabilities(f.server, f.target, { onlyEmptyInventory: true });
    await refreshPreparedBackendCapabilities(f.server, f.target, { missingTool: 'codegraph_explore' });
    await expect(walkCapabilityPages({ ...f.options, cursor: current.nextCursor })).resolves.toMatchObject({
      items: ['next'],
    });
    expect(f.forward).toHaveBeenCalledOnce();
    expect(f.refresh).toHaveBeenCalledOnce();
  });
  it('does not refresh a target from a superseded runtime backend configuration', async () => {
    const f = await fixture();
    publishConfiguredToolSnapshot(f.connection, []);
    await refreshPreparedBackendCapabilities(f.server, { ...f.target, backendIdentity: 'old-definition' });
    expect(f.forward).not.toHaveBeenCalled();
    expect(f.refresh).not.toHaveBeenCalled();
  });
});
