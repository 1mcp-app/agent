import { act, renderHook, waitFor } from '@testing-library/react';

import { AdminApiError } from '../api/adminApi';
import type {
  AdminApiClient,
  AdminSession,
  ConfiguredServerDetailResponse,
  ConfiguredServerPreviewResponse,
} from '../api/adminApi';
import { configuredServerDetailState } from '../components/AdminConsoleApp.fixtures';
import type { ConfiguredServerEditBrowser } from './useConfiguredServerEdit';
import { useConfiguredServerEdit } from './useConfiguredServerEdit';

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
    confirm: vi.fn(() => true),
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
    browserAdapter.adapter.confirm = vi.fn(() => false);
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
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
