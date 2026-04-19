import type { ProjectConfig } from '@src/config/projectConfigTypes.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeServeTargetOptions, resolveServeTarget } from './serveTargetResolver.js';

const mockedLoadProjectConfig = vi.hoisted(() => vi.fn());
const mockedDiscoverServerWithPidFile = vi.hoisted(() => vi.fn());
const mockedValidateServer1mcpUrl = vi.hoisted(() => vi.fn());

vi.mock('@src/config/projectConfigLoader.js', async () => {
  const actual = await vi.importActual<typeof import('@src/config/projectConfigLoader.js')>(
    '@src/config/projectConfigLoader.js',
  );
  return {
    ...actual,
    loadProjectConfig: mockedLoadProjectConfig,
  };
});

vi.mock('@src/utils/validation/urlDetection.js', () => ({
  discoverServerWithPidFile: mockedDiscoverServerWithPidFile,
  validateServer1mcpUrl: mockedValidateServer1mcpUrl,
}));

describe('mergeServeTargetOptions', () => {
  it('prefers explicit CLI selectors over project config', () => {
    const projectConfig: ProjectConfig = {
      preset: 'from-project',
      filter: 'project-filter',
      tags: ['project-tag'],
    };

    expect(
      mergeServeTargetOptions(
        {
          preset: 'from-cli',
          filter: 'cli-filter',
          tags: ['cli-tag'],
        },
        projectConfig,
      ),
    ).toMatchObject({
      preset: 'from-cli',
      filter: 'cli-filter',
      tags: ['cli-tag'],
    });
  });

  it('fills missing selectors from project config', () => {
    const projectConfig: ProjectConfig = {
      preset: 'from-project',
      filter: 'project-filter',
      tags: ['project-tag'],
    };

    expect(mergeServeTargetOptions({ url: 'http://localhost:3050/mcp' }, projectConfig)).toMatchObject({
      preset: 'from-project',
      filter: 'project-filter',
      tags: ['project-tag'],
    });
  });
});

describe('resolveServeTarget', () => {
  beforeEach(() => {
    mockedLoadProjectConfig.mockReset();
    mockedDiscoverServerWithPidFile.mockReset();
    mockedValidateServer1mcpUrl.mockReset();

    mockedLoadProjectConfig.mockResolvedValue({
      preset: 'development',
      tags: ['backend'],
    } satisfies ProjectConfig);
    mockedDiscoverServerWithPidFile.mockResolvedValue({
      url: 'http://127.0.0.1:3050/mcp',
      pid: 4242,
      source: 'pidfile',
    });
    mockedValidateServer1mcpUrl.mockResolvedValue({ valid: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns merged options and resolved URLs', async () => {
    const result = await resolveServeTarget({
      'config-dir': '.tmp-test',
      filter: 'tooling',
    });

    expect(mockedDiscoverServerWithPidFile).toHaveBeenCalledWith('.tmp-test', undefined);
    expect(mockedValidateServer1mcpUrl).toHaveBeenCalledWith('http://127.0.0.1:3050/mcp');
    expect(result.serverUrl.toString()).toBe('http://127.0.0.1:3050/mcp?preset=development');
    expect(result.mergedOptions.filter).toBe('tooling');
    expect(result.source).toBe('pidfile');
    expect(result.serverPid).toBe(4242);
  });

  it('throws when validation fails', async () => {
    mockedValidateServer1mcpUrl.mockResolvedValue({
      valid: false,
      error: 'Cannot connect',
    });

    await expect(resolveServeTarget({})).rejects.toThrow('Cannot connect');
  });
});
