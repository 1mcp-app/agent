import { act, renderHook, waitFor } from '@testing-library/react';

import { AdminApiError } from '../api/adminApi';
import type {
  AdminApiClient,
  AdminSession,
  ConfiguredServerApplyResponse,
  ConfiguredServerDetailResponse,
  ConfiguredServerPreviewResponse,
  ConfiguredToolInventory,
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

function detailFor(target: { source: 'mcpServers' | 'mcpTemplates'; id: string }): ConfiguredServerDetailResponse {
  const response = detail();
  response.server = {
    ...response.server,
    id: target.id,
    source: target.source,
    target: { type: 'configured_server', ...target },
  };
  response.editContract = { ...response.editContract, target: response.server.target };
  response.toolInventory = unavailableToolInventory(target);
  return response;
}

function unavailableToolInventory(
  target: { source: 'mcpServers' | 'mcpTemplates'; id: string } = { source: 'mcpServers', id: 'github' },
  model = 'gpt-4o',
): ConfiguredToolInventory {
  return {
    ...toolInventory(target, model),
    freshness: 'unavailable',
    inspection: { status: 'unavailable', reason: 'snapshot_unavailable', retryable: true, instances: [] },
  };
}

function toolInventory(
  target: { source: 'mcpServers' | 'mcpTemplates'; id: string } = { source: 'mcpServers', id: 'github' },
  model = 'gpt-4o',
): ConfiguredToolInventory {
  return {
    targetName: target.id,
    source: target.source,
    targetEnabled: true,
    freshness: 'live',
    model,
    generation: 'generation-1',
    activeInstanceCount: 1,
    inspection: { status: 'complete', retryable: false, instances: [{ instanceId: target.id, status: 'complete' }] },
    rows: [],
    counts: { observed: 0, enabled: 0, disabled: 0, unresolved: 0 },
    approximateTokens: { enabled: 0, allObserved: 0, savings: 0 },
  };
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
    refreshConfiguredToolInventory: vi.fn(async ({ target, model }) => ({
      ok: true,
      operationId: 'refresh-op',
      toolInventory: toolInventory(target, model),
    })),
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
  it('previews a template instruction override through the source-qualified editor', async () => {
    const templateDetail = {
      ...detail(),
      server: {
        ...detail().server,
        id: 'shared',
        source: 'mcpTemplates' as const,
        target: { type: 'configured_server' as const, source: 'mcpTemplates' as const, id: 'shared' },
        revision: 'configured_server_1',
        instructionOverride: { state: 'upstream' as const },
      },
      editContract: {
        ...detail().editContract,
        capabilities: {
          ...detail().editContract.capabilities,
          apply: { supported: true },
        },
      },
    };
    const adminApi = api({
      getConfiguredServerDetail: vi.fn(async () => templateDetail),
      previewConfiguredServerEdit: vi.fn(async () => ({
        ...applyPreview(),
        preview: {
          ...applyPreview().preview,
          diff: [{ fieldPath: ['instructionOverride'], oldValue: 'upstream', newValue: 'suppress', riskFlags: [] }],
          configChange: {
            ...applyPreview().preview.configChange,
            target: { name: 'shared', source: 'mcpTemplates' as const },
          },
        },
      })),
      applyConfiguredServerEdit: vi.fn(async () => applyResponse('shared')),
    });
    const browserAdapter = browser('/admin');
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );

    await act(() => result.current.open({ source: 'mcpTemplates', id: 'shared' }));
    expect(adminApi.getConfiguredServerDetail).toHaveBeenCalledWith({ source: 'mcpTemplates', id: 'shared' });
    expect(browserAdapter.adapter.push).toHaveBeenCalledWith('/admin/servers/mcpTemplates/shared');

    act(() => result.current.changeInstructionOverride('suppress'));
    expect(result.current.state).toMatchObject({ status: 'loaded', dirty: true, preview: undefined });
    await act(() => result.current.preview());
    expect(adminApi.previewConfiguredServerEdit).toHaveBeenCalledWith({
      target: { source: 'mcpTemplates', id: 'shared' },
      csrfToken: 'csrf-token',
      connectivityCheck: 'auto',
      edit: { instructionOverride: { action: 'set', value: '' } },
    });

    await act(() => result.current.apply());
    expect(browserAdapter.adapter.confirm).toHaveBeenCalledOnce();
    expect(adminApi.applyConfiguredServerEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { source: 'mcpTemplates', id: 'shared' },
        edit: { instructionOverride: { action: 'set', value: '' } },
        previewFingerprint: 'preview-retry',
      }),
    );
  });

  it('does not load the reserved create route after decoding its path segment', async () => {
    const adminApi = api();
    const browserAdapter = browser('/admin/servers/%6E%65%77');
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );

    await waitFor(() => expect(result.current.state).toEqual({ status: 'list' }));
    expect(adminApi.getConfiguredServerDetail).not.toHaveBeenCalled();
  });

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
      target: { source: 'mcpServers', id: 'github' },
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

  it('starts one active refresh, suppresses overlaps, and allows retry after failure', async () => {
    const pending = deferred<Awaited<ReturnType<AdminApiClient['refreshConfiguredToolInventory']>>>();
    const refreshConfiguredToolInventory = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue({
        ok: true,
        operationId: 'refresh-retry',
        toolInventory: toolInventory(),
      });
    const unavailableDetail = detail();
    unavailableDetail.toolInventory = unavailableToolInventory();
    const adminApi = api({
      getConfiguredServerDetail: vi.fn(async () => unavailableDetail),
      refreshConfiguredToolInventory,
    });
    const browserAdapter = browser('/admin/servers/github');
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );
    await waitFor(() => expect(refreshConfiguredToolInventory).toHaveBeenCalledOnce());
    expect(result.current.state).toMatchObject({ status: 'loaded', toolInventoryBusy: true });

    act(() => void result.current.refreshToolInventory?.());
    act(() => void result.current.refreshToolInventory?.());
    expect(refreshConfiguredToolInventory).toHaveBeenCalledOnce();

    pending.reject(new AdminApiError(503, { error: 'inspection_unavailable' }, 'inspection unavailable'));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: 'loaded',
        toolInventoryBusy: false,
        toolInventoryError: expect.stringContaining('Tool refresh failed:'),
      }),
    );

    await act(() => result.current.refreshToolInventory?.());
    expect(refreshConfiguredToolInventory).toHaveBeenCalledTimes(2);
    expect(result.current.state).toMatchObject({ status: 'loaded', toolInventoryBusy: false });
  });

  it('does not actively refresh when passive inventory is already live', async () => {
    const liveDetail = detail();
    liveDetail.toolInventory = toolInventory();
    const adminApi = api({ getConfiguredServerDetail: vi.fn(async () => liveDetail) });
    const browserAdapter = browser('/admin/servers/github');

    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    expect(adminApi.refreshConfiguredToolInventory).not.toHaveBeenCalled();
  });

  it('blocks preview and apply while an inventory refresh owns the request lane', async () => {
    const pendingRefresh = deferred<Awaited<ReturnType<AdminApiClient['refreshConfiguredToolInventory']>>>();
    const refreshConfiguredToolInventory = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, operationId: 'refresh-initial', toolInventory: toolInventory() })
      .mockImplementationOnce(() => pendingRefresh.promise);
    const previewConfiguredServerEdit = vi.fn(async () => applyPreview());
    const applyConfiguredServerEdit = vi.fn(async () => applyResponse());
    const unavailableDetail = detail();
    unavailableDetail.toolInventory = unavailableToolInventory();
    const adminApi = api({
      getConfiguredServerDetail: vi.fn(async () => unavailableDetail),
      refreshConfiguredToolInventory,
      previewConfiguredServerEdit,
      applyConfiguredServerEdit,
    });
    const browserAdapter = browser('/admin/servers/github');
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'loaded', toolInventoryBusy: false }));
    act(() => result.current.changeField(['transport', 'url'], 'https://example.com/v2/mcp'));
    await act(() => result.current.preview());
    expect(previewConfiguredServerEdit).toHaveBeenCalledOnce();

    act(() => void result.current.refreshToolInventory?.());
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'loaded', toolInventoryBusy: true }));
    await act(() => result.current.preview());
    await act(() => result.current.apply());

    expect(previewConfiguredServerEdit).toHaveBeenCalledOnce();
    expect(applyConfiguredServerEdit).not.toHaveBeenCalled();
    expect(browserAdapter.adapter.confirm).not.toHaveBeenCalled();
    pendingRefresh.resolve({ ok: true, operationId: 'refresh-manual', toolInventory: toolInventory() });
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'loaded', toolInventoryBusy: false }));
  });

  it('ignores a stale inventory refresh after switching source-qualified targets', async () => {
    const githubRefresh = deferred<Awaited<ReturnType<AdminApiClient['refreshConfiguredToolInventory']>>>();
    const refreshConfiguredToolInventory = vi.fn(({ target }: { target: { source: 'mcpServers'; id: string } }) =>
      target.id === 'github'
        ? githubRefresh.promise
        : Promise.resolve({
            ok: true as const,
            operationId: 'refresh-slack',
            toolInventory: { ...toolInventory(target), generation: 'generation-slack' },
          }),
    );
    const adminApi = api({
      getConfiguredServerDetail: vi.fn((target: string | { source: 'mcpServers'; id: string }) => {
        const identity = typeof target === 'string' ? { source: 'mcpServers' as const, id: target } : target;
        return Promise.resolve(detailFor(identity));
      }),
      refreshConfiguredToolInventory:
        refreshConfiguredToolInventory as AdminApiClient['refreshConfiguredToolInventory'],
    });
    const browserAdapter = browser('/admin/servers/github');
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );
    await waitFor(() => expect(refreshConfiguredToolInventory).toHaveBeenCalledOnce());

    await act(() => result.current.open('slack'));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: 'loaded',
        serverId: 'slack',
        detail: { toolInventory: { generation: 'generation-slack' } },
      }),
    );
    githubRefresh.resolve({
      ok: true,
      operationId: 'refresh-github-stale',
      toolInventory: { ...toolInventory(), generation: 'generation-github-stale' },
    });
    await act(async () => undefined);

    expect(result.current.state).toMatchObject({
      status: 'loaded',
      serverId: 'slack',
      detail: { toolInventory: { generation: 'generation-slack' } },
    });
  });

  it('ignores a stale inventory refresh after the Admin session changes', async () => {
    const firstRefresh = deferred<Awaited<ReturnType<AdminApiClient['refreshConfiguredToolInventory']>>>();
    const refreshConfiguredToolInventory = vi.fn(({ csrfToken }: { csrfToken: string }) =>
      csrfToken === 'csrf-token'
        ? firstRefresh.promise
        : Promise.resolve({
            ok: true as const,
            operationId: 'refresh-new-session',
            toolInventory: { ...toolInventory(), generation: 'generation-new-session' },
          }),
    );
    const unavailableDetail = detail();
    unavailableDetail.toolInventory = unavailableToolInventory();
    const adminApi = api({
      getConfiguredServerDetail: vi.fn(async () => unavailableDetail),
      refreshConfiguredToolInventory:
        refreshConfiguredToolInventory as AdminApiClient['refreshConfiguredToolInventory'],
    });
    const browserAdapter = browser('/admin/servers/github');
    const nextSession = { ...session, csrfToken: 'csrf-next' };
    const { result, rerender } = renderHook(
      ({ activeSession }: { activeSession: AdminSession }) =>
        useConfiguredServerEdit({
          api: adminApi,
          session: activeSession,
          browser: browserAdapter.adapter,
          onUnauthenticated: vi.fn(),
        }),
      { initialProps: { activeSession: session } },
    );
    await waitFor(() => expect(refreshConfiguredToolInventory).toHaveBeenCalledOnce());

    rerender({ activeSession: nextSession });
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: 'loaded',
        detail: { toolInventory: { generation: 'generation-new-session' } },
      }),
    );
    firstRefresh.resolve({
      ok: true,
      operationId: 'refresh-old-session',
      toolInventory: { ...toolInventory(), generation: 'generation-old-session' },
    });
    await act(async () => undefined);

    expect(result.current.state).toMatchObject({
      status: 'loaded',
      detail: { toolInventory: { generation: 'generation-new-session' } },
    });
  });

  it('recalculates token models passively without starting another active refresh', async () => {
    const initial = detail();
    initial.toolInventory = toolInventory();
    const withModel = (model: string): ConfiguredServerDetailResponse => ({
      ...initial,
      toolInventory: { ...initial.toolInventory!, model },
    });
    const adminApi = api({
      getConfiguredServerDetail: vi.fn((_serverId, model?: string) =>
        Promise.resolve(model ? withModel(model) : initial),
      ),
    });
    const browserAdapter = browser('/admin/servers/github');
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'loaded', toolInventoryBusy: false }));

    await act(() => result.current.changeToolModel('gpt-4o-mini'));

    expect(adminApi.getConfiguredServerDetail).toHaveBeenLastCalledWith(
      { source: 'mcpServers', id: 'github' },
      'gpt-4o-mini',
    );
    expect(adminApi.refreshConfiguredToolInventory).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ status: 'loaded', toolModel: 'gpt-4o-mini' });
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
      target: { source: 'mcpServers', id: 'github' },
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

  it('allows enabled remote connection-critical edits to override a failed check', async () => {
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

    expect(configuredServerApplyEligibility(state)).toEqual({ eligible: true });
  });

  it('uses a danger confirmation and sends the failed-connectivity override fact', async () => {
    const browserAdapter = browser('/admin/servers/github');
    const loadedDetail = detail();
    loadedDetail.editContract.capabilities.apply.supported = true;
    const failedPreview = applyPreview();
    failedPreview.preview.diff[0].riskFlags = ['connection_critical'];
    failedPreview.preview.connectivityCheck = {
      status: 'failed',
      mode: 'bounded_dry_run',
      message: 'connection refused',
    };
    const adminApi = api({
      getConfiguredServerDetail: vi.fn(async () => loadedDetail),
      previewConfiguredServerEdit: vi.fn(async () => failedPreview),
      applyConfiguredServerEdit: vi.fn(async () => applyResponse()),
    });
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    act(() => result.current.changeField(['transport', 'url'], 'https://example.com/v2/mcp'));
    await act(() => result.current.preview());
    await act(() => result.current.apply());

    expect(browserAdapter.adapter.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'danger', confirmLabel: 'Apply despite failure' }),
    );
    expect(adminApi.applyConfiguredServerEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationFacts: expect.objectContaining({
          connectionCriticalConfirmed: true,
          connectivityFailureOverrideConfirmed: true,
        }),
      }),
    );
  });

  it('requires a danger confirmation and sends the zero-tool confirmation fact', async () => {
    const browserAdapter = browser('/admin/servers/github');
    const loadedDetail = detail();
    loadedDetail.editContract.capabilities.apply.supported = true;
    loadedDetail.toolInventory = {
      targetName: 'github',
      source: 'mcpServers',
      targetEnabled: true,
      freshness: 'live',
      model: 'gpt-4o',
      generation: 'generation-1',
      activeInstanceCount: 1,
      rows: [
        {
          name: 'search',
          effectiveDescription: 'Search',
          descriptionOverridden: false,
          enabled: true,
          observed: true,
          unresolved: false,
          observedInstanceCount: 1,
          activeInstanceCount: 1,
          observedInSomeInstances: false,
          approximateTokens: 25,
        },
      ],
      counts: { observed: 1, enabled: 1, disabled: 0, unresolved: 0 },
      approximateTokens: { enabled: 25, allObserved: 25, savings: 0 },
    };
    const zeroPreview = applyPreview();
    zeroPreview.preview.toolSelection = {
      capabilityGeneration: 'generation-1',
      model: 'gpt-4o',
      targetEnabled: true,
      changedTools: ['search'],
      counts: { observed: 1, enabled: 0, disabled: 1, unresolved: 0 },
      approximateTokens: { before: 25, after: 0, savings: 25 },
      effect: 'immediate',
      requiresZeroEnabledConfirmation: true,
    };
    const adminApi = api({
      getConfiguredServerDetail: vi.fn(async () => loadedDetail),
      previewConfiguredServerEdit: vi.fn(async () => zeroPreview),
      applyConfiguredServerEdit: vi.fn(async () => applyResponse()),
    });
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    act(() => result.current.changeTool('search', { enabled: false }));
    await act(() => result.current.preview());
    await act(() => result.current.apply());

    expect(browserAdapter.adapter.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'danger', confirmLabel: 'Disable all tools' }),
    );
    expect(adminApi.applyConfiguredServerEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        confirmationFacts: expect.objectContaining({ zeroEnabledToolsConfirmed: true }),
      }),
    );
  });

  it('blocks token model changes while apply confirmation is active', async () => {
    const browserAdapter = browser('/admin/servers/github');
    const confirmation = deferred<boolean>();
    browserAdapter.adapter.confirm = vi.fn(() => confirmation.promise);
    const loadedDetail = detail();
    loadedDetail.editContract.capabilities.apply.supported = true;
    loadedDetail.toolInventory = toolInventory();
    const getConfiguredServerDetail = vi.fn(async () => loadedDetail);
    const adminApi = api({
      getConfiguredServerDetail,
      previewConfiguredServerEdit: vi.fn(async () => applyPreview()),
      applyConfiguredServerEdit: vi.fn(async () => applyResponse()),
    });
    const { result } = renderHook(() =>
      useConfiguredServerEdit({ api: adminApi, session, browser: browserAdapter.adapter, onUnauthenticated: vi.fn() }),
    );

    await waitFor(() => expect(result.current.state.status).toBe('loaded'));
    act(() => result.current.changeField(['transport', 'url'], 'https://example.com/v2/mcp'));
    await act(() => result.current.preview());
    let applyPromise!: Promise<void>;
    act(() => {
      applyPromise = result.current.apply();
    });
    await waitFor(() => expect(browserAdapter.adapter.confirm).toHaveBeenCalledOnce());

    await act(() => result.current.changeToolModel('gpt-4o-mini'));

    expect(getConfiguredServerDetail).toHaveBeenCalledOnce();
    confirmation.resolve(false);
    await act(() => applyPromise);
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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
