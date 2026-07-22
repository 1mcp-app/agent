import { RuntimeTargetStore } from '@src/domains/runtime-targets/runtimeTargetStore.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { restartCommand } from './restart.js';

const { printerMock } = vi.hoisted(() => ({
  printerMock: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@src/utils/ui/printer.js', () => ({ default: printerMock }));

describe('restartCommand', () => {
  const apiGet = vi.fn();
  const apiPost = vi.fn();
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('posts a selected instance to the authenticated runtime admin adapter', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path.endsWith('/capabilities')) {
        return okResponse({
          runtime: { runtimeScopeId: 'scope_123' },
          supportedOperations: ['mcp.restart'],
          adminMutationsAvailable: true,
          mutationReadiness: { mcp: { enabled: true, operations: ['restart'] } },
        });
      }
      return okResponse({ authenticated: true });
    });
    apiPost.mockResolvedValue(
      okResponse({ targetName: 'github', targetType: 'template', restartedInstanceIds: ['abcdef0123456789'] }),
    );

    await restartCommand(
      { name: 'github', context: 'prod', instance: 'abcdef012345', json: true, idempotencyKey: 'idem_restart' },
      dependencies(),
    );

    expect(apiPost).toHaveBeenCalledWith(
      '/admin/cli/v1/operations/restart-server',
      {
        targetName: 'github',
        instance: 'abcdef012345',
        confirmationFacts: {},
      },
      { headers: { 'Idempotency-Key': 'idem_restart' }, timeout: expect.any(Number) },
    );
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({
      ok: true,
      operation: 'mcp.restart',
      result: { restartedInstanceIds: ['abcdef0123456789'] },
    });
  });

  it('rejects --instance together with --all-instances before contacting a runtime', async () => {
    await restartCommand(
      { name: 'github', context: 'prod', instance: 'abcdef', allInstances: true, json: true },
      dependencies(),
    );

    expect(apiGet).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({
      ok: false,
      error: { code: 'restart_selector_conflict' },
    });
  });

  it('retries an in-progress restart with the same idempotency key', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path.endsWith('/capabilities')) {
        return okResponse({
          runtime: { runtimeScopeId: 'scope_123' },
          supportedOperations: ['mcp.restart'],
          adminMutationsAvailable: true,
          mutationReadiness: { mcp: { enabled: true, operations: ['restart'] } },
        });
      }
      return okResponse({ authenticated: true });
    });
    apiPost
      .mockResolvedValueOnce({
        ok: true,
        status: 409,
        data: {
          ok: false,
          cliProtocolVersion: '1',
          error: { code: 'operation_in_progress', message: 'Restart is in progress', retryAfterMs: 1 },
        },
      })
      .mockResolvedValueOnce(okResponse({ targetName: 'filesystem', targetType: 'static', restartedInstanceIds: [] }));
    const deps = dependencies();

    await restartCommand(
      { name: 'filesystem', context: 'prod', json: true, idempotencyKey: 'idem_restart', waitMs: 100 },
      deps,
    );

    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(apiPost.mock.calls[0]?.[2]).toMatchObject({ headers: { 'Idempotency-Key': 'idem_restart' } });
    expect(apiPost.mock.calls[1]?.[2]).toMatchObject({ headers: { 'Idempotency-Key': 'idem_restart' } });
    expect(deps.wait).toHaveBeenCalledWith(1);
  });

  it('prints candidate short IDs when an instance prefix is ambiguous', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path.endsWith('/capabilities')) {
        return okResponse({
          runtime: { runtimeScopeId: 'scope_123' },
          supportedOperations: ['mcp.restart'],
          adminMutationsAvailable: true,
          mutationReadiness: { mcp: { enabled: true, operations: ['restart'] } },
        });
      }
      return okResponse({ authenticated: true });
    });
    apiPost.mockResolvedValue({
      ok: true,
      status: 409,
      data: {
        ok: false,
        error: {
          code: 'backend_instance_ambiguous',
          message: 'Backend instance prefix is ambiguous',
          details: { candidateInstanceIds: ['abcdef012345', 'abcdef999999'] },
        },
      },
    });

    await restartCommand({ name: 'github', context: 'prod', instance: 'abcdef' }, dependencies());

    expect(printerMock.info).toHaveBeenCalledWith('Candidate instance IDs: abcdef012345, abcdef999999');
    expect(process.exitCode).toBe(1);
  });

  function dependencies() {
    return {
      runtimeTargetStore: {
        current: vi.fn(() => ({ name: 'prod', kind: 'remote' as const })),
        inspect: vi.fn(() => ({ name: 'prod', kind: 'remote' as const })),
        getAdminSessionReference: vi.fn(() => ({ sessionToken: 'admin-session' })),
        setAdminSessionReference: vi.fn(),
        clearAdminSessionReference: vi.fn(),
      } as unknown as RuntimeTargetStore,
      resolveTarget: vi.fn(async (options) => ({
        options,
        discoveredUrl: 'https://runtime.example.com/mcp',
        runtimeTargetContext: { name: 'prod', kind: 'remote' as const },
      })),
      createApiClient: vi.fn(() => ({ get: apiGet, post: apiPost })),
      createIdempotencyKey: () => 'generated-key',
      wait: vi.fn(async () => undefined),
    };
  }
});

function okResponse<T>(result: T) {
  return {
    ok: true,
    status: 200,
    data: {
      ok: true,
      cliProtocolVersion: '1',
      requestId: 'req_1',
      warnings: [],
      result,
    },
  };
}
