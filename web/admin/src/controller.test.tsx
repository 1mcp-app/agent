import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AdminApiError } from './api/adminApi';
import type { AdminApiClient } from './api/adminApi';
import { AdminConsoleRoot } from './session/AdminConsoleSession';

const session = {
  authenticated: true,
  account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
  csrfToken: 'csrf_123',
  expiresAt: '2026-07-07T01:00:00.000Z',
} as const;

const status = {
  ok: true,
  runtime: {
    identityProtocolVersion: '1',
    runtimeScopeId: 'scope_123',
    runtimeVersion: '1.2.3',
  },
  session: {
    authenticated: true,
    account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
    expiresAt: '2026-07-07T01:00:00.000Z',
  },
  oauth: { status: 'ready', services: [] },
  audit: { facts: [] },
} as const;

describe('AdminConsoleRoot', () => {
  it('loads the session, refreshes read models, mutates servers with CSRF, and logs out', async () => {
    const user = userEvent.setup();
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [
        {
          id: 'filesystem',
          source: 'mcpServers' as const,
          enabled: true,
          transport: { type: 'stdio' },
          secretInputs: [],
        },
      ]),
      setConfiguredServerEnabled: vi.fn(async () => ({ ok: true })),
      logout: vi.fn(async () => ({ ok: true })),
    });

    renderRoot(api);

    expect(await screen.findByRole('heading', { name: /runtime operations/i })).toBeInTheDocument();
    await waitFor(() => expect(api.getStatus).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listConfiguredServers).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('filesystem')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /disable filesystem/i }));
    expect(api.setConfiguredServerEnabled).toHaveBeenCalledWith({
      name: 'filesystem',
      enabled: false,
      csrfToken: 'csrf_123',
    });

    await user.click(screen.getByRole('button', { name: /log out/i }));
    expect(api.logout).toHaveBeenCalledWith('csrf_123');
    expect(await screen.findByRole('heading', { name: /operator login/i })).toBeInTheDocument();
  });

  it('shows setup guidance for setup-required unauthenticated sessions', async () => {
    const api = apiClient({
      getSession: vi.fn(async () => {
        throw new AdminApiError(401, { authenticated: false, adminStatus: 'setupRequired' }, 'Unauthorized');
      }),
    });

    renderRoot(api);

    expect(await screen.findByRole('heading', { name: /setup required/i })).toBeInTheDocument();
    expect(
      screen.getByText("1mcp admin bootstrap --username operator --password 'use-a-long-random-password'"),
    ).toBeInTheDocument();
    expect(screen.queryByText('1mcp admin bootstrap')).not.toBeInTheDocument();
  });

  it('maps known API failures to operator-friendly recovery copy', async () => {
    const user = userEvent.setup();
    const api = apiClient({
      getSession: vi.fn(async () => {
        throw new AdminApiError(401, { authenticated: false, adminStatus: 'loginRequired' }, 'Unauthorized');
      }),
      login: vi.fn(async () => {
        throw new AdminApiError(401, { error: 'invalid_credentials', requestId: 'req_login' }, 'invalid_credentials');
      }),
    });

    renderRoot(api);

    expect(await screen.findByRole('heading', { name: /operator login/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/username/i), 'operator');
    await user.type(screen.getByLabelText(/password/i), 'incorrect');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Login failed: Check the admin username and password, then try again. Request ID: req_login',
    );
    expect(screen.queryByText(/invalid_credentials/)).not.toBeInTheDocument();
  });

  it('loads console read models after a successful login from the login screen', async () => {
    const user = userEvent.setup();
    const api = apiClient({
      getSession: vi.fn(async () => {
        throw new AdminApiError(401, { authenticated: false, adminStatus: 'loginRequired' }, 'Unauthorized');
      }),
      login: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [
        {
          id: 'github',
          source: 'mcpServers' as const,
          enabled: false,
          transport: { url: 'https://mcp.example/github' },
          secretInputs: [],
        },
      ]),
    });

    renderRoot(api);

    expect(await screen.findByRole('heading', { name: /operator login/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/username/i), 'operator');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('heading', { name: /runtime operations/i })).toBeInTheDocument();
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect(api.listConfiguredServers).toHaveBeenCalledTimes(1);
  });

  it('opens a configured-server detail route and previews an environment secret replacement', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin');
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [configuredServerListItem()]),
      getConfiguredServerDetail: vi.fn(async () => configuredServerDetail()),
      previewConfiguredServerEdit: vi.fn(async () => ({
        ok: true,
        operationId: 'op_preview',
        preview: {
          targetName: 'github/api',
          proposedTargetName: 'github/api',
          previewFingerprint: 'preview_abc123',
          validation: { status: 'valid', errors: [] },
          diff: [
            {
              fieldPath: ['url', 'query', 'token'],
              secretAction: 'replace',
              oldValue: { present: true, value: '[REDACTED]', secret: true },
              newValue: {
                kind: 'environmentReference',
                value: '${GITHUB_TOKEN}',
                storesSecretMaterial: false,
              },
              riskFlags: ['connection_critical', 'secret'],
            },
          ],
          configChange: {
            status: 'changed',
            operation: 'set_static',
            configPath: '[redacted]',
            target: { name: 'github/api', source: 'mcpServers' },
            changed: true,
            backup: { created: false },
            retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
            reload: { status: 'skipped' },
            warnings: [],
          },
          connectivityCheck: { status: 'skipped', reason: 'endpoint_changed_with_preserved_secrets' },
        },
      })),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /runtime operations/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit github\/api server/i }));

    expect(routeWindow.history.pushState).toHaveBeenCalledWith(null, '', '/admin/servers/github%2Fapi');
    expect(await screen.findByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
    expect(api.getConfiguredServerDetail).toHaveBeenCalledWith('github/api');
    expect(screen.getByDisplayValue('https://api.example.com/mcp?token=REDACTED')).toBeInTheDocument();
    expect(screen.queryByText(/raw-token|Bearer raw/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /replace url\.query\.token/i }));
    await user.type(screen.getByLabelText(/environment variable for url\.query\.token/i), 'GITHUB_TOKEN');
    await user.click(screen.getByRole('button', { name: /preview change/i }));

    expect(api.previewConfiguredServerEdit).toHaveBeenCalledWith({
      name: 'github/api',
      csrfToken: 'csrf_123',
      connectivityCheck: 'auto',
      edit: {
        secrets: [
          {
            fieldPath: ['url', 'query', 'token'],
            action: 'replace',
            replacement: { kind: 'environmentReference', value: 'GITHUB_TOKEN' },
          },
        ],
      },
    });
    expect(await screen.findByText('preview_abc123')).toBeInTheDocument();
    expect(screen.getByText(/Endpoint changed while secrets stayed preserved/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /rerun connectivity/i }));

    expect(api.previewConfiguredServerEdit).toHaveBeenLastCalledWith({
      name: 'github/api',
      csrfToken: 'csrf_123',
      connectivityCheck: 'manual',
      edit: {
        secrets: [
          {
            fieldPath: ['url', 'query', 'token'],
            action: 'replace',
            replacement: { kind: 'environmentReference', value: 'GITHUB_TOKEN' },
          },
        ],
      },
    });
  });

  it('loads URL-addressed configured-server detail and shows recovery copy when the target is missing', async () => {
    const routeWindow = createRouteWindow('/admin/servers/missing');
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => []),
      getConfiguredServerDetail: vi.fn(async () => {
        throw new AdminApiError(
          404,
          { code: 'configured_server_not_found', target: { type: 'configured_server', id: 'missing' } },
          'configured_server_not_found',
        );
      }),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /server target not found/i })).toBeInTheDocument();
    expect(screen.getByText(/missing is no longer available/i)).toBeInTheDocument();
    expect(api.getConfiguredServerDetail).toHaveBeenCalledWith('missing');
  });

  it('follows browser back and forward navigation for configured-server detail routes', async () => {
    const routeWindow = createRouteWindow('/admin');
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [configuredServerListItem()]),
      getConfiguredServerDetail: vi.fn(async () => configuredServerDetail()),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /runtime operations/i })).toBeInTheDocument();
    expect(api.getConfiguredServerDetail).not.toHaveBeenCalled();

    routeWindow.location.pathname = '/admin/servers/github%2Fapi';
    await act(async () => {
      routeWindow.emitPopState();
    });

    expect(await screen.findByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
    expect(api.getConfiguredServerDetail).toHaveBeenCalledWith('github/api');

    routeWindow.location.pathname = '/admin';
    await act(async () => {
      routeWindow.emitPopState();
    });

    expect(await screen.findByText(/Select Edit server to change target settings/i)).toBeInTheDocument();
  });

  it('follows browser navigation between top-level admin workspaces', async () => {
    const routeWindow = createRouteWindow('/admin');
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [configuredServerListItem()]),
    });

    renderRoot(api, { windowRef: routeWindow });
    expect(await screen.findByRole('heading', { name: /runtime operations/i })).toBeInTheDocument();

    routeWindow.location.pathname = '/admin/about';
    await act(async () => routeWindow.emitPopState());

    expect(await screen.findByText('About metadata is unavailable.')).toBeInTheDocument();
  });

  it('keeps the current detail route when the operator cancels dirty draft discard', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin');
    routeWindow.confirm.mockReturnValue(false);
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [configuredServerListItem()]),
      getConfiguredServerDetail: vi.fn(async () => configuredServerDetail()),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /runtime operations/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit github\/api server/i }));
    expect(await screen.findByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('URL'));
    await user.type(screen.getByLabelText('URL'), 'https://api.example.com/v2/mcp');

    routeWindow.location.pathname = '/admin';
    await act(async () => {
      routeWindow.emitPopState();
    });

    expect(routeWindow.confirm).toHaveBeenCalledWith('Discard unsaved configured-server edits?');
    expect(routeWindow.history.replaceState).toHaveBeenLastCalledWith(null, '', '/admin/servers/github%2Fapi');
    expect(screen.getByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
  });

  it('keeps the current detail route when switching servers would discard dirty draft edits', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin');
    routeWindow.confirm.mockReturnValue(false);
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [
        configuredServerListItem('github/api'),
        configuredServerListItem('filesystem'),
      ]),
      getConfiguredServerDetail: vi.fn(async (serverId: string) => configuredServerDetail(serverId)),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /runtime operations/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit github\/api server/i }));
    expect(await screen.findByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('URL'));
    await user.type(screen.getByLabelText('URL'), 'https://api.example.com/v2/mcp');

    await user.click(screen.getByRole('button', { name: /edit filesystem server/i }));

    expect(routeWindow.confirm).toHaveBeenCalledWith('Discard unsaved configured-server edits?');
    expect(api.getConfiguredServerDetail).not.toHaveBeenCalledWith('filesystem');
    expect(routeWindow.history.pushState).toHaveBeenLastCalledWith(null, '', '/admin/servers/github%2Fapi');
    expect(screen.getByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
  });

  it('ignores stale configured-server detail responses after navigating to another target', async () => {
    const routeWindow = createRouteWindow('/admin');
    const githubDetail = deferred<ReturnType<typeof configuredServerDetail>>();
    const filesystemDetail = deferred<ReturnType<typeof configuredServerDetail>>();
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [
        configuredServerListItem('github/api'),
        configuredServerListItem('filesystem'),
      ]),
      getConfiguredServerDetail: vi.fn((serverId: string) => {
        if (serverId === 'github/api') {
          return githubDetail.promise;
        }
        return filesystemDetail.promise;
      }),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /runtime operations/i })).toBeInTheDocument();
    routeWindow.location.pathname = '/admin/servers/github%2Fapi';
    await act(async () => {
      routeWindow.emitPopState();
    });
    routeWindow.location.pathname = '/admin/servers/filesystem';
    await act(async () => {
      routeWindow.emitPopState();
    });

    await act(async () => {
      filesystemDetail.resolve(configuredServerDetail('filesystem'));
    });
    expect(await screen.findByRole('heading', { name: /^filesystem$/i })).toBeInTheDocument();

    await act(async () => {
      githubDetail.resolve(configuredServerDetail('github/api'));
    });
    expect(screen.getByRole('heading', { name: /^filesystem$/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^github\/api$/i })).not.toBeInTheDocument();
  });

  it('ignores stale configured-server preview responses after navigating to another target', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin');
    const stalePreview = deferred<Awaited<ReturnType<AdminApiClient['previewConfiguredServerEdit']>>>();
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [
        configuredServerListItem('github/api'),
        configuredServerListItem('filesystem'),
      ]),
      getConfiguredServerDetail: vi.fn(async (serverId: string) => configuredServerDetail(serverId)),
      previewConfiguredServerEdit: vi.fn(() => stalePreview.promise),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /runtime operations/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit github\/api server/i }));
    expect(await screen.findByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /replace url\.query\.token/i }));
    await user.type(screen.getByLabelText(/environment variable for url\.query\.token/i), 'GITHUB_TOKEN');

    const previewButton = screen.getByRole('button', { name: /preview change/i });
    fireEvent.click(previewButton);
    expect(api.previewConfiguredServerEdit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /edit filesystem server/i }));
    expect(await screen.findByRole('heading', { name: /^filesystem$/i })).toBeInTheDocument();

    await act(async () => {
      stalePreview.resolve(configuredServerPreview('preview_old'));
    });
    expect(screen.getByRole('heading', { name: /^filesystem$/i })).toBeInTheDocument();
    expect(screen.queryByText('preview_old')).not.toBeInTheDocument();
  });

  it('maps mutation operation failures to actionable copy', async () => {
    const user = userEvent.setup();
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [
        {
          id: 'filesystem',
          source: 'mcpServers' as const,
          enabled: true,
          transport: { type: 'stdio' },
          secretInputs: [],
        },
      ]),
      setConfiguredServerEnabled: vi.fn(async () => {
        throw new AdminApiError(
          409,
          { error: { code: 'operation_state_unknown', requestId: 'req_mutation' } },
          'operation_state_unknown',
        );
      }),
    });

    renderRoot(api);

    expect(await screen.findByRole('heading', { name: /runtime operations/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /disable filesystem/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Server disable failed: The runtime could not confirm the operation result. Refresh the console and inspect the current state before retrying. Request ID: req_mutation',
    );
    expect(screen.queryByText(/operation_state_unknown/)).not.toBeInTheDocument();
  });

  it('does not surface raw transport error messages as primary copy', async () => {
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => {
        const message =
          'The Admin Console could not reach the runtime. Check that the runtime is still available, then refresh.';
        throw new AdminApiError(0, {}, message, { kind: 'unavailable', message });
      }),
      listConfiguredServers: vi.fn(async () => []),
    });

    renderRoot(api);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Session loaded, but refresh failed: The Admin Console could not reach the runtime. Check that the runtime is still available, then refresh.',
    );
    expect(screen.queryByText(/ECONNREFUSED|config\.json/)).not.toBeInTheDocument();
  });

  it('polls visible tabs quickly and hidden tabs slowly', async () => {
    const scheduledTimers: Array<{ handler: () => void; timeout?: number }> = [];
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => []),
    });

    renderRoot(api, {
      documentRef: { visibilityState: 'hidden' },
      windowRef: {
        setTimeout: vi.fn((handler: TimerHandler, timeout?: number) => {
          scheduledTimers.push({ handler: handler as () => void, timeout });
          return scheduledTimers.length;
        }),
        clearTimeout: vi.fn(),
      },
    });

    await screen.findByRole('heading', { name: /runtime operations/i });
    expect(scheduledTimers.at(-1)?.timeout).toBe(60_000);
    expect(api.getStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      scheduledTimers.at(-1)?.handler();
    });

    await waitFor(() => expect(api.getStatus).toHaveBeenCalledTimes(2));
  });
});

