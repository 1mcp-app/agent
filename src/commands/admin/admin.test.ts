import type { ResolvedServeTarget } from '@src/commands/shared/serveTargetResolver.js';
import { RuntimeTargetStoreError } from '@src/domains/runtime-targets/runtimeTargetStore.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  adminBootstrapCommand,
  type AdminBootstrapDependencies,
  type AdminCommandDependencies,
  adminLoginCommand,
  adminLogoutCommand,
  adminStatusCommand,
} from './admin.js';

describe('admin credential commands', () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  let store: {
    current: ReturnType<typeof vi.fn>;
    inspect: ReturnType<typeof vi.fn>;
    setCredentialReferences: ReturnType<typeof vi.fn>;
    setAdminSessionReference: ReturnType<typeof vi.fn>;
    getAdminSessionReference: ReturnType<typeof vi.fn>;
    clearAdminSessionReference: ReturnType<typeof vi.fn>;
  };
  let apiGet: ReturnType<typeof vi.fn>;
  let apiPost: ReturnType<typeof vi.fn>;
  let resolveTarget: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    store = {
      current: vi.fn(() => ({ name: 'prod' })),
      inspect: vi.fn(() => ({ name: 'prod', observedIdentity: { runtimeScopeId: 'scope_prod' } })),
      setCredentialReferences: vi.fn(),
      setAdminSessionReference: vi.fn(),
      getAdminSessionReference: vi.fn(),
      clearAdminSessionReference: vi.fn(),
    };
    apiGet = vi.fn(async (path: string) =>
      path.endsWith('/capabilities')
        ? okResponse(capabilities())
        : okResponse({ ok: true, result: { authenticated: true, account: { role: 'full-admin' } }, warnings: [] }),
    );
    apiPost = vi.fn(async (path: string) =>
      path.endsWith('/login')
        ? okResponse({
            ok: true,
            result: {
              sessionToken: 'admin_sess_remote',
              csrfToken: 'admin_csrf_remote',
              expiresAt: '2026-07-07T01:00:00.000Z',
              account: { role: 'full-admin' },
            },
            warnings: [],
          })
        : okResponse({ ok: true, result: { revoked: true }, warnings: [] }),
    );
    resolveTarget = vi.fn(async () => resolvedTarget());
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it('requires explicit context and rejects credential URL mode', async () => {
    await expect(adminLoginCommand({ username: 'operator', password: 'secret' }, deps())).rejects.toMatchObject({
      code: 'credential_context_required',
      recoveryCommand: '1mcp admin login --context prod',
    });
    await expect(
      adminLoginCommand(
        { context: 'prod', url: 'https://prod.example.com', username: 'operator', password: 'secret' },
        deps(),
      ),
    ).rejects.toMatchObject({ code: 'credential_url_unsupported' });
    expect(resolveTarget).not.toHaveBeenCalled();
  });

  it('logs in through the selected runtime and stores scoped local session references', async () => {
    await adminLoginCommand({ context: 'prod', username: 'operator', password: 'correct horse' }, deps());

    expect(resolveTarget).toHaveBeenCalledWith({ context: 'prod', 'config-dir': undefined });
    expect(apiGet).toHaveBeenCalledWith('/admin/cli/v1/capabilities');
    expect(apiPost).toHaveBeenCalledWith('/admin/cli/v1/session/login', {
      username: 'operator',
      password: 'correct horse',
    });
    expect(store.setAdminSessionReference).toHaveBeenCalledWith('prod', 'scope_prod', {
      sessionToken: 'admin_sess_remote',
      csrfToken: 'admin_csrf_remote',
      expiresAt: '2026-07-07T01:00:00.000Z',
    });
    expect(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
      'Admin login succeeded for prod',
    );
  });

  it('preserves admin login while warning when runtime mutations are temporarily unavailable', async () => {
    apiGet.mockResolvedValueOnce(
      okResponse({
        ok: true,
        cliProtocolVersion: '1',
        result: {
          runtime: {
            runtimeScopeId: 'scope_prod',
            externalUrl: 'https://prod.example.com',
            runtimeVersion: '0.34.0',
          },
          supportedOperations: ['admin.login', 'admin.logout', 'admin.status'],
          adminMutationsAvailable: false,
          adminMutationsUnavailableReason: 'writer_lock_unavailable',
        },
        warnings: [],
      }),
    );

    await adminLoginCommand({ context: 'prod', username: 'operator', password: 'correct horse', json: true }, deps());

    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      ok: true;
      warnings: Array<{ code: string; details?: { reason?: string } }>;
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.warnings).toEqual([
      {
        code: 'warning_admin_mutations_unavailable',
        message: 'Admin login succeeded, but mutation commands are currently unavailable',
        details: {
          reason: 'writer_lock_unavailable',
        },
      },
    ]);
    expect(store.setAdminSessionReference).toHaveBeenCalled();
  });

  it('prompts for missing admin login credentials in human mode without prompting in JSON mode', async () => {
    const promptForCredentials = vi.fn(async () => ({
      username: 'operator',
      password: 'correct horse',
    }));

    await adminLoginCommand({ context: 'prod' }, { ...deps(), promptForCredentials });

    expect(promptForCredentials).toHaveBeenCalledWith('prod', {
      username: undefined,
      password: undefined,
    });
    expect(apiPost).toHaveBeenCalledWith('/admin/cli/v1/session/login', {
      username: 'operator',
      password: 'correct horse',
    });
    expect(store.setAdminSessionReference).toHaveBeenCalledWith('prod', 'scope_prod', {
      sessionToken: 'admin_sess_remote',
      csrfToken: 'admin_csrf_remote',
      expiresAt: '2026-07-07T01:00:00.000Z',
    });

    await expect(adminLoginCommand({ context: 'prod', json: true }, deps())).rejects.toMatchObject({
      code: 'validation_missing_input',
      message: 'Missing admin username',
    });
  });

  it('surfaces stable CLI Admin error envelopes from the selected runtime', async () => {
    apiPost.mockResolvedValueOnce({
      ok: false,
      status: 401,
      data: {
        ok: false,
        cliProtocolVersion: '1',
        requestId: 'req_bad_login',
        error: {
          code: 'invalid_credentials',
          message: 'Invalid admin credentials',
          retryable: false,
        },
        warnings: [],
      },
    });

    await expect(
      adminLoginCommand({ context: 'prod', username: 'operator', password: 'wrong password' }, deps()),
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
      message: 'Invalid admin credentials',
    });
  });

  it('fails when the runtime reports an incompatible CLI Admin protocol', async () => {
    apiGet.mockResolvedValueOnce(
      okResponse({
        ok: true,
        cliProtocolVersion: '2',
        result: {
          runtime: {
            runtimeScopeId: 'scope_prod',
            externalUrl: 'https://prod.example.com',
            runtimeVersion: '0.34.0',
          },
          supportedOperations: ['admin.login'],
        },
        warnings: [],
      }),
    );

    await expect(
      adminLoginCommand({ context: 'prod', username: 'operator', password: 'correct horse' }, deps()),
    ).rejects.toMatchObject({ code: 'protocol_incompatible' });
  });

  it('fails when the runtime does not advertise the requested CLI Admin operation', async () => {
    apiGet.mockResolvedValueOnce(
      okResponse({
        ok: true,
        cliProtocolVersion: '1',
        result: {
          runtime: {
            runtimeScopeId: 'scope_prod',
            externalUrl: 'https://prod.example.com',
            runtimeVersion: '0.34.0',
          },
          supportedOperations: ['admin.login'],
        },
        warnings: [],
      }),
    );

    await expect(adminStatusCommand({ context: 'prod' }, deps())).rejects.toMatchObject({
      code: 'capability_operation_unsupported',
    });
  });

  it('fails login before credential exchange when capabilities report setup required', async () => {
    apiGet.mockResolvedValueOnce(
      okResponse({
        ok: true,
        cliProtocolVersion: '1',
        result: {
          runtime: {
            runtimeScopeId: 'scope_prod',
            externalUrl: 'https://prod.example.com',
            runtimeVersion: '0.34.0',
          },
          supportedOperations: ['admin.login', 'admin.status', 'admin.logout'],
          adminSurface: { enabled: true, status: 'setupRequired' },
        },
        warnings: [],
      }),
    );

    await expect(
      adminLoginCommand({ context: 'prod', username: 'operator', password: 'correct horse' }, deps()),
    ).rejects.toMatchObject({ code: 'capability_admin_setup_required' });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('validates status remotely before reporting authenticated and clears rejected references', async () => {
    store.getAdminSessionReference.mockReturnValue({
      sessionToken: 'admin_sess_remote',
      csrfToken: 'admin_csrf_remote',
      expiresAt: '2026-07-07T01:00:00.000Z',
    });
    apiGet.mockImplementation(async (path: string) =>
      path.endsWith('/capabilities')
        ? okResponse(capabilities())
        : okResponse({
            ok: false,
            error: { code: 'auth_session_revoked', message: 'Admin session was revoked', retryable: false },
            warnings: [],
          }),
    );

    await adminStatusCommand({ context: 'prod', json: true }, deps());

    expect(apiGet).toHaveBeenCalledWith('/admin/cli/v1/session/status');
    expect(store.clearAdminSessionReference).toHaveBeenCalledWith('prod', 'scope_prod');
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      ok: true;
      result: { authenticated: boolean; status: string };
    };
    expect(envelope).toMatchObject({
      ok: true,
      result: { authenticated: false, status: 'unauthenticated' },
    });
  });

  it('does not clear local references when status returns an unverifiable runtime error envelope', async () => {
    store.getAdminSessionReference.mockReturnValue({
      sessionToken: 'admin_sess_remote',
      csrfToken: 'admin_csrf_remote',
      expiresAt: '2026-07-07T01:00:00.000Z',
    });
    apiGet.mockImplementation(async (path: string) =>
      path.endsWith('/capabilities')
        ? okResponse(capabilities())
        : okResponse({
            ok: false,
            error: { code: 'internal_error', message: 'Temporary runtime failure', retryable: true },
            warnings: [],
          }),
    );

    await adminStatusCommand({ context: 'prod', json: true }, deps());

    expect(store.clearAdminSessionReference).not.toHaveBeenCalled();
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      ok: true;
      result: { status: string; localReference: { present: boolean } };
    };
    expect(envelope.result).toMatchObject({
      status: 'unknown',
      localReference: { present: true },
    });
  });

  it('reports unknown with local-reference facts when status cannot verify the runtime', async () => {
    store.getAdminSessionReference.mockReturnValue({ sessionToken: 'admin_sess_remote' });
    resolveTarget.mockRejectedValue(new Error('Cannot connect'));

    await adminStatusCommand({ context: 'prod', json: true }, deps());

    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      ok: true;
      result: { status: string; localReference: { present: boolean } };
    };
    expect(envelope.result).toMatchObject({
      status: 'unknown',
      localReference: { present: true },
    });
  });

  it('clears local references when the selected runtime reports that the CLI Admin adapter is disabled', async () => {
    store.getAdminSessionReference.mockReturnValue({ sessionToken: 'admin_sess_remote' });
    apiGet.mockResolvedValueOnce({ ok: false, status: 404, error: 'HTTP 404' });

    await adminStatusCommand({ context: 'prod', json: true }, deps());

    expect(store.clearAdminSessionReference).toHaveBeenCalledWith('prod', 'scope_prod');
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      ok: true;
      result: { status: string; localReference: { present: boolean } };
    };
    expect(envelope.result).toMatchObject({
      status: 'unauthenticated',
      localReference: { present: false },
    });
  });

  it('reports unknown without clearing local references when the status endpoint is unreachable', async () => {
    store.getAdminSessionReference.mockReturnValue({ sessionToken: 'admin_sess_remote' });
    apiGet.mockImplementation(async (path: string) =>
      path.endsWith('/capabilities')
        ? okResponse(capabilities())
        : { ok: false, status: 0, error: 'Request timed out after 10000ms' },
    );

    await adminStatusCommand({ context: 'prod', json: true }, deps());

    expect(store.clearAdminSessionReference).not.toHaveBeenCalled();
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      ok: true;
      result: { status: string; localReference: { present: boolean } };
    };
    expect(envelope.result).toMatchObject({
      status: 'unknown',
      localReference: { present: true },
    });
  });

  it('revokes remotely before clearing local references and supports explicit forget', async () => {
    store.getAdminSessionReference.mockReturnValue({ sessionToken: 'admin_sess_remote' });

    await adminLogoutCommand({ context: 'prod' }, deps());

    expect(apiPost).toHaveBeenCalledWith('/admin/cli/v1/session/logout', {});
    expect(store.clearAdminSessionReference).toHaveBeenCalledWith('prod', 'scope_prod');

    store.clearAdminSessionReference.mockClear();
    resolveTarget.mockClear();
    apiGet.mockClear();
    apiPost.mockClear();
    await adminLogoutCommand({ context: 'prod', forget: true }, deps());

    expect(resolveTarget).not.toHaveBeenCalled();
    expect(apiGet).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
    expect(store.clearAdminSessionReference).toHaveBeenCalledWith('prod', 'scope_prod');
    expect(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
      'revocation was not confirmed',
    );
  });

  it('clears local references on logout when the selected runtime reports that the CLI Admin adapter is disabled', async () => {
    store.getAdminSessionReference.mockReturnValue({ sessionToken: 'admin_sess_remote' });
    apiGet.mockResolvedValueOnce({ ok: false, status: 404, error: 'HTTP 404' });

    await adminLogoutCommand({ context: 'prod', json: true }, deps());

    expect(apiPost).not.toHaveBeenCalledWith('/admin/cli/v1/session/logout', {});
    expect(store.clearAdminSessionReference).toHaveBeenCalledWith('prod', 'scope_prod');
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      ok: true;
      result: { revoked: boolean; forgotLocalReference: boolean };
    };
    expect(envelope.result).toMatchObject({
      revoked: false,
      forgotLocalReference: true,
    });
  });

  it('fails closed when the local credential store is insecure', async () => {
    store.setAdminSessionReference.mockImplementation(() => {
      throw new RuntimeTargetStoreError(
        'target_secret_store_insecure',
        'Runtime target secret store is too permissive',
      );
    });

    await expect(
      adminLoginCommand({ context: 'prod', username: 'operator', password: 'correct horse' }, deps()),
    ).rejects.toMatchObject({ code: 'target_secret_store_insecure' });
    expect(apiPost).toHaveBeenCalledWith('/admin/cli/v1/session/login', {
      username: 'operator',
      password: 'correct horse',
    });
    expect(apiPost).toHaveBeenCalledWith('/admin/cli/v1/session/logout', {});
  });

  function deps(): AdminCommandDependencies {
    return {
      store: store as unknown as NonNullable<AdminCommandDependencies['store']>,
      resolveTarget: resolveTarget as unknown as NonNullable<AdminCommandDependencies['resolveTarget']>,
      createApiClient: ((_baseUrl: string, _bearerToken?: string) => ({ get: apiGet, post: apiPost })) as NonNullable<
        AdminCommandDependencies['createApiClient']
      >,
    };
  }

  function resolvedTarget(): ResolvedServeTarget<{ context: string }> {
    return {
      cwd: '/tmp/project',
      projectRoot: '/tmp/project',
      projectName: 'project',
      projectConfig: null,
      mergedOptions: { context: 'prod' },
      discoveredUrl: 'https://prod.example.com/mcp',
      serverUrl: new URL('https://prod.example.com/mcp'),
      source: 'user',
      projectContextSource: 'cwd',
      runtimeTargetContext: { name: 'prod', kind: 'remote' },
    };
  }

  function capabilities() {
    return {
      ok: true,
      cliProtocolVersion: '1',
      result: {
        runtime: {
          runtimeScopeId: 'scope_prod',
          externalUrl: 'https://prod.example.com',
          runtimeVersion: '0.34.0',
        },
        supportedOperations: ['admin.login', 'admin.logout', 'admin.status'],
      },
      warnings: [],
    };
  }

  function okResponse(data: unknown) {
    return { ok: true, status: 200, data };
  }
});

