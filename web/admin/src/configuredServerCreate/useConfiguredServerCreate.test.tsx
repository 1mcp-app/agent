import { act, renderHook, waitFor } from '@testing-library/react';

import { AdminApiError } from '../api/adminApi';
import type { AdminApiClient, AdminSession, ConfiguredServerCreatePreviewResponse } from '../api/adminApi';
import { configuredServerCreateContract } from './configuredServerCreate.fixtures';
import type { ConfiguredServerCreateBrowser } from './useConfiguredServerCreate';
import { useConfiguredServerCreate } from './useConfiguredServerCreate';

const session: AdminSession = {
  authenticated: true,
  account: { id: 'admin-1', username: 'admin', role: 'full-admin' },
  csrfToken: 'csrf-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
};

function browser(initialPathname = '/admin/servers') {
  let pathname = initialPathname;
  let popstate: (() => void) | undefined;
  const adapter: ConfiguredServerCreateBrowser = {
    pathname: () => pathname,
    push: vi.fn((next) => {
      pathname = next;
    }),
    replace: vi.fn((next) => {
      pathname = next;
    }),
    confirm: vi.fn(async () => true),
    subscribePopState: vi.fn((listener) => {
      popstate = listener;
      return () => {
        popstate = undefined;
      };
    }),
  };
  return {
    adapter,
    navigate(next: string) {
      pathname = next;
      popstate?.();
    },
  };
}

function preview(
  fingerprint = 'preview-1',
  connectivityCheck: ConfiguredServerCreatePreviewResponse['preview']['connectivityCheck'] = {
    status: 'skipped',
    reason: 'local_stdio_transport',
  },
): ConfiguredServerCreatePreviewResponse {
  return {
    ok: true,
    operationId: 'preview-op',
    preview: {
      targetName: 'custom',
      proposedTargetName: 'custom',
      previewFingerprint: fingerprint,
      validation: { status: 'valid', errors: [] },
      diff: [
        {
          fieldPath: ['transport', 'command'],
          oldValue: undefined,
          newValue: 'node',
          riskFlags: ['connection_critical'],
        },
      ],
      configChange: {
        status: 'preview',
        operation: 'create_static',
        target: { name: 'custom', source: 'mcpServers' },
        changed: true,
        backup: { created: false },
        retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
        reload: { status: 'not_attempted' },
      },
      connectivityCheck,
      expectedReload: {
        policy: 'observe_after_write',
        possibleStatuses: ['observed', 'runtime_not_running', 'reload_disabled', 'failed'],
      },
    },
  };
}

function api(overrides: Partial<AdminApiClient> = {}): AdminApiClient {
  return {
    getConfiguredServerCreateContract: vi.fn(async () => configuredServerCreateContract()),
    previewConfiguredServerCreate: vi.fn(async () => preview()),
    createConfiguredServer: vi.fn(async () => ({
      ok: true,
      operationId: 'apply-op',
      result: {
        targetName: 'custom',
        previewFingerprint: 'preview-1',
        configChange: {
          status: 'changed',
          operation: 'create_static',
          target: { name: 'custom', source: 'mcpServers' },
          changed: true,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'observed' },
        },
      },
    })),
    ...overrides,
  } as AdminApiClient;
}

