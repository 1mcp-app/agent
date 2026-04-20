import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadProjectConfig, resolveProjectContext } from './projectConfigLoader.js';

describe('resolveProjectContext', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function makeTempProject(): Promise<string> {
    const dir = await mkdtemp(join(os.tmpdir(), 'project-config-loader-'));
    tempDirs.push(dir);
    return dir;
  }

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
