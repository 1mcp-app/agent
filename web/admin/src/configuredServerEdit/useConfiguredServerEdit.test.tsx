import { act, renderHook, waitFor } from '@testing-library/react';

import { AdminApiError } from '../api/adminApi';
import type {
  AdminApiClient,
  AdminSession,
  ConfiguredServerApplyResponse,
  ConfiguredServerDetailResponse,
  ConfiguredServerPreviewResponse,
} from '../api/adminApi';
import { configuredServerDetailState } from '../components/AdminConsoleApp.fixtures';
import { createConfiguredServerEditState, reduceConfiguredServerEditState } from './configuredServerEditState';
import type { ConfiguredServerEditBrowser } from './useConfiguredServerEdit';
import { useConfiguredServerEdit } from './useConfiguredServerEdit';
import { configuredServerApplyEligibility } from './useConfiguredServerEdit';

const session: AdminSession = {
  authenticated: true,
  account: { id: 'admin-1', username: 'admin', role: 'full-admin' },
  csrfToken: 'csrf-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
};

function detail(): ConfiguredServerDetailResponse {
  const state = configuredServerDetailState();
  if (state.status !== 'loaded') throw new Error('Expected loaded fixture');
  return state.detail;
}

function browser(initialPathname: string) {
  let pathname = initialPathname;
  let popstate: (() => void) | undefined;
  const adapter: ConfiguredServerEditBrowser = {
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

function api(overrides: Partial<AdminApiClient> = {}): AdminApiClient {
  return {
    getConfiguredServerDetail: vi.fn(async () => detail()),
    previewConfiguredServerEdit: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    applyConfiguredServerEdit: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    ...overrides,
  } as AdminApiClient;
}

describe('useConfiguredServerEdit', () => {
  it('loads a deep link and owns normalized preview input', async () => {
    const browserAdapter = browser('/admin/servers/github');
    const adminApi = api({
      previewConfiguredServerEdit: vi.fn(async () => ({
        ok: true,
        operationId: 'preview-op',
        preview: {
          targetName: 'github',
          proposedTargetName: 'github',
          previewFingerprint: 'preview-new',
          validation: { status: 'valid', errors: [] },
          diff: [],
          configChange: {
            status: 'preview',
            operation: 'update',
            target: { name: 'github', source: 'mcpServers' },
            changed: true,
            backup: { created: false },
            retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
            reload: { status: 'not_attempted' },
          },
          connectivityCheck: { status: 'passed', mode: 'bounded_dry_run' },
        },
      })),
    });

    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    act(() => result.current.changeField(['transport', 'url'], 'https://example.com/v2/mcp'));
    await act(() => result.current.preview('auto'));

    expect(adminApi.previewConfiguredServerEdit).toHaveBeenCalledWith({
      name: 'github',
      csrfToken: 'csrf-token',
      connectivityCheck: 'auto',
      edit: { transport: { url: 'https://example.com/v2/mcp' } },
    });
    expect(result.current.state).toMatchObject({
      status: 'loaded',
      dirty: true,
      preview: { previewFingerprint: 'preview-new' },
    });
  });

  it('ignores stale detail responses after switching targets', async () => {
    const github = deferred<ConfiguredServerDetailResponse>();
    const slack = deferred<ConfiguredServerDetailResponse>();
    const browserAdapter = browser('/admin');
    const adminApi = api({
      getConfiguredServerDetail: vi.fn((serverId: string) => (serverId === 'github' ? github.promise : slack.promise)),
    });
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );

    act(() => void result.current.open('github'));
    act(() => void result.current.open('slack'));
    slack.resolve({ ...detail(), server: { ...detail().server, id: 'slack' } });
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'loaded', serverId: 'slack' }));
    github.resolve(detail());
    await act(async () => undefined);

    expect(result.current.state).toMatchObject({ status: 'loaded', serverId: 'slack' });
  });

  it('restores the current edit URL without adding history when dirty navigation is canceled', async () => {
    const browserAdapter = browser('/admin/servers/github');
    browserAdapter.adapter.confirm = vi.fn(async () => false);
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: api(), session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );
    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    act(() => result.current.changeField(['transport', 'url'], 'https://example.com/v2/mcp'));

    act(() => browserAdapter.navigate('/admin'));

    expect(browserAdapter.adapter.replace).toHaveBeenCalledWith('/admin/servers/github');
    expect(result.current.state).toMatchObject({ status: 'loaded', serverId: 'github', dirty: true });
  });

  it('ignores an in-flight preview after the draft changes', async () => {
    const preview = deferred<ConfiguredServerPreviewResponse>();
    const adminApi = api({ previewConfiguredServerEdit: vi.fn(() => preview.promise) });
    const browserAdapter = browser('/admin/servers/github');
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );
    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    act(() => result.current.changeField(['transport', 'url'], 'https://example.com/v2/mcp'));
    act(() => void result.current.preview('auto'));
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'loaded', previewBusy: true }));

    act(() => result.current.changeField(['transport', 'url'], 'https://example.com/v3/mcp'));
    preview.resolve({
      ok: true,
      operationId: 'preview-stale',
      preview: {
        targetName: 'github',
        proposedTargetName: 'github',
        previewFingerprint: 'preview-stale',
        validation: { status: 'valid', errors: [] },
        diff: [],
        configChange: {
          status: 'preview',
          operation: 'update',
          target: { name: 'github', source: 'mcpServers' },
          changed: true,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'not_attempted' },
        },
        connectivityCheck: { status: 'passed', mode: 'bounded_dry_run' },
      },
    });
    await act(async () => undefined);

    expect(result.current.state).toMatchObject({ status: 'loaded', previewBusy: false });
    if (result.current.state.status === 'loaded') expect(result.current.state.preview).toBeUndefined();
  });

  it('resets the workflow and delegates Admin Session invalidation', async () => {
    const onUnauthenticated = vi.fn();
    const adminApi = api({
      getConfiguredServerDetail: vi.fn(async () => {
        throw new AdminApiError(401, { authenticated: false, adminStatus: 'loginRequired' }, 'Unauthorized');
      }),
    });
    const browserAdapter = browser('/admin/servers/github');
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated }),
    );

    await waitFor(() => expect(onUnauthenticated).toHaveBeenCalledWith('loginRequired'));
    expect(result.current.state).toEqual({ status: 'list' });
  });

  it('confirms and applies the latest eligible preview, then reloads a renamed target', async () => {
    const browserAdapter = browser('/admin/servers/github');
    const renamedDetail = detail();
    renamedDetail.server.id = 'github-renamed';
    renamedDetail.editContract.target.id = 'github-renamed';
    const loadedDetail = detail();
    loadedDetail.editContract.capabilities.apply.supported = true;
    const onApplied = vi.fn();
    const adminApi = api({
      getConfiguredServerDetail: vi.fn(async (serverId: string) =>
        serverId === 'github-renamed' ? renamedDetail : loadedDetail,
      ),
      previewConfiguredServerEdit: vi.fn(async () => ({
        ok: true,
        operationId: 'preview-op',
        preview: {
          targetName: 'github',
          proposedTargetName: 'github-renamed',
          previewFingerprint: 'preview-rename',
          validation: { status: 'valid', errors: [] },
          diff: [{ fieldPath: ['id'], oldValue: 'github', newValue: 'github-renamed', riskFlags: ['rename'] }],
          configChange: {
            status: 'preview',
            operation: 'update',
            target: { name: 'github', source: 'mcpServers' },
            changed: true,
            backup: { created: false },
            retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
            reload: { status: 'not_attempted' },
          },
          connectivityCheck: { status: 'skipped', reason: 'connection_critical_fields_unchanged' },
        },
      })),
      applyConfiguredServerEdit: vi.fn(async () => ({
        ok: true,
        operationId: 'apply-op',
        result: {
          originalTargetName: 'github',
          targetName: 'github-renamed',
          previewFingerprint: 'preview-rename',
          configChange: {
            status: 'applied',
            operation: 'update',
            target: { name: 'github-renamed', source: 'mcpServers' },
            changed: true,
            backup: { created: true },
            retentionCleanup: { attempted: true, deletedPaths: [], warnings: [] },
            reload: { status: 'succeeded' },
          },
        },
      })),
    });
    const { result } = renderHook(() =>
      useConfiguredServerEdit({
        api: adminApi,
        session,
        browser: browserAdapter.adapter,
        onUnauthenticated: vi.fn(),
        onApplied,
      }),
    );

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    act(() => result.current.changeField(['transport', 'url'], 'https://example.com/renamed'));
    await act(() => result.current.preview());
    expect(configuredServerApplyEligibility(result.current.state)).toEqual({ eligible: true });
    await act(() => result.current.apply());

    expect(adminApi.applyConfiguredServerEdit).toHaveBeenCalledWith({
      name: 'github',
      csrfToken: 'csrf-token',
      idempotencyKey: expect.stringMatching(/^admin-console-server-apply-/),
      edit: { transport: { url: 'https://example.com/renamed' } },
      previewFingerprint: 'preview-rename',
      confirmationFacts: {
        previewConfirmed: 'preview-rename',
        targetNameConfirmed: 'github-renamed',
      },
    });
    expect(browserAdapter.adapter.replace).toHaveBeenCalledWith('/admin/servers/github-renamed');
    expect(onApplied).toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      status: 'loaded',
      serverId: 'github-renamed',
      dirty: false,
      applySuccess: 'Changes applied to github-renamed.',
    });
  });

  it('blocks enabled remote connection-critical edits until connectivity passes', async () => {
    const loadedDetail = detail();
    loadedDetail.editContract.capabilities.apply.supported = true;
    let state = reduceConfiguredServerEditState(createConfiguredServerEditState(), {
      type: 'detailLoaded',
      serverId: 'github',
      detail: loadedDetail,
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'previewSucceeded',
      preview: {
        targetName: 'github',
        proposedTargetName: 'github',
        previewFingerprint: 'preview-blocked',
        validation: { status: 'valid', errors: [] },
        diff: [
          {
            fieldPath: ['transport', 'url'],
            oldValue: 'https://old.example/mcp',
            newValue: 'https://new.example/mcp',
            riskFlags: ['connection_critical'],
          },
        ],
        configChange: {
          status: 'preview',
          operation: 'update',
          target: { name: 'github', source: 'mcpServers' },
          changed: true,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'not_attempted' },
        },
        connectivityCheck: { status: 'failed', mode: 'bounded_dry_run', message: 'connection refused' },
      },
    });

    expect(configuredServerApplyEligibility(state)).toEqual({
      eligible: false,
      reason: 'A fresh connectivity check must pass before applying these changes.',
    });
  });

  it('reuses one idempotency key for a network retry and blocks reentrant apply confirmation', async () => {
    const browserAdapter = browser('/admin/servers/github');
    const loadedDetail = detail();
    loadedDetail.editContract.capabilities.apply.supported = true;
    const applyConfiguredServerEdit = vi
      .fn<AdminApiClient['applyConfiguredServerEdit']>()
      .mockRejectedValueOnce(
        new AdminApiError(0, {}, 'unavailable', { kind: 'unavailable', message: 'Runtime unavailable.' }),
      )
      .mockResolvedValue(applyResponse());
    const adminApi = api({
      getConfiguredServerDetail: vi.fn(async () => loadedDetail),
      previewConfiguredServerEdit: vi.fn(async () => applyPreview()),
      applyConfiguredServerEdit,
    });
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    act(() => result.current.changeField(['transport', 'url'], 'https://example.com/v2/mcp'));
    await act(() => result.current.preview());
    await act(async () => {
      await Promise.all([result.current.apply(), result.current.apply()]);
    });
    expect(applyConfiguredServerEdit).toHaveBeenCalledTimes(1);
    const firstKey = applyConfiguredServerEdit.mock.calls[0][0].idempotencyKey;

    await act(() => result.current.apply());
    expect(applyConfiguredServerEdit).toHaveBeenCalledTimes(2);
    expect(applyConfiguredServerEdit.mock.calls[1][0].idempotencyKey).toBe(firstKey);
    expect(browserAdapter.adapter.confirm).toHaveBeenCalledTimes(2);
  });

  it('ignores an in-flight apply response after switching targets', async () => {
    const browserAdapter = browser('/admin/servers/github');
    const loadedDetail = detail();
    loadedDetail.editContract.capabilities.apply.supported = true;
    const pendingApply = deferred<ConfiguredServerApplyResponse>();
    const adminApi = api({
      getConfiguredServerDetail: vi.fn(async (serverId: string) => {
        const next = detail();
        next.server.id = serverId;
        next.editContract.target.id = serverId;
        next.editContract.capabilities.apply.supported = true;
        return next;
      }),
      previewConfiguredServerEdit: vi.fn(async () => applyPreview()),
      applyConfiguredServerEdit: vi.fn(() => pendingApply.promise),
    });
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    act(() => result.current.changeField(['transport', 'url'], 'https://example.com/v2/mcp'));
    await act(() => result.current.preview());
    act(() => void result.current.apply());
    await waitFor(() => expect(adminApi.applyConfiguredServerEdit).toHaveBeenCalledTimes(1));
    await act(() => result.current.open('slack'));
    expect(result.current.state).toMatchObject({ status: 'loaded', serverId: 'slack' });

    pendingApply.resolve(applyResponse('github-renamed'));
    await act(async () => undefined);
    expect(result.current.state).toMatchObject({ status: 'loaded', serverId: 'slack' });
    expect(browserAdapter.adapter.replace).not.toHaveBeenCalledWith('/admin/servers/github-renamed');
  });
});

