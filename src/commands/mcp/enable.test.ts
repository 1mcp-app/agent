import printer from '@src/utils/ui/printer.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as configUtils from './utils/mcpServerConfig.js';
import { disableCommand, enableCommand } from './enable.js';

vi.mock('@src/utils/ui/printer.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    blank: vi.fn(),
    raw: vi.fn(),
    title: vi.fn(),
    subtitle: vi.fn(),
    keyValue: vi.fn(),
    table: vi.fn(),
  },
}));

vi.mock('./utils/mcpServerConfig.js', () => ({
  backupConfig: vi.fn(() => '/tmp/config.backup'),
  getServer: vi.fn(),
  initializeConfigContext: vi.fn(),
  reloadMcpConfig: vi.fn(),
  serverExists: vi.fn(),
  setServer: vi.fn(),
  validateConfigPath: vi.fn(),
}));

vi.mock('./utils/validation.js', () => ({
  validateServerName: vi.fn(),
}));

describe('enableCommand', () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let exit: ReturnType<typeof vi.spyOn>;
  let processExitCode: string | number | null | undefined;
  let runtimeTargetStore: {
    current: ReturnType<typeof vi.fn>;
    inspect: ReturnType<typeof vi.fn>;
    getAdminSessionReference: ReturnType<typeof vi.fn>;
    setAdminSessionReference: ReturnType<typeof vi.fn>;
    clearAdminSessionReference: ReturnType<typeof vi.fn>;
  };
  let resolveTarget: ReturnType<typeof vi.fn>;
  let apiGet: ReturnType<typeof vi.fn>;
  let apiPost: ReturnType<typeof vi.fn>;
  let createApiClient: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    processExitCode = process.exitCode;
    process.exitCode = undefined;
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.clearAllMocks();
    vi.mocked(configUtils.serverExists as any).mockReturnValue(true);
    vi.mocked(configUtils.getServer as any).mockReturnValue({
      type: 'stdio',
      command: 'echo',
      disabled: true,
    });
    runtimeTargetStore = {
      current: vi.fn(() => ({ name: 'local', kind: 'local' })),
      inspect: vi.fn(() => ({ name: 'prod', kind: 'remote', observedIdentity: { runtimeScopeId: 'scope_prod' } })),
      getAdminSessionReference: vi.fn(() => ({ sessionToken: 'admin_sess_remote' })),
      setAdminSessionReference: vi.fn(),
      clearAdminSessionReference: vi.fn(),
    };
    resolveTarget = vi.fn(async () => ({
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
    }));
    apiGet = vi.fn(async (path: string) =>
      path.endsWith('/capabilities')
        ? okResponse({
            ok: true,
            cliProtocolVersion: '1',
            warnings: [],
            result: {
              runtime: { runtimeScopeId: 'scope_prod', runtimeVersion: '0.34.0' },
              supportedOperations: ['mcp.enable', 'mcp.disable'],
              mutationReadiness: { mcp: { enabled: true, operations: ['enable', 'disable'] } },
              features: { mcpEnableDisable: true },
            },
          })
        : okResponse({
            ok: true,
            cliProtocolVersion: '1',
            warnings: [],
            result: { authenticated: true },
          }),
    );
    apiPost = vi.fn(async () =>
      okResponse({
        ok: true,
        cliProtocolVersion: '1',
        warnings: [],
        result: {
          operationId: 'op_enable',
          operationName: 'enableConfiguredServer',
          replayed: false,
          result: { targetName: 'test-server', enabled: true, outcome: 'enabled' },
        },
      }),
    );
    createApiClient = vi.fn(() => ({ get: apiGet, post: apiPost }));
  });

  afterEach(() => {
    stdout.mockRestore();
    exit.mockRestore();
    process.exitCode = processExitCode;
  });

  it('persists the enabled state without calling runtime reload', async () => {
    await enableCommand({
      name: 'test-server',
      config: '/tmp/test-config.json',
      'config-dir': '/tmp',
      context: 'local',
    });

    expect(configUtils.setServer).toHaveBeenCalledWith('test-server', expect.not.objectContaining({ disabled: true }));
    expect(configUtils.reloadMcpConfig).not.toHaveBeenCalled();
    expect(printer.success).toHaveBeenCalledWith("Successfully enabled server 'test-server'");
  });

  it('keeps local-first fallback when the current runtime target is local', async () => {
    await enableCommand(
      {
        name: 'test-server',
        config: '/tmp/test-config.json',
        'config-dir': '/tmp',
      },
      deps(),
    );

    expect(runtimeTargetStore.current).toHaveBeenCalled();
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(configUtils.setServer).toHaveBeenCalledWith('test-server', expect.not.objectContaining({ disabled: true }));
  });

  it('prefers the CLI Admin adapter when the current local runtime is running', async () => {
    resolveTarget.mockResolvedValueOnce({
      cwd: '/tmp/project',
      projectRoot: '/tmp/project',
      projectName: 'project',
      projectConfig: null,
      mergedOptions: { context: 'local' },
      discoveredUrl: 'http://127.0.0.1:3050/mcp',
      serverUrl: new URL('http://127.0.0.1:3050/mcp'),
      source: 'pidfile',
      projectContextSource: 'cwd',
      runtimeTargetContext: { name: 'local', kind: 'local', runtimeScopeId: 'scope_local' },
    });
    apiGet.mockImplementation(async (path: string) =>
      path.endsWith('/capabilities')
        ? okResponse({
            ok: true,
            cliProtocolVersion: '1',
            warnings: [],
            result: {
              runtime: { runtimeScopeId: 'scope_local', runtimeVersion: '0.34.0' },
              supportedOperations: ['mcp.enable', 'mcp.disable'],
              mutationReadiness: { mcp: { enabled: true, operations: ['enable', 'disable'] } },
              features: { mcpEnableDisable: true },
            },
          })
        : okResponse({
            ok: true,
            cliProtocolVersion: '1',
            warnings: [],
            result: { authenticated: true },
          }),
    );

    await enableCommand(
      {
        name: 'test-server',
        config: '/tmp/test-config.json',
        'config-dir': '/tmp',
        context: 'local',
        json: true,
        idempotencyKey: 'idem_local',
      },
      deps(),
    );

    expect(resolveTarget).toHaveBeenCalledWith(expect.objectContaining({ context: 'local' }));
    expect(runtimeTargetStore.getAdminSessionReference).toHaveBeenCalledWith('local', 'scope_local');
    expect(apiPost).toHaveBeenCalledWith(
      '/admin/cli/v1/operations/enable-server',
      { targetName: 'test-server' },
      { headers: { 'Idempotency-Key': 'idem_local' }, timeout: expect.any(Number) },
    );
    expect(configUtils.setServer).not.toHaveBeenCalled();
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      ok: true;
      target: { context: string; runtimeScopeId: string; url: string };
    };
    expect(envelope.target).toEqual({
      context: 'local',
      runtimeScopeId: 'scope_local',
      url: 'http://127.0.0.1:3050',
    });
  });

  it('routes named remote contexts through the CLI Admin adapter with scoped Admin Session credentials', async () => {
    await enableCommand(
      {
        name: 'test-server',
        context: 'prod',
        json: true,
        idempotencyKey: 'idem_enable',
      },
      deps(),
    );

    expect(resolveTarget).toHaveBeenCalledWith(expect.objectContaining({ context: 'prod' }));
    expect(apiGet).toHaveBeenCalledWith('/admin/cli/v1/capabilities');
    expect(apiGet).toHaveBeenCalledWith('/admin/cli/v1/session/status');
    expect(runtimeTargetStore.getAdminSessionReference).toHaveBeenCalledWith('prod', 'scope_prod');
    expect(apiPost).toHaveBeenCalledWith(
      '/admin/cli/v1/operations/enable-server',
      { targetName: 'test-server' },
      { headers: { 'Idempotency-Key': 'idem_enable' }, timeout: expect.any(Number) },
    );
    expect(configUtils.setServer).not.toHaveBeenCalled();
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      ok: true;
      operation: string;
      target: { context: string; runtimeScopeId: string };
      result: { result: { targetName: string; enabled: boolean } };
    };
    expect(envelope).toMatchObject({
      ok: true,
      operation: 'mcp.enable',
      target: { context: 'prod', runtimeScopeId: 'scope_prod' },
      result: { result: { targetName: 'test-server', enabled: true } },
    });
  });

  it('uses the current remote target context when no explicit selector is provided', async () => {
    runtimeTargetStore.current.mockReturnValue({ name: 'prod', kind: 'remote' });

    await enableCommand({ name: 'test-server', json: true, idempotencyKey: 'idem_enable' }, deps());

    expect(resolveTarget).toHaveBeenCalledWith(expect.objectContaining({ context: 'prod' }));
    expect(configUtils.setServer).not.toHaveBeenCalled();
  });

  it('sends a generated default idempotency key for successful runtime mutations', async () => {
    await enableCommand({ name: 'test-server', context: 'prod', json: true }, deps());

    expect(apiPost).toHaveBeenCalledWith(
      '/admin/cli/v1/operations/enable-server',
      { targetName: 'test-server' },
      { headers: { 'Idempotency-Key': 'idem_generated' }, timeout: expect.any(Number) },
    );
  });

  it('routes disable through the matching CLI Admin operation endpoint', async () => {
    await disableCommand(
      {
        name: 'test-server',
        context: 'prod',
        json: true,
        idempotencyKey: 'idem_disable',
      },
      deps(),
    );

    expect(apiPost).toHaveBeenCalledWith(
      '/admin/cli/v1/operations/disable-server',
      { targetName: 'test-server' },
      { headers: { 'Idempotency-Key': 'idem_disable' }, timeout: expect.any(Number) },
    );
  });

  it('posts runtime-backed dry-runs without mutating local config and returns dry-run facts', async () => {
    apiPost.mockResolvedValueOnce(
      okResponse({
        ok: true,
        cliProtocolVersion: '1',
        warnings: [],
        result: {
          operationId: 'op_preview',
          operationName: 'enableConfiguredServer',
          replayed: false,
          mode: 'dry_run',
          targetName: 'test-server',
          enabled: true,
          outcome: 'enabled',
          configChange: {
            status: 'changed',
            operation: 'enable',
            changed: true,
            backup: { created: false },
            reload: { status: 'skipped' },
          },
        },
      }),
    );

    await enableCommand(
      {
        name: 'test-server',
        context: 'prod',
        json: true,
        dryRun: true,
        idempotencyKey: 'idem_preview',
      },
      deps(),
    );

    expect(apiPost).toHaveBeenCalledWith(
      '/admin/cli/v1/operations/enable-server',
      { targetName: 'test-server', dryRun: true },
      { headers: { 'Idempotency-Key': 'idem_preview' }, timeout: expect.any(Number) },
    );
    expect(configUtils.setServer).not.toHaveBeenCalled();
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      ok: true;
      result: { mode: string; targetName: string };
    };
    expect(envelope.result).toMatchObject({
      mode: 'dry_run',
      targetName: 'test-server',
    });
  });

  it('sends explicit non-loopback confirmation facts for runtime-backed mutations', async () => {
    await enableCommand(
      {
        name: 'test-server',
        context: 'prod',
        json: true,
        idempotencyKey: 'idem_confirmed',
        confirmNonLoopback: true,
      },
      deps(),
    );

    expect(apiPost).toHaveBeenCalledWith(
      '/admin/cli/v1/operations/enable-server',
      {
        targetName: 'test-server',
        confirmationFacts: {
          confirm_non_loopback_runtime: true,
          confirmationSource: 'cli_flag',
          confirmedOperation: 'mcp.enable',
          confirmedRuntimeScopeId: 'scope_prod',
          confirmedTargetContext: 'prod',
          confirmedTargetUrl: 'https://prod.example.com',
        },
      },
      { headers: { 'Idempotency-Key': 'idem_confirmed' }, timeout: expect.any(Number) },
    );
  });

  it('adds non-loopback confirmation recovery guidance when the runtime requires confirmation', async () => {
    apiPost.mockResolvedValueOnce(
      okResponse({
        ok: false,
        cliProtocolVersion: '1',
        warnings: [],
        error: {
          code: 'mutation_confirmation_required',
          message: 'Additional mutation confirmation is required',
          retryable: false,
          details: {
            confirmationRequirements: [{ code: 'confirm_non_loopback_runtime', expected: true }],
          },
        },
      }),
    );

    await enableCommand(
      {
        name: 'test-server',
        context: 'prod',
        json: true,
        idempotencyKey: 'idem_confirm',
      },
      deps(),
    );

    expect(process.exitCode).toBe(1);
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      error: { code: string; recoveryCommand?: string; details?: unknown };
    };
    expect(envelope.error).toMatchObject({
      code: 'mutation_confirmation_required',
      recoveryCommand:
        '1mcp mcp enable test-server --context prod --idempotency-key idem_confirm --confirm-non-loopback --json',
    });
    expect(envelope).toMatchObject({
      target: { context: 'prod' },
    });
  });

  it('can prompt for admin credentials, store a scoped session, and continue a runtime-backed mutation', async () => {
    runtimeTargetStore.getAdminSessionReference.mockReturnValue(undefined);
    apiPost.mockImplementation(async (path: string) =>
      path.endsWith('/session/login')
        ? okResponse({
            ok: true,
            cliProtocolVersion: '1',
            warnings: [],
            result: {
              sessionToken: 'admin_sess_prompted',
              csrfToken: 'admin_csrf_prompted',
              expiresAt: '2026-07-07T01:00:00.000Z',
            },
          })
        : okResponse({
            ok: true,
            cliProtocolVersion: '1',
            warnings: [],
            result: {
              operationId: 'op_enable',
              operationName: 'enableConfiguredServer',
              replayed: false,
              targetName: 'test-server',
              enabled: true,
              outcome: 'enabled',
            },
          }),
    );
    const promptForAdminCredentials = vi.fn(async () => ({
      username: 'operator',
      password: 'correct horse',
    }));

    await enableCommand(
      {
        name: 'test-server',
        context: 'prod',
        idempotencyKey: 'idem_prompted',
      },
      { ...deps(), promptForAdminCredentials },
    );

    expect(promptForAdminCredentials).toHaveBeenCalledWith('prod');
    expect(apiPost).toHaveBeenCalledWith('/admin/cli/v1/session/login', {
      username: 'operator',
      password: 'correct horse',
    });
    expect(runtimeTargetStore.setAdminSessionReference).toHaveBeenCalledWith('prod', 'scope_prod', {
      sessionToken: 'admin_sess_prompted',
      csrfToken: 'admin_csrf_prompted',
      expiresAt: '2026-07-07T01:00:00.000Z',
    });
    expect(apiPost).toHaveBeenCalledWith(
      '/admin/cli/v1/operations/enable-server',
      { targetName: 'test-server' },
      { headers: { 'Idempotency-Key': 'idem_prompted' }, timeout: expect.any(Number) },
    );
  });

  it('revokes a prompted admin session when local session persistence fails', async () => {
    runtimeTargetStore.getAdminSessionReference.mockReturnValue(undefined);
    runtimeTargetStore.setAdminSessionReference.mockImplementation(() => {
      throw new Error('secret store is insecure');
    });
    apiPost.mockImplementation(async (path: string) =>
      path.endsWith('/session/login')
        ? okResponse({
            ok: true,
            cliProtocolVersion: '1',
            warnings: [],
            result: {
              sessionToken: 'admin_sess_prompted',
              csrfToken: 'admin_csrf_prompted',
              expiresAt: '2026-07-07T01:00:00.000Z',
            },
          })
        : okResponse({
            ok: true,
            cliProtocolVersion: '1',
            warnings: [],
            result: { revoked: true },
          }),
    );

    await enableCommand(
      {
        name: 'test-server',
        context: 'prod',
      },
      {
        ...deps(),
        promptForAdminCredentials: vi.fn(async () => ({
          username: 'operator',
          password: 'correct horse',
        })),
      },
    );

    expect(apiPost).toHaveBeenCalledWith('/admin/cli/v1/session/logout', {});
    expect(apiPost).not.toHaveBeenCalledWith(
      '/admin/cli/v1/operations/enable-server',
      expect.anything(),
      expect.anything(),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('rejects ephemeral URL targets for credentialed admin mutation', async () => {
    await enableCommand({ name: 'test-server', url: 'https://runtime.example.com', json: true }, deps());

    expect(resolveTarget).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(4);
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      error: { code: string };
    };
    expect(envelope.error.code).toBe('target_url_credentialed_mutation_unsupported');
  });

  it('fails JSON mode with a stable recovery command when the remote context has no Admin Session reference', async () => {
    runtimeTargetStore.getAdminSessionReference.mockReturnValue(undefined);

    await enableCommand(
      {
        name: 'test-server',
        context: 'prod',
        json: true,
        idempotencyKey: 'idem_enable',
      },
      deps(),
    );

    expect(apiPost).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(3);
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      ok: false;
      error: { code: string; recoveryCommand?: string };
    };
    expect(envelope).toMatchObject({
      ok: false,
      target: { context: 'prod' },
      error: {
        code: 'auth_admin_session_required',
        recoveryCommand: '1mcp admin login --context prod',
      },
    });
  });

  it('hard-fails runtime-backed mutation when capabilities do not support the operation', async () => {
    apiGet.mockResolvedValueOnce(
      okResponse({
        ok: true,
        cliProtocolVersion: '1',
        warnings: [],
        result: {
          runtime: { runtimeScopeId: 'scope_prod', runtimeVersion: '0.34.0' },
          supportedOperations: ['mcp.disable'],
        },
      }),
    );

    await enableCommand({ name: 'test-server', context: 'prod', json: true }, deps());

    expect(apiPost).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(4);
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      error: { code: string };
    };
    expect(envelope.error.code).toBe('capability_operation_unsupported');
  });

  it('hard-fails runtime-backed mutation when the CLI Admin protocol is incompatible', async () => {
    apiGet.mockResolvedValueOnce(
      okResponse({
        ok: true,
        cliProtocolVersion: '2',
        warnings: [],
        result: {
          runtime: { runtimeScopeId: 'scope_prod', runtimeVersion: '0.34.0' },
          supportedOperations: ['mcp.enable', 'mcp.disable'],
          mutationReadiness: { mcp: { enabled: true, operations: ['enable', 'disable'] } },
          features: { mcpEnableDisable: true },
        },
      }),
    );

    await enableCommand({ name: 'test-server', context: 'prod', json: true }, deps());

    expect(apiPost).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(4);
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      error: { code: string };
    };
    expect(envelope.error.code).toBe('protocol_incompatible');
  });

  it('clears stale local Admin Session references when runtime validation rejects them', async () => {
    apiGet.mockImplementation(async (path: string) =>
      path.endsWith('/capabilities')
        ? okResponse({
            ok: true,
            cliProtocolVersion: '1',
            warnings: [],
            result: {
              runtime: { runtimeScopeId: 'scope_prod', runtimeVersion: '0.34.0' },
              supportedOperations: ['mcp.enable', 'mcp.disable'],
              mutationReadiness: { mcp: { enabled: true, operations: ['enable', 'disable'] } },
              features: { mcpEnableDisable: true },
            },
          })
        : okResponse({
            ok: false,
            cliProtocolVersion: '1',
            warnings: [],
            error: { code: 'auth_session_revoked', message: 'Admin session was revoked', retryable: false },
          }),
    );

    await enableCommand({ name: 'test-server', context: 'prod', json: true }, deps());

    expect(runtimeTargetStore.clearAdminSessionReference).toHaveBeenCalledWith('prod', 'scope_prod');
    expect(apiPost).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(3);
  });

  it('hard-fails runtime-backed mutation when mutation readiness is unavailable', async () => {
    apiGet.mockResolvedValueOnce(
      okResponse({
        ok: true,
        cliProtocolVersion: '1',
        warnings: [],
        result: {
          runtime: { runtimeScopeId: 'scope_prod', runtimeVersion: '0.34.0' },
          supportedOperations: ['mcp.enable', 'mcp.disable'],
          mutationReadiness: { mcp: { enabled: false, status: 'locked', operations: [] } },
          features: { mcpEnableDisable: true },
        },
      }),
    );

    await enableCommand({ name: 'test-server', context: 'prod', json: true }, deps());

    expect(apiPost).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(4);
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      error: { code: string };
    };
    expect(envelope.error.code).toBe('capability_mutation_unavailable');
  });

  it('hard-fails runtime-backed mutation when coarse admin mutation availability is unavailable', async () => {
    apiGet.mockResolvedValueOnce(
      okResponse({
        ok: true,
        cliProtocolVersion: '1',
        warnings: [],
        result: {
          runtime: { runtimeScopeId: 'scope_prod', runtimeVersion: '0.34.0' },
          supportedOperations: ['mcp.enable', 'mcp.disable'],
          adminMutationsAvailable: false,
          adminMutationsUnavailableReason: 'writer_lock_unavailable',
          mutationReadiness: { mcp: { enabled: true, status: 'ready', operations: ['enable', 'disable'] } },
          features: { mcpEnableDisable: true },
        },
      }),
    );

    await enableCommand({ name: 'test-server', context: 'prod', json: true }, deps());

    expect(apiPost).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(4);
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      error: { code: string; details?: { status?: string } };
    };
    expect(envelope.error.code).toBe('capability_mutation_unavailable');
    expect(envelope.error.details?.status).toBe('writer_lock_unavailable');
  });

  it('returns operation-in-progress recovery with the same idempotency key when bounded waiting expires', async () => {
    apiPost.mockResolvedValue(
      okResponse({
        ok: false,
        cliProtocolVersion: '1',
        warnings: [],
        error: {
          code: 'operation_in_progress',
          message: 'Admin operation is still in progress',
          retryable: true,
          retryAfterMs: 1,
        },
      }),
    );

    await enableCommand(
      {
        name: 'test-server',
        context: 'prod',
        json: true,
        idempotencyKey: 'idem_retry',
        waitMs: 0,
      },
      deps(),
    );

    expect(process.exitCode).toBe(1);
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      error: { code: string; recoveryCommand?: string };
    };
    expect(envelope.error).toMatchObject({
      code: 'operation_in_progress',
      recoveryCommand: '1mcp mcp enable test-server --context prod --idempotency-key idem_retry --json',
    });
  });

  it('bounds the runtime mutation POST timeout and returns retryable recovery with the same idempotency key', async () => {
    apiPost.mockResolvedValue({ ok: false, status: 0, error: 'Request timed out after 1ms' });

    await enableCommand(
      {
        name: 'test-server',
        context: 'prod',
        json: true,
        idempotencyKey: 'idem_timeout',
        waitMs: 0,
      },
      deps(),
    );

    expect(createApiClient).toHaveBeenLastCalledWith(
      'https://prod.example.com',
      'admin_sess_remote',
      expect.objectContaining({ timeout: 1 }),
    );
    expect(process.exitCode).toBe(1);
    const envelope = JSON.parse(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')) as {
      error: { code: string; retryable: boolean; recoveryCommand?: string };
    };
    expect(envelope.error).toMatchObject({
      code: 'operation_in_progress',
      retryable: true,
      recoveryCommand: '1mcp mcp enable test-server --context prod --idempotency-key idem_timeout --json',
    });
  });

  function deps(): NonNullable<Parameters<typeof enableCommand>[1]> {
    return {
      runtimeTargetStore,
      resolveTarget,
      createApiClient,
      createIdempotencyKey: () => 'idem_generated',
      wait: vi.fn(async () => undefined),
    } as unknown as NonNullable<Parameters<typeof enableCommand>[1]>;
  }

  function okResponse(data: unknown) {
    return { ok: true, status: 200, data };
  }
});
