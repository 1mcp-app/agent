import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import type { Argv } from 'yargs';

import { productCommandFamily } from './productCommandFamily.js';

const expected = {
  admin: ['bootstrap', 'login', 'status', 'logout'],
  app: ['consolidate', 'restore', 'list', 'discover', 'status', 'backups'],
  auth: ['login', 'status', 'logout', 'export-oauth-credentials', 'export-upstream-credentials'],
  bootstrap: [],
  cliSetup: [],
  inspect: [],
  instructions: [],
  mcp: [
    'add',
    'setup',
    'install',
    'remove',
    'uninstall',
    'update',
    'enable',
    'disable',
    'restart',
    'list',
    'status',
    'tokens',
    'search',
    'tools',
    'tools list',
    'tools enable',
    'tools disable',
  ],
  preset: ['edit', 'create', 'show', 'list', 'url', 'delete', 'test'],
  project: [
    'release',
    'drain',
    'status',
    'resume',
    'recover',
    'prepare',
    'prepare $0',
    'prepare start',
    'prepare inspect',
    'prepare status',
    'prepare wait',
    'prepare cancel',
    'prepare retry',
  ],
  proxy: [],
  registry: ['search', 'status', 'show', 'versions'],
  run: [],
  serve: [],
  target: ['add', 'use', 'export', 'import', 'doctor', 'current', 'list', 'inspect', 'delete', 'rename', 'verify'],
  telemetry: [],
  wait: [],
};

/** Execute real builders; retain registrations without running any handler or configuration middleware. */
function registrations() {
  const paths: string[] = [];
  function parser(prefix: string[] = []): Argv {
    const chain = new Proxy(
      {},
      {
        get(_target, key) {
          if (key === 'command')
            return (...args: unknown[]) => {
              const spec = args[0];
              const object =
                typeof spec === 'object' && spec !== null
                  ? (spec as { command: string; builder?: unknown })
                  : undefined;
              const command = object?.command ?? String(spec);
              const next = [...prefix, command.split(' ')[0]];
              paths.push(next.join(' '));
              const builder = object?.builder ?? args[2];
              if (typeof builder === 'function') builder(parser(next));
              return chain;
            };
          return () => chain;
        },
      },
    );
    return chain as Argv;
  }
  return { paths, parser };
}

describe('registered command coverage catalog', () => {
  it('covers every current root and nested registration with explicit finite groupings', async () => {
    const setupNames: string[] = [];
    for (const [directory, leaves] of Object.entries(expected)) {
      const module = await import(`../${directory}/index.ts`);
      const setup = Object.values(module).find(
        (value) => typeof value === 'function' && value.name.startsWith('setup'),
      ) as (parser: Argv) => Argv;
      setupNames.push(setup.name);
      const catalog = registrations();
      setup(catalog.parser());
      const root = directory === 'cliSetup' ? 'cli-setup' : directory;
      expect(catalog.paths.sort(), root).toEqual([root, ...leaves.map((leaf) => `${root} ${leaf}`)].sort());
      if (!['serve', 'proxy', 'telemetry'].includes(root)) expect(productCommandFamily(root), root).toBeDefined();
    }
    const cli = readFileSync(new URL('../../cli.ts', import.meta.url), 'utf8');
    const registered = [...cli.matchAll(/yargsInstance = (setup\w+)\(yargsInstance\);/g)].map((match) => match[1]);
    expect(registered.sort()).toEqual(setupNames.sort());
  });
  it('groups absent receiver roots semantically and excludes controls and unknown raw text', () => {
    expect(['admin', 'app', 'bootstrap', 'cli-setup', 'registry', 'target'].map(productCommandFamily)).toEqual([
      'auth',
      'config',
      'project',
      'config',
      'mcp',
      'config',
    ]);
    for (const text of ['telemetry', 'help', 'version', 'prepare', 'secret-backend', 'https://private'])
      expect(productCommandFamily(text)).toBeUndefined();
  });
});
