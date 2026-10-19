import { chmod, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createHookProjectOwner,
  readProjectOwner,
  readProjectOwnerTargets,
  recordProjectOwnerTarget,
} from './projectOwnerStore.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('project owner credentials', () => {
  it('reuses the session credential across invocations and isolates workers and clients', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'project-owner-'));
    directories.push(storage);
    const session = { client: 'codex' as const, sessionId: 'session-a' };
    const parent = await createHookProjectOwner(storage, session);
    expect(await createHookProjectOwner(storage, session)).toBe(parent);
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => createHookProjectOwner(storage, { ...session, sessionId: 'concurrent' })),
    );
    expect(new Set(await Promise.all(concurrent.map(readProjectOwner))).size).toBe(1);
    const worker = await createHookProjectOwner(storage, { ...session, agentId: 'worker-a' });
    const sibling = await createHookProjectOwner(storage, { ...session, agentId: 'worker-b' });
    const otherClient = await createHookProjectOwner(storage, { ...session, client: 'claude' });
    const tokens = await Promise.all([parent, worker, sibling, otherClient].map(readProjectOwner));
    expect(new Set(tokens).size).toBe(4);
    expect(tokens[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(await readProjectOwner(parent)).toBe(tokens[0]);
    expect(await readFile(parent, 'utf8')).not.toContain('session-a');
  });

  it('refuses symlink and exposed credential files without changing their permissions', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'project-owner-'));
    directories.push(storage);
    const owner = await createHookProjectOwner(storage, { client: 'codex', sessionId: 'session-a' });
    const link = path.join(storage, 'link.json');
    await symlink(owner, link);
    await expect(readProjectOwner(link)).rejects.toThrow();
    if (process.platform !== 'win32') {
      await chmod(owner, 0o644);
      await expect(readProjectOwner(owner)).rejects.toThrow(/private/);
    }
  });

  it('retains separate selected checkout targets without widening session-end release', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'project-owner-'));
    directories.push(storage);
    const owner = await createHookProjectOwner(storage, { client: 'codex', sessionId: 'session-a' });
    const target = { project: ['/work/a'], 'config-dir': '/runtime/a', runtimeScopeId: 'scope-a' };
    await Promise.all([
      recordProjectOwnerTarget(owner, target),
      recordProjectOwnerTarget(owner, target),
      recordProjectOwnerTarget(owner, { ...target, project: ['/work/b'] }),
    ]);
    const targets = await readProjectOwnerTargets(owner);
    expect(targets).toHaveLength(2);
    expect(targets.map((entry) => entry.project[0]).sort()).toEqual(['/work/a', '/work/b']);
  });
});