function applyPreview(): ConfiguredServerPreviewResponse {
  return {
    ok: true,
    operationId: 'preview-op',
    preview: {
      targetName: 'github',
      proposedTargetName: 'github',
      previewFingerprint: 'preview-retry',
      validation: { status: 'valid', errors: [] },
      diff: [
        {
          fieldPath: ['transport', 'url'],
          oldValue: 'https://example.com/mcp',
          newValue: 'https://example.com/v2/mcp',
          riskFlags: [],
        },
      ],
      configChange: {
        status: 'preview',
        operation: 'update',
        target: { name: 'github', source: 'mcpServers' },
        changed: true,
        backup: { created: false },
        retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
        reload: { status: 'not_attempted' },
      },
      connectivityCheck: { status: 'skipped', reason: 'connection_critical_fields_unchanged' },
    },
  };
}

function applyResponse(targetName = 'github') {
  return {
    ok: true as const,
    operationId: 'apply-op',
    result: {
      originalTargetName: 'github',
      targetName,
      previewFingerprint: 'preview-retry',
      configChange: {
        status: 'applied',
        operation: 'update',
        target: { name: targetName, source: 'mcpServers' },
        changed: true,
        backup: { created: true },
        retentionCleanup: { attempted: true, deletedPaths: [], warnings: [] },
        reload: { status: 'succeeded' },
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
