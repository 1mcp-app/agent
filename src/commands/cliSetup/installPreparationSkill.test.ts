import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installPreparationSkill } from './installPreparationSkill.js';

const faults = vi.hoisted(() => ({ beforeRename: undefined as ((target: string) => Promise<void>) | undefined }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      await faults.beforeRename?.(String(to));
      return actual.rename(from, to);
    },
  };
});

describe('managed preparation skill installation', () => {
  let root: string;
  let destination: string;
  const initial = { 'SKILL.md': 'original\n', 'references/backend.md': 'backend v1\n' };
  const updated = { 'SKILL.md': 'updated\n', 'references/backend.md': 'backend v2\n', 'references/new.md': 'new\n' };
  const install = (files = initial) => installPreparationSkill(root, '.agents/skills', files);

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), '1mcp-skill-'));
    destination = path.join(root, '.agents/skills/1mcp-preparation-setup');
  });
  afterEach(async () => {
    faults.beforeRename = undefined;
    await rm(root, { recursive: true, force: true });
  });

  it('installs, repeats without changing bytes, and upgrades owned content', async () => {
    expect(await install()).toMatchObject({ status: 'installed', changed: true });
    const manifest = await readFile(path.join(destination, '.1mcp-managed.json'), 'utf8');
    expect(await install()).toMatchObject({ status: 'unchanged', changed: false });
    expect(await readFile(path.join(destination, '.1mcp-managed.json'), 'utf8')).toBe(manifest);
    await writeFile(path.join(destination, 'user-notes.md'), 'keep');
    expect(await install(updated)).toMatchObject({ status: 'updated', changed: true });
    for (const [file, content] of Object.entries(updated)) {
      expect(await readFile(path.join(destination, file), 'utf8')).toBe(content);
    }
    expect(await readFile(path.join(destination, 'user-notes.md'), 'utf8')).toBe('keep');
  });

  it.each(['SKILL.md', 'references/backend.md', '.1mcp-managed.json'])(
    'recovers an upgrade interrupted at %s',
    async (failedFile) => {
      await install();
      let manifestWrites = 0;
      faults.beforeRename = async (target) => {
        if (target.endsWith('.1mcp-managed.json')) manifestWrites++;
        if (target !== path.join(destination, failedFile)) return;
        if (failedFile === '.1mcp-managed.json' && manifestWrites === 1) return;
        throw new Error('simulated interrupted write');
      };
      await expect(install(updated)).rejects.toThrow('simulated interrupted write');
      faults.beforeRename = undefined;
      expect(await install(updated)).toMatchObject({ status: 'updated' });
      expect(await install(updated)).toMatchObject({ status: 'unchanged' });
    },
  );

  it('preserves user edits after an interrupted upgrade', async () => {
    await install();
    faults.beforeRename = async (target) => {
      if (target.endsWith('references/backend.md')) throw new Error('interrupted');
    };
    await expect(install(updated)).rejects.toThrow('interrupted');
    faults.beforeRename = undefined;
    await writeFile(path.join(destination, 'SKILL.md'), 'new user edit');
    expect(await install(updated)).toMatchObject({ status: 'conflict' });
    expect(await readFile(path.join(destination, 'SKILL.md'), 'utf8')).toBe('new user edit');
  });

  it('publishes a first installation only after every file is ready', async () => {
    faults.beforeRename = async (target) => {
      if (target.endsWith('references/backend.md')) throw new Error('interrupted');
    };
    await expect(install()).rejects.toThrow('interrupted');
    await expect(readFile(path.join(destination, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    faults.beforeRename = undefined;
    expect(await install()).toMatchObject({ status: 'installed' });
  });

  it('excludes a concurrent version upgrade until the active installer publishes its manifest', async () => {
    await install();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    faults.beforeRename = async (target) => {
      if (target === path.join(destination, 'SKILL.md')) {
        entered();
        await gate;
      }
    };
    const first = install(updated);
    await started;
    try {
      expect(await install()).toMatchObject({
        status: 'conflict',
        reason: expect.stringContaining('Installation lock'),
      });
    } finally {
      release();
    }
    expect(await first).toMatchObject({ status: 'updated' });
    faults.beforeRename = undefined;
    expect(await install(updated)).toMatchObject({ status: 'unchanged' });
    expect(await install()).toMatchObject({ status: 'updated' });
    expect(await install()).toMatchObject({ status: 'unchanged' });
  });

  it.skipIf(process.platform === 'win32')('creates private skill files and directories', async () => {
    await install();
    expect((await stat(destination)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(destination, 'references'))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(destination, 'SKILL.md'))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(destination, '.1mcp-managed.json'))).mode & 0o777).toBe(0o600);
  });

  it('removes obsolete unchanged managed files while preserving unrelated files', async () => {
    await install();
    await writeFile(path.join(destination, 'custom.md'), 'keep');
    await installPreparationSkill(root, '.agents/skills', { 'SKILL.md': 'v2' });
    await expect(readFile(path.join(destination, 'references/backend.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(destination, 'custom.md'), 'utf8')).toBe('keep');
  });

  it.each(['SKILL.md', 'references/backend.md'])('preserves edits to %s without partially upgrading', async (file) => {
    await install();
    await writeFile(path.join(destination, file), 'user edit');
    const manifest = await readFile(path.join(destination, '.1mcp-managed.json'), 'utf8');
    expect(await install(updated)).toMatchObject({ status: 'conflict', changed: false });
    expect(await readFile(path.join(destination, file), 'utf8')).toBe('user edit');
    expect(await readFile(path.join(destination, '.1mcp-managed.json'), 'utf8')).toBe(manifest);
    await expect(readFile(path.join(destination, 'references/new.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves an unknown same-name installation', async () => {
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, 'SKILL.md'), 'user skill');
    expect(await install()).toMatchObject({ status: 'conflict', changed: false });
    expect(await readFile(path.join(destination, 'SKILL.md'), 'utf8')).toBe('user skill');
  });

  it.each([
    'not json',
    JSON.stringify({ schemaVersion: 1, skill: '1mcp-preparation-setup', files: { '../outside': 'a'.repeat(64) } }),
  ])('preserves files with invalid manifest %s', async (manifest) => {
    await install();
    await writeFile(path.join(destination, '.1mcp-managed.json'), manifest);
    expect(await install(updated)).toMatchObject({ status: 'conflict', changed: false });
    expect(await readFile(path.join(destination, 'SKILL.md'), 'utf8')).toBe(initial['SKILL.md']);
  });

  it('preserves an unmanaged collision with a new file', async () => {
    await install();
    await writeFile(path.join(destination, 'references/new.md'), 'custom');
    expect(await install(updated)).toMatchObject({ status: 'conflict', changed: false });
    expect(await readFile(path.join(destination, 'SKILL.md'), 'utf8')).toBe(initial['SKILL.md']);
  });

  it('preserves user deletions', async () => {
    await install();
    await rm(path.join(destination, 'references/backend.md'));
    expect(await install(updated)).toMatchObject({ status: 'conflict', changed: false });
  });

  it.each(['.agents', '.agents/skills', '.agents/skills/1mcp-preparation-setup'])(
    'preserves symlinked destination %s',
    async (relative) => {
      const outside = path.join(root, 'outside');
      await mkdir(outside);
      const link = path.join(root, relative);
      await mkdir(path.dirname(link), { recursive: true });
      await symlink(outside, link, 'dir');
      expect(await install()).toMatchObject({ status: 'conflict', changed: false });
      await expect(readFile(path.join(outside, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.each(['SKILL.md', 'references', '.1mcp-managed.json'])('preserves symlinked managed path %s', async (relative) => {
    await install();
    const file = path.join(destination, relative);
    await rm(file, { recursive: true });
    const outside = path.join(root, 'outside');
    await writeFile(outside, 'keep');
    await symlink(outside, file);
    expect(await install(updated)).toMatchObject({ status: 'conflict', changed: false });
    expect(await readFile(outside, 'utf8')).toBe('keep');
  });

  it('installs through a selected scope-root alias', async () => {
    const real = path.join(root, 'real');
    const alias = path.join(root, 'alias');
    await mkdir(real);
    await symlink(real, alias, 'junction');
    expect(await installPreparationSkill(alias, '.agents/skills', initial)).toMatchObject({ status: 'installed' });
    expect(await installPreparationSkill(real, '.agents/skills', initial)).toMatchObject({ status: 'unchanged' });
    expect(await readFile(path.join(real, '.agents/skills/1mcp-preparation-setup/SKILL.md'), 'utf8')).toBe(
      initial['SKILL.md'],
    );
  });

  it('still rejects redirects beneath a selected scope-root alias', async () => {
    const real = path.join(root, 'real');
    const alias = path.join(root, 'alias');
    const other = path.join(root, 'other');
    await mkdir(real);
    await mkdir(other);
    await symlink(real, alias, 'junction');
    await symlink(other, path.join(real, '.agents'), 'junction');
    expect(await installPreparationSkill(alias, '.agents/skills', initial)).toMatchObject({ status: 'conflict' });
    await expect(readFile(path.join(other, 'skills/1mcp-preparation-setup/SKILL.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('detects a dangling destination symlink', async () => {
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(path.join(root, 'missing'), destination, 'dir');
    expect(await install()).toMatchObject({ status: 'conflict', changed: false });
  });

  it('preserves a regular file occupying the skill directory', async () => {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, 'keep');
    expect(await install()).toMatchObject({ status: 'conflict', changed: false });
    expect(await readFile(destination, 'utf8')).toBe('keep');
  });
});
