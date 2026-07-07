import type { ResolvedProjectContext } from '@src/config/projectConfigLoader.js';
import type { ProjectConfig } from '@src/config/projectConfigTypes.js';
import { RuntimeTargetStoreError } from '@src/domains/runtime-targets/runtimeTargetStore.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mergeServeTargetOptions,
  type ResolvableServeTargetOptions,
  resolveServeTarget,
} from './serveTargetResolver.js';

const mockedResolveProjectContext = vi.hoisted(() => vi.fn());
const mockedDiscoverServerWithPidFile = vi.hoisted(() => vi.fn());
const mockedValidateServer1mcpUrl = vi.hoisted(() => vi.fn());

vi.mock('@src/config/projectConfigLoader.js', async () => {
  const actual = await vi.importActual<typeof import('@src/config/projectConfigLoader.js')>(
    '@src/config/projectConfigLoader.js',
  );
  return {
    ...actual,
    resolveProjectContext: mockedResolveProjectContext,
  };
});

vi.mock('@src/utils/validation/urlDetection.js', () => ({
  discoverServerWithPidFile: mockedDiscoverServerWithPidFile,
  validateServer1mcpUrl: mockedValidateServer1mcpUrl,
}));

describe('mergeServeTargetOptions', () => {
  it('prefers explicit CLI selector source over project config selectors', () => {
    const projectConfig: ProjectConfig = {
      preset: 'from-project',
      filter: 'project-filter',
      tags: ['project-tag'],
    };

    expect(
      mergeServeTargetOptions(
        {
          preset: 'from-cli',
        },
        projectConfig,
      ),
    ).toMatchObject({
      preset: 'from-cli',
      filter: undefined,
      tags: undefined,
    });
  });

  it('keeps ambiguous explicit CLI selectors for Filter Selection validation', () => {
    const projectConfig: ProjectConfig = {
      preset: 'from-project',
    };

    expect(
      mergeServeTargetOptions(
        {
          filter: 'cli-filter',
          tags: ['cli-tag'],
        },
        projectConfig,
      ),
    ).toMatchObject({
      preset: undefined,
      filter: 'cli-filter',
      tags: ['cli-tag'],
    });
  });

  it('fills one selector from project config using prior URL precedence', () => {
    const projectConfig: ProjectConfig = {
      preset: 'from-project',
      filter: 'project-filter',
      tags: ['project-tag'],
    };

    expect(mergeServeTargetOptions({ url: 'http://localhost:3050/mcp' }, projectConfig)).toMatchObject({
      preset: 'from-project',
      filter: undefined,
      tags: undefined,
    });
  });
});