function renderRoot(api: AdminApiClient, options: Partial<ComponentProps<typeof AdminConsoleRoot>> = {}) {
  return render(
    <MantineProvider>
      <AdminConsoleRoot api={api} {...options} />
    </MantineProvider>,
  );
}

function apiClient(overrides: Partial<AdminApiClient>): AdminApiClient {
  return {
    login: vi.fn(),
    getSession: vi.fn(),
    logout: vi.fn(),
    getStatus: vi.fn(),
    listConfiguredServers: vi.fn(),
    getConfiguredServerDetail: vi.fn(),
    previewConfiguredServerEdit: vi.fn(),
    setConfiguredServerEnabled: vi.fn(),
    ...overrides,
  };
}

function createRouteWindow(pathname: string) {
  const listeners = new Map<string, Array<(event: Event) => void>>();
  const routeWindow = {
    setTimeout: vi.fn((handler: TimerHandler, timeout?: number) => window.setTimeout(handler, timeout)),
    clearTimeout: vi.fn((id: number) => window.clearTimeout(id)),
    location: { pathname },
    history: {
      pushState: vi.fn((_state: unknown, _title: string, url?: string | URL | null) => {
        if (typeof url === 'string') {
          routeWindow.location.pathname = url;
        }
      }),
      replaceState: vi.fn((_state: unknown, _title: string, url?: string | URL | null) => {
        if (typeof url === 'string') {
          routeWindow.location.pathname = url;
        }
      }),
    },
    confirm: vi.fn(() => true),
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      const handleEvent = typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
      listeners.set(type, [...(listeners.get(type) ?? []), handleEvent]);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      const handleEvent = typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== handleEvent),
      );
    }),
    emitPopState: () => {
      for (const listener of listeners.get('popstate') ?? []) {
        listener(new Event('popstate'));
      }
    },
  } as any;
  return routeWindow;
}

