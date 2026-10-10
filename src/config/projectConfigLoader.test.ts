import * as fsPromises from 'fs/promises';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadProjectConfig, resolveProjectContext } from './projectConfigLoader.js';

vi.mock('fs/promises', { spy: true });

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.com',
    '-C',
    cwd,
    ...args,
  ]);
}

describe('resolveProjectContext', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.resetAllMocks();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function makeTempProject(): Promise<string> {
    const dir = await realpath(await mkdtemp(join(os.tmpdir(), 'project-config-loader-')));
    tempDirs.push(dir);
    return dir;
  }

  async function makeGitProject(
    separateGitDir = false,
    nameSuffix = '',
  ): Promise<{ base: string; main: string; linked: string }> {
    const base = await makeTempProject();
    const main = join(base, `main checkout${nameSuffix}`);
    const linked = join(base, `linked checkout${nameSuffix}`);
    await mkdir(main);
    const initArgs = separateGitDir ? ['--separate-git-dir', join(base, 'metadata')] : [];
    await git(main, 'init', '-q', ...initArgs);
    if (separateGitDir) {
      await git(main, 'config', 'core.worktree', main);
    }
    await git(main, 'commit', '--allow-empty', '-qm', 'fixture');
    await git(main, 'worktree', 'add', '--detach', '-q', linked);
    return { base, main, linked };
  }

  it('inherits main checkout defaults while retaining a real linked checkout target', async () => {
    const { main, linked } = await makeGitProject();
    await writeFile(join(main, '.1mcprc'), JSON.stringify({ preset: 'main', tags: ['backend'] }));
    const nested = join(linked, 'src');
    await mkdir(nested);

    const result = await resolveProjectContext(nested);

    expect(result).toMatchObject({
      cwd: nested,
      projectRoot: linked,
      repositoryRoot: linked,
      projectConfigPath: join(main, '.1mcprc'),
      projectConfigDir: main,
      projectConfigSource: 'inherited',
      projectConfig: { preset: 'main', tags: ['backend'] },
    });
    expect(result.projectName).toBe('linked checkout');
  });

  it('replaces inherited configuration as a whole with a one-field local config', async () => {
    const { main, linked } = await makeGitProject();
    await writeFile(
      join(main, '.1mcprc'),
      JSON.stringify({ preset: 'main', tags: ['backend'], filter: 'main-filter' }),
    );
    await writeFile(join(linked, '.1mcprc'), JSON.stringify({ preset: 'local' }));

    const result = await resolveProjectContext(linked);

    expect(result.projectRoot).toBe(linked);
    expect(result.projectConfig).toEqual({ preset: 'local' });
    expect(result.projectConfigSource).toBe('local');
    expect(result.projectConfigPath).toBe(join(linked, '.1mcprc'));
  });

  it('does not fall back to inherited defaults when a local config is invalid', async () => {
    const { main, linked } = await makeGitProject();
    await writeFile(join(main, '.1mcprc'), JSON.stringify({ preset: 'main' }));
    await writeFile(join(linked, '.1mcprc'), '{ invalid');

    const result = await resolveProjectContext(linked);

    expect(result.projectConfig).toBeNull();
    expect(result.projectConfigSource).toBe('local');
    expect(result.projectRoot).toBe(linked);
  });

  it('stops automatic discovery at a real repository boundary', async () => {
    const { base, main, linked } = await makeGitProject();
    await writeFile(join(base, '.1mcprc'), JSON.stringify({ preset: 'outer' }));
    for (const checkout of [main, linked]) {
      const nested = join(checkout, 'src');
      await mkdir(nested);
      const result = await resolveProjectContext(nested);
      expect(result.projectRoot).toBe(checkout);
      expect(result.projectConfig).toBeNull();
      expect(result.projectConfigPath).toBeUndefined();
    }
  });

  it('keeps nested local config precedence within a repository and separates its source directory', async () => {
    const { main, linked } = await makeGitProject();
    const nestedRoot = join(linked, 'packages', 'app');
    const nested = join(nestedRoot, 'src');
    await mkdir(nested, { recursive: true });
    await writeFile(join(main, '.1mcprc'), JSON.stringify({ tags: ['main'] }));
    await writeFile(join(linked, '.1mcprc'), JSON.stringify({ preset: 'root' }));
    await writeFile(join(nestedRoot, '.1mcprc'), JSON.stringify({ preset: 'nested' }));

    const result = await resolveProjectContext(nested);

    expect(result.projectRoot).toBe(linked);
    expect(result.projectConfigDir).toBe(nestedRoot);
    expect(result.projectConfig).toEqual({ preset: 'nested' });
    expect(result.projectConfigSource).toBe('local');
  });

  it('finds main checkout config when the common Git directory is outside the source checkout', async () => {
    const { base, main, linked } = await makeGitProject(true);
    await writeFile(join(base, '.1mcprc'), JSON.stringify({ preset: 'metadata-parent' }));
    await writeFile(join(main, '.1mcprc'), JSON.stringify({ preset: 'main' }));

    const result = await resolveProjectContext(linked);

    expect(result.projectRoot).toBe(linked);
    expect(result.projectConfigPath).toBe(join(main, '.1mcprc'));
    expect(result.projectConfig).toEqual({ preset: 'main' });
  });

  it('uses main worktree configuration when separate Git metadata enables worktreeConfig', async () => {
    const { main, linked } = await makeGitProject(true);
    await git(main, 'config', 'extensions.worktreeConfig', 'true');
    await git(main, 'config', '--unset', 'core.worktree');
    await git(main, 'config', '--worktree', 'core.worktree', main);
    await writeFile(join(main, '.1mcprc'), JSON.stringify({ preset: 'main-worktree-config' }));

    const result = await resolveProjectContext(linked);

    expect(result.projectRoot).toBe(linked);
    expect(result.projectConfigPath).toBe(join(main, '.1mcprc'));
    expect(result.projectConfig).toEqual({ preset: 'main-worktree-config' });
    expect(result.projectConfigSource).toBe('inherited');
  });

  it('canonicalizes registry paths before comparing Windows-style realpath separators', async () => {
    const { main, linked } = await makeGitProject();
    await writeFile(join(main, '.1mcprc'), JSON.stringify({ preset: 'main' }));
    const { realpath: originalRealpath } = await vi.importActual<typeof fsPromises>('fs/promises');
    vi.mocked(fsPromises.realpath).mockImplementation(async (path) => {
      const canonical = await originalRealpath(path);
      return canonical === linked ? canonical.replaceAll('/', '\\') : canonical;
    });

    const result = await resolveProjectContext(linked);

    expect(result.projectRoot).toBe(linked);
    expect(result.projectConfigPath).toBe(join(main, '.1mcprc'));
    expect(result.projectConfig).toEqual({ preset: 'main' });
  });

  it('does not guess the source checkout for separate Git metadata without core.worktree', async () => {
    const { base, main, linked } = await makeGitProject(true);
    await git(main, 'config', '--unset', 'core.worktree');
    await writeFile(join(base, '.1mcprc'), JSON.stringify({ preset: 'metadata-parent' }));
    await writeFile(join(base, 'metadata', '.1mcprc'), JSON.stringify({ preset: 'metadata' }));
    await writeFile(join(main, '.1mcprc'), JSON.stringify({ preset: 'main' }));

    const result = await resolveProjectContext(linked);

    expect(result.projectRoot).toBe(linked);
    expect(result.projectConfig).toBeNull();
  });

  it.skipIf(process.platform === 'win32')(
    'preserves newlines and trailing spaces in registered checkout paths',
    async () => {
      const { main, linked } = await makeGitProject(false, '\n trailing ');
      await writeFile(join(main, '.1mcprc'), JSON.stringify({ preset: 'main' }));

      const result = await resolveProjectContext(linked);

      expect(result.projectRoot).toBe(linked);
      expect(result.projectConfigPath).toBe(join(main, '.1mcprc'));
      expect(result.projectConfig).toEqual({ preset: 'main' });
    },
  );

  it('supports relative gitdir files in a real linked checkout', async () => {
    const { main, linked } = await makeGitProject();
    const metadata = (await readFile(join(linked, '.git'), 'utf8')).slice('gitdir: '.length).trim();
    await writeFile(join(linked, '.git'), `gitdir: ${relative(linked, metadata)}\n`);
    await writeFile(join(main, '.1mcprc'), JSON.stringify({ preset: 'main' }));

    const result = await resolveProjectContext(linked);

    expect(result.projectRoot).toBe(linked);
    expect(result.projectConfig).toEqual({ preset: 'main' });
    expect(result.projectConfigSource).toBe('inherited');
  });

  it('rejects a copied gitdir file that is not registered for the selected checkout', async () => {
    const { base, main, linked } = await makeGitProject();
    const impostor = join(base, 'impostor');
    await mkdir(impostor);
    await writeFile(join(impostor, '.git'), await readFile(join(linked, '.git')));
    await writeFile(join(main, '.1mcprc'), JSON.stringify({ preset: 'main' }));

    const result = await resolveProjectContext(impostor);

    expect(result.projectRoot).toBe(impostor);
    expect(result.projectConfig).toBeNull();
    expect(result.projectConfigSource).toBeUndefined();
  });

  it('retains inherited provenance when the main configuration is invalid', async () => {
    const { main, linked } = await makeGitProject();
    await writeFile(join(main, '.1mcprc'), JSON.stringify({ tags: 123 }));

    const result = await resolveProjectContext(linked);

    expect(result.projectRoot).toBe(linked);
    expect(result.projectConfig).toBeNull();
    expect(result.projectConfigPath).toBe(join(main, '.1mcprc'));
    expect(result.projectConfigSource).toBe('inherited');
  });

  it('keeps the linked target when the main checkout is unavailable', async () => {
    const { base, main, linked } = await makeGitProject();
    await writeFile(join(main, '.1mcprc'), JSON.stringify({ preset: 'main' }));
    await rename(main, join(base, 'unavailable-main'));

    const result = await resolveProjectContext(linked);

    expect(result.projectRoot).toBe(linked);
    expect(result.projectConfig).toBeNull();
    expect(result.source).toBe('repo-root');
  });

  it('does not cross a nested repository boundary to borrow an outer repository config', async () => {
    const { main } = await makeGitProject();
    const nestedRepo = join(main, 'nested-repo');
    await mkdir(nestedRepo);
    await git(nestedRepo, 'init', '-q');
    await writeFile(join(main, '.1mcprc'), JSON.stringify({ preset: 'outer-repo' }));

    const result = await resolveProjectContext(nestedRepo);

    expect(result.projectRoot).toBe(nestedRepo);
    expect(result.projectConfig).toBeNull();
  });

  it('uses the nearest ancestor with .1mcprc as the project root', async () => {
    const rootDir = await makeTempProject();
    const nestedDir = join(rootDir, 'packages', 'app', 'src');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(rootDir, '.1mcprc'), JSON.stringify({ preset: 'root-preset' }), 'utf8');

    const result = await resolveProjectContext(nestedDir);

    expect(result.projectRoot).toBe(rootDir);
    expect(result.cwd).toBe(nestedDir);
    expect(result.projectConfig).toMatchObject({ preset: 'root-preset' });
    expect(result.source).toBe('project-config');
  });

  it('prefers the nearest .1mcprc when nested configs exist', async () => {
    const rootDir = await makeTempProject();
    const nestedRoot = join(rootDir, 'packages', 'app');
    const nestedDir = join(nestedRoot, 'src');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(rootDir, '.1mcprc'), JSON.stringify({ preset: 'root-preset' }), 'utf8');
    await writeFile(join(nestedRoot, '.1mcprc'), JSON.stringify({ preset: 'nested-preset' }), 'utf8');

    const result = await resolveProjectContext(nestedDir);

    expect(result.projectRoot).toBe(nestedRoot);
    expect(result.projectConfig).toMatchObject({ preset: 'nested-preset' });
    expect(result.source).toBe('project-config');
  });

  it('falls back to repository root when no .1mcprc exists', async () => {
    const rootDir = await makeTempProject();
    const nestedDir = join(rootDir, 'packages', 'app');
    await mkdir(join(rootDir, '.git'), { recursive: true });
    await mkdir(nestedDir, { recursive: true });

    const result = await resolveProjectContext(nestedDir);

    expect(result.projectRoot).toBe(rootDir);
    expect(result.projectConfig).toBeNull();
    expect(result.source).toBe('repo-root');
  });

  it('falls back to cwd when neither .1mcprc nor repository root exists', async () => {
    const rootDir = await makeTempProject();
    const nestedDir = join(rootDir, 'packages', 'app');
    await mkdir(nestedDir, { recursive: true });

    const result = await resolveProjectContext(nestedDir);

    expect(result.projectRoot).toBe(nestedDir);
    expect(result.projectConfig).toBeNull();
    expect(result.source).toBe('cwd');
  });
});

describe('loadProjectConfig', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('loads the nearest ancestor .1mcprc for nested working directories', async () => {
    const rootDir = await mkdtemp(join(os.tmpdir(), 'project-config-loader-'));
    tempDirs.push(rootDir);
    const nestedDir = join(rootDir, 'packages', 'app');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(rootDir, '.1mcprc'), JSON.stringify({ tags: ['backend'] }), 'utf8');

    await expect(loadProjectConfig(nestedDir)).resolves.toMatchObject({ tags: ['backend'] });
  });
});