describe('resolveServeTarget', () => {
  beforeEach(() => {
    mockedResolveProjectContext.mockReset();
    mockedDiscoverServerWithPidFile.mockReset();
    mockedValidateServer1mcpUrl.mockReset();

    mockedResolveProjectContext.mockResolvedValue({
      cwd: '/tmp/project/packages/api',
      projectRoot: '/tmp/project',
      projectName: 'project',
      projectConfig: {
        preset: 'development',
        tags: ['backend'],
      } satisfies ProjectConfig,
      source: 'project-config',
    } satisfies ResolvedProjectContext);
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
    const options: ResolvableServeTargetOptions = {
      'config-dir': '.tmp-test',
      filter: 'tooling',
    };
    const result = await resolveServeTarget(options);

    expect(mockedDiscoverServerWithPidFile).toHaveBeenCalledWith('.tmp-test', undefined);
    expect(mockedValidateServer1mcpUrl).toHaveBeenCalledWith('http://127.0.0.1:3050/mcp');
    expect(result.serverUrl.toString()).toBe('http://127.0.0.1:3050/mcp?filter=tooling');
    expect(result.cwd).toBe('/tmp/project/packages/api');
    expect(result.projectRoot).toBe('/tmp/project');
    expect(result.projectName).toBe('project');
    expect(result.projectContextSource).toBe('project-config');
    expect(result.mergedOptions.filter).toBe('tooling');
    expect(result.mergedOptions.preset).toBeUndefined();
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

  it('rejects mutually exclusive explicit url and context selectors', async () => {
    await expect(resolveServeTarget({ url: 'https://prod.example.com', context: 'prod' })).rejects.toMatchObject({
      code: 'target_selector_conflict',
    });
    expect(mockedDiscoverServerWithPidFile).not.toHaveBeenCalled();
  });

  it('rejects config-dir when an ephemeral url target is selected', async () => {
    await expect(
      resolveServeTarget({ url: 'https://prod.example.com', 'config-dir': '/tmp/local-scope' }),
    ).rejects.toMatchObject({ code: 'target_config_dir_remote_unsupported' });
    expect(mockedDiscoverServerWithPidFile).not.toHaveBeenCalled();
  });

  it('normalizes explicit ephemeral url targets before local discovery handling', async () => {
    await resolveServeTarget({ url: 'https://prod.example.com?x=1#frag' });

    expect(mockedDiscoverServerWithPidFile).toHaveBeenCalledWith(undefined, 'https://prod.example.com/mcp');
  });

  it('rejects non-loopback HTTP ephemeral URL targets without insecure opt-in', async () => {
    await expect(resolveServeTarget({ url: 'http://prod.example.com' })).rejects.toMatchObject({
      code: 'target_url_invalid',
    });
    expect(mockedDiscoverServerWithPidFile).not.toHaveBeenCalled();

    await resolveServeTarget({ url: 'http://127.0.0.1:3050?x=1#frag' });

    expect(mockedDiscoverServerWithPidFile).toHaveBeenCalledWith(undefined, 'http://127.0.0.1:3050/mcp');
  });

  it('resolves an explicit remote target context through runtime identity before returning a credentialable URL', async () => {
    const updateObservedIdentityMetadata = vi.fn();
    const verifyRuntimeIdentity = vi.fn().mockResolvedValue({
      identity: {
        identityProtocolVersion: '1',
        runtimeScopeId: 'scope_prod',
        externalUrl: 'https://prod.example.com',
        runtimeVersion: '0.34.0',
      },
      warnings: [],
    });

    const result = await resolveServeTarget(
      {
        context: 'prod',
        preset: 'production',
      },
      {
        runtimeTargetStore: {
          inspect: vi.fn().mockReturnValue({
            name: 'prod',
            kind: 'remote',
            synthetic: false,
            current: false,
            url: 'https://prod.example.com',
            caFile: '/etc/ssl/prod-ca.pem',
            insecureSkipVerify: true,
            observedIdentity: {
              identityProtocolVersion: '1',
              runtimeScopeId: 'scope_prod',
              externalUrl: 'https://prod.example.com',
              runtimeVersion: '0.34.0',
            },
          }),
          current: vi.fn(),
          requireInsecureTlsConfirmation: vi.fn(),
          updateObservedIdentityMetadata,
        },
        verifyRuntimeIdentity,
      },
    );

    expect(mockedDiscoverServerWithPidFile).not.toHaveBeenCalled();
    expect(verifyRuntimeIdentity).toHaveBeenCalledWith({
      target: expect.objectContaining({
        name: 'prod',
        url: 'https://prod.example.com',
        caFile: '/etc/ssl/prod-ca.pem',
        insecureSkipVerify: true,
        observedIdentity: expect.objectContaining({ runtimeScopeId: 'scope_prod' }),
      }),
    });
    expect(updateObservedIdentityMetadata).toHaveBeenCalledWith(
      'prod',
      expect.objectContaining({ runtimeScopeId: 'scope_prod' }),
    );
    expect(mockedValidateServer1mcpUrl).toHaveBeenCalledWith('https://prod.example.com/mcp', {
      caFile: '/etc/ssl/prod-ca.pem',
      insecureSkipVerify: true,
    });
    expect(result.discoveredUrl).toBe('https://prod.example.com/mcp');
    expect(result.serverUrl.toString()).toBe('https://prod.example.com/mcp?preset=production');
    expect(result.source).toBe('user');
  });

  it('carries externalUrl mismatch warnings from named remote identity verification', async () => {
    const result = await resolveServeTarget(
      {
        context: 'prod',
      },
      {
        runtimeTargetStore: {
          inspect: vi.fn().mockReturnValue({
            name: 'prod',
            kind: 'remote',
            synthetic: false,
            current: false,
            url: 'https://prod.example.com',
            observedIdentity: {
              identityProtocolVersion: '1',
              runtimeScopeId: 'scope_prod',
              externalUrl: 'https://prod.example.com',
              runtimeVersion: '0.34.0',
            },
          }),
          current: vi.fn(),
          requireInsecureTlsConfirmation: vi.fn(),
          updateObservedIdentityMetadata: vi.fn(),
        },
        verifyRuntimeIdentity: vi.fn().mockResolvedValue({
          identity: {
            identityProtocolVersion: '1',
            runtimeScopeId: 'scope_prod',
            externalUrl: 'https://proxy.example.com',
            runtimeVersion: '0.34.0',
          },
          warnings: [{ code: 'warning_external_url_mismatch', message: 'external URL differs' }],
        }),
      },
    );

    expect(result.runtimeIdentityWarnings).toEqual([
      { code: 'warning_external_url_mismatch', message: 'external URL differs' },
    ]);
  });

  it('normalizes stored remote target URLs before appending the MCP suffix', async () => {
    await resolveServeTarget(
      {
        context: 'prod',
      },
      {
        runtimeTargetStore: {
          inspect: vi.fn().mockReturnValue({
            name: 'prod',
            kind: 'remote',
            synthetic: false,
            current: false,
            url: 'https://prod.example.com/mcp?ignored=true',
            observedIdentity: {
              identityProtocolVersion: '1',
              runtimeScopeId: 'scope_prod',
              externalUrl: 'https://prod.example.com',
              runtimeVersion: '0.34.0',
            },
          }),
          current: vi.fn(),
          requireInsecureTlsConfirmation: vi.fn(),
          updateObservedIdentityMetadata: vi.fn(),
        },
        verifyRuntimeIdentity: vi.fn().mockResolvedValue({
          identity: {
            identityProtocolVersion: '1',
            runtimeScopeId: 'scope_prod',
            externalUrl: 'https://prod.example.com',
            runtimeVersion: '0.34.0',
          },
          warnings: [],
        }),
      },
    );

    expect(mockedValidateServer1mcpUrl).toHaveBeenCalledWith('https://prod.example.com/mcp');
  });

  it('uses the current remote context when no explicit url or context is provided', async () => {
    const verifyRuntimeIdentity = vi.fn().mockResolvedValue({
      identity: {
        identityProtocolVersion: '1',
        runtimeScopeId: 'scope_prod',
        externalUrl: 'https://prod.example.com',
        runtimeVersion: '0.34.0',
      },
      warnings: [],
    });

    await resolveServeTarget(
      {},
      {
        runtimeTargetStore: {
          inspect: vi.fn(),
          current: vi.fn().mockReturnValue({
            name: 'prod',
            kind: 'remote',
            synthetic: false,
            current: true,
            url: 'https://prod.example.com',
            observedIdentity: {
              identityProtocolVersion: '1',
              runtimeScopeId: 'scope_prod',
              externalUrl: 'https://prod.example.com',
              runtimeVersion: '0.34.0',
            },
          }),
          requireInsecureTlsConfirmation: vi.fn(),
          updateObservedIdentityMetadata: vi.fn(),
        },
        verifyRuntimeIdentity,
      },
    );

    expect(mockedDiscoverServerWithPidFile).not.toHaveBeenCalled();
    expect(verifyRuntimeIdentity).toHaveBeenCalled();
  });

  it('rejects config-dir when a remote target context is selected', async () => {
    await expect(
      resolveServeTarget(
        { context: 'prod', 'config-dir': '/tmp/local-scope' },
        {
          runtimeTargetStore: {
            inspect: vi.fn().mockReturnValue({
              name: 'prod',
              kind: 'remote',
              synthetic: false,
              current: false,
              url: 'https://prod.example.com',
            }),
            current: vi.fn(),
            requireInsecureTlsConfirmation: vi.fn(),
            updateObservedIdentityMetadata: vi.fn(),
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'target_config_dir_remote_unsupported' });
    expect(mockedDiscoverServerWithPidFile).not.toHaveBeenCalled();
  });

  it('fails named remote attach before identity verification when imported insecure TLS confirmation is pending', async () => {
    const verifyRuntimeIdentity = vi.fn();
    const requireInsecureTlsConfirmation = vi.fn(() => {
      throw new RuntimeTargetStoreError(
        'target_insecure_tls_confirmation_required',
        'Runtime target "prod" uses imported insecure TLS metadata and requires confirmation',
        { operation: 'credentialed-attach', targetName: 'prod' },
        '1mcp target verify prod --accept-insecure-tls',
      );
    });

    await expect(
      resolveServeTarget(
        { context: 'prod' },
        {
          runtimeTargetStore: {
            inspect: vi.fn().mockReturnValue({
              name: 'prod',
              kind: 'remote',
              synthetic: false,
              current: false,
              url: 'https://prod.example.com',
              insecureTlsConfirmationRequired: true,
            }),
            current: vi.fn(),
            requireInsecureTlsConfirmation,
            updateObservedIdentityMetadata: vi.fn(),
          },
          verifyRuntimeIdentity,
        },
      ),
    ).rejects.toMatchObject({
      code: 'target_insecure_tls_confirmation_required',
      recoveryCommand: '1mcp target verify prod --accept-insecure-tls',
    });
    expect(requireInsecureTlsConfirmation).toHaveBeenCalledWith({
      name: 'prod',
      operation: 'credentialed-attach',
    });
    expect(verifyRuntimeIdentity).not.toHaveBeenCalled();
    expect(mockedValidateServer1mcpUrl).not.toHaveBeenCalled();
  });

  it('continues named remote attach after insecure TLS confirmation has already been cleared', async () => {
    const requireInsecureTlsConfirmation = vi.fn();
    const verifyRuntimeIdentity = vi.fn().mockResolvedValue({
      identity: {
        identityProtocolVersion: '1',
        runtimeScopeId: 'scope_prod',
        externalUrl: 'https://prod.example.com',
        runtimeVersion: '0.34.0',
      },
      warnings: [],
    });

    await resolveServeTarget(
      { context: 'prod' },
      {
        runtimeTargetStore: {
          inspect: vi.fn().mockReturnValue({
            name: 'prod',
            kind: 'remote',
            synthetic: false,
            current: false,
            url: 'https://prod.example.com',
            insecureTlsConfirmationRequired: false,
          }),
          current: vi.fn(),
          requireInsecureTlsConfirmation,
          updateObservedIdentityMetadata: vi.fn(),
        },
        verifyRuntimeIdentity,
      },
    );

    expect(requireInsecureTlsConfirmation).toHaveBeenCalledWith({
      name: 'prod',
      operation: 'credentialed-attach',
    });
    expect(verifyRuntimeIdentity).toHaveBeenCalled();
  });
});
