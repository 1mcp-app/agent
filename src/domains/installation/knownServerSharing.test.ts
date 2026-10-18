import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ClientInstancePool } from '@src/core/server/clientInstancePool.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createKnownServerSetupWorkflow } from './knownServerSetup.js';

vi.mock('@src/transport/transportFactory.js', () => ({
  createTransportsWithContext: vi.fn(async () => ({
    codegraph: { close: vi.fn(), start: vi.fn(), send: vi.fn() },
  })),
}));

vi.mock('@src/core/client/clientManager.js', () => ({
  ClientManager: {
    getOrCreateInstance: () => ({
      createPooledClientInstance: () => ({ connect: vi.fn(), close: vi.fn() }),
    }),
  },
}));

describe('known CodeGraph template instance sharing', () => {
  let directory: string | undefined;
  let pool: ClientInstancePool | undefined;

  afterEach(async () => {
    await pool?.shutdown();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('reuses one writer across clients for the same canonical checkout and isolates other checkouts', async () => {
    directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'known-sharing-')));
    const main = path.join(directory, `main & tools 'quoted' <source>`);
    const linked = path.join(directory, 'linked');
    const independent = path.join(directory, 'independent');
    const alias = path.join(directory, 'alias');
    await Promise.all([mkdir(main), mkdir(linked), mkdir(independent)]);
    await symlink(main, alias);
    const result = await createKnownServerSetupWorkflow({
      readConfiguration: () => ({ mcpServers: {} }),
      resolveExecutable: async () => '/trusted/bin/codegraph',
    }).run({ mode: 'preview', source: { type: 'known', exampleId: 'codegraph' } });
    expect(result.status).toBe('preview');
    const config = result.config!;
    pool = new ClientInstancePool({ maxInstances: 4, maxTotalInstances: 4 });
    const context = async (checkout: string, sessionId: string): Promise<ContextData> => ({
      project: { path: await realpath(checkout) },
      user: {},
      environment: {},
      sessionId,
    });
    const managerOptions = { shareable: false, perClient: true };
    const first = await pool.getOrCreateClientInstance(
      'codegraph',
      config,
      await context(main, 'inspect'),
      'inspect',
      managerOptions,
    );
    const second = await pool.getOrCreateClientInstance(
      'codegraph',
      config,
      await context(alias, 'run'),
      'run',
      managerOptions,
    );
    expect(second).toBe(first);
    expect(first.clientIds).toEqual(new Set(['inspect', 'run']));
    expect(first.processedConfig.cwd).toBe(main);
    const linkedInstance = await pool.getOrCreateClientInstance(
      'codegraph',
      config,
      await context(linked, 'linked'),
      'linked',
      managerOptions,
    );
    const independentInstance = await pool.getOrCreateClientInstance(
      'codegraph',
      config,
      await context(independent, 'independent'),
      'independent',
      managerOptions,
    );
    expect(linkedInstance).not.toBe(first);
    expect(independentInstance).not.toBe(first);
    expect(independentInstance).not.toBe(linkedInstance);
    expect(new Set([first.renderedHash, linkedInstance.renderedHash, independentInstance.renderedHash]).size).toBe(3);
  });
});