describe('useConfiguredServerCreate', () => {
  it('loads the contract and previews the active transport draft', async () => {
    const adminApi = api();
    const browserAdapter = browser();
    const { result } = renderHook(() =>
      useConfiguredServerCreate({
        api: adminApi,
        session,
        browser: browserAdapter.adapter,
        onUnauthenticated: vi.fn(),
      }),
    );

    await act(() => result.current.open());
    await waitFor(() => expect(result.current.state.status).toBe('editing'));
    act(() => result.current.changeField(['name'], 'custom'));
    act(() => result.current.changeField(['transport', 'command'], 'node'));
    await act(() => result.current.preview('auto'));

    expect(browserAdapter.adapter.push).toHaveBeenCalledWith('/admin/servers/new');
    expect(adminApi.previewConfiguredServerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        csrfToken: 'csrf-token',
        connectivityCheck: 'auto',
        draft: expect.objectContaining({
          name: 'custom',
          transport: expect.objectContaining({ type: 'stdio', command: 'node' }),
        }),
      }),
    );
  });

  it('keeps a dirty draft when reopening creation is not confirmed', async () => {
    const adminApi = api();
    const browserAdapter = browser('/admin/servers/new');
    browserAdapter.adapter.confirm = vi.fn(async () => false);
    const { result } = renderHook(() =>
      useConfiguredServerCreate({
        api: adminApi,
        session,
        browser: browserAdapter.adapter,
        onUnauthenticated: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.state.status).toBe('editing'));
    act(() => result.current.changeField(['name'], 'keep-me'));

    await act(() => result.current.open());

    expect(browserAdapter.adapter.confirm).toHaveBeenCalledOnce();
    expect(browserAdapter.adapter.push).not.toHaveBeenCalled();
    expect(adminApi.getConfiguredServerCreateContract).toHaveBeenCalledOnce();
    expect(result.current.state).toMatchObject({ status: 'editing', fieldDraft: { name: 'keep-me' } });
  });

  it('allows an enabled remote create when the connectivity checker is unavailable', async () => {
    const create = vi.fn(async () => api().createConfiguredServer({} as never));
    const adminApi = api({
      previewConfiguredServerCreate: vi.fn(async () =>
        preview('preview-unchecked', { status: 'skipped', reason: 'checker_unavailable' }),
      ),
      createConfiguredServer: create,
    });
    const browserAdapter = browser('/admin/servers/new');
    const { result } = renderHook(() =>
      useConfiguredServerCreate({
        api: adminApi,
        session,
        browser: browserAdapter.adapter,
        onUnauthenticated: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.state.status).toBe('editing'));
    act(() => result.current.changeField(['name'], 'remote'));
    act(() => result.current.changeField(['transport', 'type'], 'http'));
    act(() => result.current.changeField(['transport', 'url'], 'https://mcp.example'));
    await act(() => result.current.preview('auto'));
    await act(() => result.current.apply());

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationFacts: expect.not.objectContaining({ connectivityFailureOverrideConfirmed: true }),
      }),
    );
  });

  it('confirms once, applies the preview, refreshes inventory, and opens the created detail', async () => {
    const adminApi = api();
    const browserAdapter = browser('/admin/servers/new');
    const onCreated = vi.fn(async () => undefined);
    const onOpenCreated = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useConfiguredServerCreate({
        api: adminApi,
        session,
        browser: browserAdapter.adapter,
        onUnauthenticated: vi.fn(),
        onCreated,
        onOpenCreated,
      }),
    );
    await waitFor(() => expect(result.current.state.status).toBe('editing'));
    act(() => result.current.changeField(['name'], 'custom'));
    act(() => result.current.changeField(['transport', 'command'], 'node'));
    await act(() => result.current.preview('auto'));
    await act(() => Promise.all([result.current.apply(), result.current.apply()]));

    expect(browserAdapter.adapter.confirm).toHaveBeenCalledOnce();
    expect(adminApi.createConfiguredServer).toHaveBeenCalledOnce();
    expect(adminApi.createConfiguredServer).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationFacts: expect.objectContaining({ connectionCriticalConfirmed: true }),
      }),
    );
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onOpenCreated).toHaveBeenCalledWith({ source: 'mcpServers', id: 'custom' });
  });

  it('invalidates an in-flight preview when the draft changes', async () => {
    let resolvePreview!: (value: ConfiguredServerCreatePreviewResponse) => void;
    const pending = new Promise<ConfiguredServerCreatePreviewResponse>((resolve) => {
      resolvePreview = resolve;
    });
    const browserAdapter = browser('/admin/servers/new');
    const { result } = renderHook(() =>
      useConfiguredServerCreate({
        api: api({ previewConfiguredServerCreate: vi.fn(() => pending) }),
        session,
        browser: browserAdapter.adapter,
        onUnauthenticated: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.state.status).toBe('editing'));
    act(() => result.current.changeField(['name'], 'first'));
    act(() => void result.current.preview('auto'));
    act(() => result.current.changeField(['name'], 'second'));
    resolvePreview(preview('stale'));
    await act(async () => undefined);

    expect(result.current.state).toMatchObject({ status: 'editing', preview: undefined });
  });

  it('ignores an in-flight apply after confirmed Back navigation', async () => {
    let resolveCreate!: (value: Awaited<ReturnType<AdminApiClient['createConfiguredServer']>>) => void;
    const pending = new Promise<Awaited<ReturnType<AdminApiClient['createConfiguredServer']>>>((resolve) => {
      resolveCreate = resolve;
    });
    const create = vi.fn(() => pending);
    const browserAdapter = browser('/admin/servers/new');
    const onCreated = vi.fn(async () => undefined);
    const onOpenCreated = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useConfiguredServerCreate({
        api: api({ createConfiguredServer: create }),
        session,
        browser: browserAdapter.adapter,
        onUnauthenticated: vi.fn(),
        onCreated,
        onOpenCreated,
      }),
    );
    await waitFor(() => expect(result.current.state.status).toBe('editing'));
    act(() => result.current.changeField(['name'], 'custom'));
    act(() => result.current.changeField(['transport', 'command'], 'node'));
    await act(() => result.current.preview('auto'));

    let applyPromise: void | Promise<void>;
    act(() => {
      applyPromise = result.current.apply();
    });
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    act(() => browserAdapter.navigate('/admin/servers'));
    await waitFor(() => expect(result.current.state).toEqual({ status: 'idle' }));

    resolveCreate({
      ok: true,
      operationId: 'apply-op',
      result: {
        targetName: 'custom',
        previewFingerprint: 'preview-1',
        configChange: {
          status: 'changed',
          operation: 'create_static',
          target: { name: 'custom', source: 'mcpServers' },
          changed: true,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'observed' },
        },
      },
    });
    await act(async () => applyPromise);

    expect(result.current.state).toEqual({ status: 'idle' });
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenCreated).not.toHaveBeenCalled();
  });

  it('keeps inline secret material out of browser persistence and clears it on session loss', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const browserAdapter = browser('/admin/servers/new');
    const { result, rerender } = renderHook(
      ({ activeSession }) =>
        useConfiguredServerCreate({
          api: api(),
          session: activeSession,
          browser: browserAdapter.adapter,
          onUnauthenticated: vi.fn(),
        }),
      { initialProps: { activeSession: session as AdminSession | null } },
    );
    await waitFor(() => expect(result.current.state.status).toBe('editing'));
    act(() =>
      result.current.addSecret({
        id: 'inline',
        container: 'env',
        key: 'API_TOKEN',
        replacementKind: 'inlineSecret',
        replacementValue: 'sentinel-secret',
      }),
    );

    expect(JSON.stringify(browserAdapter.adapter.push.mock.calls)).not.toContain('sentinel-secret');
    expect(JSON.stringify(browserAdapter.adapter.replace.mock.calls)).not.toContain('sentinel-secret');
    expect(setItem).not.toHaveBeenCalled();
    rerender({ activeSession: null });
    await waitFor(() => expect(result.current.state).toEqual({ status: 'idle' }));
    setItem.mockRestore();
  });

  it('reuses the idempotency key when a confirmed apply is retried', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new AdminApiError(503, { code: 'runtime_unavailable' }, 'runtime_unavailable'))
      .mockResolvedValueOnce({
        ok: true,
        operationId: 'apply-op',
        result: {
          targetName: 'custom',
          previewFingerprint: 'preview-1',
          configChange: {
            status: 'changed',
            operation: 'create_static',
            target: { name: 'custom', source: 'mcpServers' },
            changed: true,
            backup: { created: false },
            retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
            reload: { status: 'observed' },
          },
        },
      });
    const browserAdapter = browser('/admin/servers/new');
    const { result } = renderHook(() =>
      useConfiguredServerCreate({
        api: api({ createConfiguredServer: create }),
        session,
        browser: browserAdapter.adapter,
        onUnauthenticated: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.state.status).toBe('editing'));
    act(() => result.current.changeField(['name'], 'custom'));
    act(() => result.current.changeField(['transport', 'command'], 'node'));
    await act(() => result.current.preview('auto'));
    await act(() => result.current.apply());
    await act(() => result.current.apply());

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].idempotencyKey).toBe(create.mock.calls[1][0].idempotencyKey);
  });

  it('keeps a truthful reload failure visible after the target was created', async () => {
    const create = vi.fn(async () => ({
      ok: true as const,
      operationId: 'apply-op',
      result: {
        targetName: 'custom',
        previewFingerprint: 'preview-1',
        configChange: {
          status: 'changed' as const,
          operation: 'create_static' as const,
          target: { name: 'custom', source: 'mcpServers' as const },
          changed: true,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'failed' as const, error: 'reload observation timed out' },
        },
      },
    }));
    const onCreated = vi.fn(async () => undefined);
    const onOpenCreated = vi.fn(async () => undefined);
    const browserAdapter = browser('/admin/servers/new');
    const { result } = renderHook(() =>
      useConfiguredServerCreate({
        api: api({ createConfiguredServer: create }),
        session,
        browser: browserAdapter.adapter,
        onUnauthenticated: vi.fn(),
        onCreated,
        onOpenCreated,
      }),
    );
    await waitFor(() => expect(result.current.state.status).toBe('editing'));
    act(() => result.current.changeField(['name'], 'custom'));
    act(() => result.current.changeField(['transport', 'command'], 'node'));
    await act(() => result.current.preview('auto'));
    await act(() => result.current.apply());

    expect(result.current.state).toMatchObject({
      status: 'committed',
      serverId: 'custom',
      warning: 'reload observation timed out',
    });
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onOpenCreated).toHaveBeenCalledWith({ source: 'mcpServers', id: 'custom' });
  });
});
