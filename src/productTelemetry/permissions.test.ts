import { mkdir, mkdtemp, open, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { secureNewInstallationEntry, verifyInstallationPrivacy } from './permissions.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('installation privacy boundary', () => {
  it('verifies an owned private tree and rejects redirected paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'product-permissions-'));
    roots.push(root);
    await mkdir(path.join(root, 'private'), { mode: 0o700 });
    await verifyInstallationPrivacy(path.join(root, 'private'), { created: true });
    const file = path.join(root, 'private/state');
    const handle = await open(file, 'wx', 0o600);
    try {
      await secureNewInstallationEntry(file, false);
      await handle.writeFile('{}');
    } finally {
      await handle.close();
    }
    await verifyInstallationPrivacy(path.join(root, 'private'));
    if (process.platform !== 'win32') {
      await symlink(path.join(root, 'private'), path.join(root, 'redirect'));
      await expect(verifyInstallationPrivacy(path.join(root, 'redirect'))).rejects.toThrow();
    }
  });
  it.skipIf(process.platform === 'win32')('refuses existing broad POSIX access without changing it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'product-permissions-'));
    roots.push(root);
    await mkdir(path.join(root, 'broad'), { mode: 0o755 });
    await expect(verifyInstallationPrivacy(path.join(root, 'broad'))).rejects.toThrow('owner-only');
  });
});
