import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { InstallationStore } from './installationStore.js';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('./coordinationScope.js', () => ({ coordinationScope: lookup }));

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  lookup.mockReset();
});

it.each([false, true])('resolves execution context before coordination entries (background=%s)', async (background) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'product-scope-'));
  roots.push(root);
  let resolve!: (scope: string | undefined) => void;
  lookup.mockReturnValue(new Promise<string | undefined>((done) => (resolve = done)));
  const store = new InstallationStore(root, { notice: () => {}, background });
  const admission = store.admit();
  await vi.waitFor(() => expect(lookup).toHaveBeenCalledWith(background));
  expect(await readdir(root)).toEqual([]);
  resolve(undefined);
  const ticket = await admission;
  expect(ticket).toBeDefined();
  expect(await readdir(root)).toEqual(['state.json']);
  lookup.mockResolvedValue('a'.repeat(64));
  expect(await store.admit()).toEqual(ticket);
});