function configuredServerListItem(id = 'github/api') {
  return {
    id,
    source: 'mcpServers' as const,
    target: { type: 'configured_server' as const, id, source: 'mcpServers' as const },
    enabled: true,
    tags: ['remote'],
    transportSummary: { kind: 'http', label: 'https://api.example.com/mcp?token=REDACTED' },
    mutationAvailability: { available: true, operations: ['enable' as const, 'disable' as const] },
    actionState: {
      enable: { available: false, label: 'Enable github/api', disabledReason: 'already_enabled' as const },
      disable: { available: true, label: 'Disable github/api' },
    },
    transport: { type: 'http', url: 'https://api.example.com/mcp?token=REDACTED' },
    secretInputs: [{ fieldPath: ['url', 'query', 'token'], label: 'url.query.token', state: 'present' as const }],
  };
}

function configuredServerDetail(id = 'github/api') {
  const server = configuredServerListItem(id);
  return {
    ok: true as const,
    operationId: 'op_detail',
    server,
    editContract: {
      schemaVersion: 1 as const,
      target: server.target,
      capabilities: {
        singleTargetEdit: true as const,
        rename: { supported: true as const },
        create: { supported: false as const },
        delete: { supported: false as const },
        bulkEdit: { supported: false as const },
        rawJson: { supported: false as const },
        preview: { supported: true as const },
        apply: { supported: false as const },
      },
      fieldGroups: [
        {
          id: 'identity',
          label: 'Target',
          fields: [
            {
              fieldPath: ['id'],
              label: 'Target ID',
              control: 'text' as const,
              value: 'github/api',
              editable: true,
            },
          ],
        },
        {
          id: 'transport',
          label: 'Transport',
          fields: [
            {
              fieldPath: ['transport', 'url'],
              label: 'URL',
              control: 'text' as const,
              value: 'https://api.example.com/mcp?token=REDACTED',
              editable: true,
            },
          ],
        },
        {
          id: 'secrets',
          label: 'Secrets',
          fields: [
            {
              fieldPath: ['url', 'query', 'token'],
              label: 'url.query.token',
              control: 'secret' as const,
              editable: true,
              secret: {
                state: 'present' as const,
                defaultAction: 'preserve' as const,
                allowedActions: ['preserve' as const, 'replace' as const, 'clear' as const],
                environmentReference: {
                  supported: true,
                  recommended: true,
                  valueFormat: 'env_var_name_or_substitution' as const,
                  storesSecretMaterial: false as const,
                  guidance:
                    'Store only the environment variable name or substitution expression; keep secret material outside 1MCP config.',
                },
                inlineReplacement: {
                  supported: true,
                  emphasis: 'secondary' as const,
                  guidance:
                    'Use inline replacement only as a secondary path when an environment reference is not suitable.',
                },
              },
            },
          ],
        },
      ],
    },
  };
}

function configuredServerPreview(
  previewFingerprint: string,
): Awaited<ReturnType<AdminApiClient['previewConfiguredServerEdit']>> {
  return {
    ok: true,
    operationId: `op_${previewFingerprint}`,
    preview: {
      targetName: 'github/api',
      proposedTargetName: 'github/api',
      previewFingerprint,
      validation: { status: 'valid', errors: [] },
      diff: [],
      configChange: {
        status: 'changed',
        operation: 'set_static',
        target: { name: 'github/api', source: 'mcpServers' },
        changed: true,
        backup: { created: false },
        retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
        reload: { status: 'skipped' },
        warnings: [],
      },
      connectivityCheck: { status: 'skipped', reason: 'endpoint_changed_with_preserved_secrets' },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