describe('admin bootstrap command', () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let resolveConfigPaths: ReturnType<typeof vi.fn>;
  let getRuntimeIdentity: ReturnType<typeof vi.fn>;
  let bootstrapFirstAdmin: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    resolveConfigPaths = vi.fn(() => ({
      configFilePath: '/tmp/runtime/mcp.json',
      runtimeScope: '/tmp/runtime',
    }));
    getRuntimeIdentity = vi.fn(() => ({
      identityProtocolVersion: '1',
      runtimeScopeId: 'scope_local',
      externalUrl: 'http://127.0.0.1',
      runtimeVersion: '0.34.0',
    }));
    bootstrapFirstAdmin = vi.fn(async () => ({
      id: 'admin_acct_1',
      runtimeScopeId: 'scope_local',
      username: 'operator',
      role: 'full-admin',
      disabled: false,
      createdAt: '2026-07-08T01:00:00.000Z',
      updatedAt: '2026-07-08T01:00:00.000Z',
    }));
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  it('creates the first admin account in the selected local Runtime Scope', async () => {
    await adminBootstrapCommand(
      {
        'config-dir': '/tmp/runtime',
        username: 'operator',
        password: 'correct horse battery staple',
      },
      bootstrapDeps(),
    );

    expect(resolveConfigPaths).toHaveBeenCalledWith({ 'config-dir': '/tmp/runtime', config: undefined });
    expect(getRuntimeIdentity).toHaveBeenCalledWith({
      externalUrl: 'http://127.0.0.1',
      runtimeVersion: expect.any(String),
      includeServerTime: false,
    });
    expect(bootstrapFirstAdmin).toHaveBeenCalledWith({
      username: 'operator',
      password: 'correct horse battery staple',
    });
    expect(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
      'Admin bootstrap created first Admin Account for operator',
    );
  });

  it('writes a JSON success envelope without exposing the password', async () => {
    await adminBootstrapCommand(
      {
        config: '/tmp/runtime/mcp.json',
        username: 'operator',
        password: 'correct horse battery staple',
        json: true,
      },
      bootstrapDeps(),
    );

    const output = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join(''));
    expect(output).toMatchObject({
      ok: true,
      operation: 'admin.bootstrap',
      target: {
        runtimeScopeId: 'scope_local',
        runtimeScope: '/tmp/runtime',
      },
      result: {
        account: {
          username: 'operator',
          role: 'full-admin',
        },
      },
    });
    expect(JSON.stringify(output)).not.toContain('correct horse battery staple');
  });

  it('requires username and password before writing admin state', async () => {
    await expect(
      adminBootstrapCommand({ password: 'correct horse battery staple' }, bootstrapDeps()),
    ).rejects.toMatchObject({
      code: 'validation_missing_input',
      message: 'Missing admin username',
    });
    await expect(adminBootstrapCommand({ username: 'operator' }, bootstrapDeps())).rejects.toMatchObject({
      code: 'validation_missing_input',
      message: 'Missing admin password',
    });
    expect(bootstrapFirstAdmin).not.toHaveBeenCalled();
  });

  function bootstrapDeps(): AdminBootstrapDependencies {
    return {
      resolveConfigPaths: resolveConfigPaths as AdminBootstrapDependencies['resolveConfigPaths'],
      createRuntimeIdentityService: (() => ({
        getRuntimeIdentity,
      })) as AdminBootstrapDependencies['createRuntimeIdentityService'],
      createAdminIdentityService: (() => ({
        bootstrapFirstAdmin,
      })) as AdminBootstrapDependencies['createAdminIdentityService'],
    };
  }
});
