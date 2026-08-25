import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AdminApiError } from './api/adminApi';
import type { AdminApiClient } from './api/adminApi';
import { configuredServerCreateContract } from './configuredServerCreate/configuredServerCreate.fixtures';
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

    renderRoot(api, { windowRef: createRouteWindow('/admin/servers') });

    expect(await screen.findByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
    await waitFor(() => expect(api.getStatus).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listConfiguredServers).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('filesystem')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: /disable filesystem/i }));
    expect(api.setConfiguredServerEnabled).toHaveBeenCalledWith({
      name: 'filesystem',
      enabled: false,
      csrfToken: 'csrf_123',
    });

    await user.click(screen.getByRole('button', { name: /log out/i }));
    expect(api.logout).toHaveBeenCalledWith('csrf_123');
    expect(await screen.findByRole('heading', { name: /operator login/i })).toBeInTheDocument();
  });

  it.each([
    {
      label: 'failed reload',
      reload: { status: 'failed' as const, error: 'Runtime reload failed after persistence.' },
      initialEnabled: true,
      requestedEnabled: false,
      retirementObserved: false,
      malformed: false,
      message: 'Lifecycle configuration was saved, but runtime reload failed. Recovery is required.',
    },
    {
      label: 'unconfirmed retirement',
      reload: { status: 'observed' as const },
      initialEnabled: true,
      requestedEnabled: false,
      retirementObserved: false,
      malformed: false,
      message:
        'Lifecycle configuration was saved, but Template instance retirement was not confirmed. Recovery is required.',
    },
    {
      label: 'enable without retirement observation',
      reload: { status: 'observed' as const },
      initialEnabled: false,
      requestedEnabled: true,
      retirementObserved: false,
      malformed: false,
      message: undefined,
    },
    {
      label: 'malformed apply envelope',
      reload: { status: 'observed' as const },
      initialEnabled: true,
      requestedEnabled: false,
      retirementObserved: false,
      malformed: true,
      message:
        'Server disable failed: The runtime returned an invalid configured-server lifecycle response.',
    },
  ])(
    'reports persisted Template $label truthfully',
    async ({ reload, initialEnabled, requestedEnabled, retirementObserved, malformed, message }) => {
    const user = userEvent.setup();
    let currentEnabled = initialEnabled;
    const templateServer = () => ({
      id: 'worker',
      source: 'mcpTemplates' as const,
      target: { type: 'configured_server' as const, id: 'worker', source: 'mcpTemplates' as const },
      enabled: currentEnabled,
      tags: [],
      transportSummary: { kind: 'stdio', label: 'node' },
      mutationAvailability: { available: true, operations: ['enable' as const, 'disable' as const] },
      actionState: currentEnabled
        ? {
            enable: { available: false, label: 'Enable worker', disabledReason: 'already_enabled' as const },
            disable: { available: true, label: 'Disable worker' },
          }
        : {
            enable: { available: true, label: 'Enable worker' },
            disable: { available: false, label: 'Disable worker', disabledReason: 'already_disabled' as const },
          },
      transport: { type: 'stdio', command: 'node' },
      secretInputs: [],
      runtime: { objectKind: 'definition' as const, activeInstanceCount: currentEnabled ? 1 : 0 },
    });
    const listConfiguredServers = vi.fn(async () => [templateServer()]);
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers,
      previewConfiguredServerLifecycle: vi.fn(async () => ({
        ok: true,
        operationId: 'op_lifecycle_preview',
        preview: {
          target: templateServer().target,
          qualifiedId: 'mcpTemplates/worker',
          targetFingerprint: 'configured_server_target',
          previewFingerprint: 'lifecycle_preview_1',
          current: { enabled: !requestedEnabled, disabledValueKind: requestedEnabled ? 'literal' : 'absent' },
          proposed: { enabled: requestedEnabled, disabledValueKind: requestedEnabled ? 'absent' : 'literal' },
          expressionReplacement: {
            occurs: false,
            replacement: requestedEnabled ? 'enabled_absent' : 'disabled_true',
          },
          configChange: lifecycleConfigChange({ status: 'skipped' }),
          expectedBackup: { policy: 'required', recoveryCopy: true },
          expectedReload: {
            policy: 'observe_after_write',
            possibleStatuses: ['observed', 'runtime_not_running', 'reload_disabled', 'failed'],
          },
          runtimeImpact: {
            activeInstanceCount: requestedEnabled ? 0 : 1,
            retirement: requestedEnabled ? 'not_required' : 'after_successful_reload',
            recreation: 'lazy_future_match_only',
          },
          warnings: ['Successful reload retires 1 active Template Server instance.'],
        },
      })),
      applyConfiguredServerLifecycle: vi.fn(async (input) => {
        if (malformed) {
          const message = 'The runtime returned an invalid configured-server lifecycle response.';
          throw new AdminApiError(502, {}, message, { kind: 'unavailable', message });
        }
        currentEnabled = input.enabled;
        return {
          ok: true,
          operationId: 'op_lifecycle_apply',
          result: {
            target: templateServer().target,
            qualifiedId: 'mcpTemplates/worker',
            previewFingerprint: 'lifecycle_preview_1',
            enabled: input.enabled,
            outcome: input.enabled ? ('enabled' as const) : ('disabled' as const),
            configChange: lifecycleConfigChange(reload),
            runtimeImpact: {
              activeInstancesBefore: 1,
              retiredInstances: retirementObserved ? 1 : 0,
              activeInstancesAfter: retirementObserved ? 0 : 1,
              retirementObserved,
            },
          },
        };
      }),
    });

    renderRoot(api, { windowRef: createRouteWindow('/admin/servers') });
    await screen.findByText('worker');
    await user.click(screen.getByRole('switch', { name: requestedEnabled ? 'Enable worker' : 'Disable worker' }));
    await user.click(
      await screen.findByRole('button', { name: requestedEnabled ? 'Enable template' : 'Disable template' }),
    );

    if (message) {
      expect((await screen.findAllByText(message)).length).toBeGreaterThanOrEqual(1);
    } else {
      expect(await screen.findByText('Server enable completed.')).toBeInTheDocument();
    }
    expect(screen.getByText(malformed ? 'enabled' : requestedEnabled ? 'enabled' : 'disabled', { exact: true })).toBeInTheDocument();
    expect(listConfiguredServers).toHaveBeenCalledTimes(malformed ? 1 : 2);
    },
  );

  it('keeps a dirty create draft and route when reopening creation is cancelled', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin/servers');
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => []),
      getConfiguredServerCreateContract: vi.fn(async () => configuredServerCreateContract()),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /configure server/i }));
    const nameInput = await screen.findByLabelText('Name');
    await user.type(nameInput, 'keep-me');
    expect(routeWindow.location.pathname).toBe('/admin/servers/new');

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(await screen.findByRole('dialog', { name: /discard custom server/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(routeWindow.location.pathname).toBe('/admin/servers/new');
    expect(nameInput).toHaveValue('keep-me');
    expect(api.getConfiguredServerCreateContract).toHaveBeenCalledOnce();
  });

  it('shows setup guidance for setup-required unauthenticated sessions', async () => {
    const api = apiClient({
      getSession: vi.fn(async () => ({ authenticated: false as const, adminStatus: 'setupRequired' as const })),
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
      getSession: vi.fn(async () => ({ authenticated: false as const, adminStatus: 'loginRequired' as const })),
      login: vi.fn(async () => {
        throw new AdminApiError(401, { error: 'invalid_credentials', requestId: 'req_login' }, 'invalid_credentials');
      }),
    });

    renderRoot(api);

    expect(await screen.findByRole('heading', { name: /operator login/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/username/i), 'operator');
    await user.type(screen.getByLabelText(/^Password/, { selector: 'input' }), 'incorrect');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Login failed: Check the admin username and password, then try again. Request ID: req_login',
    );
    expect(screen.queryByText(/invalid_credentials/)).not.toBeInTheDocument();
  });

  it('loads console read models after a successful login from the login screen', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin/servers');
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

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /operator login/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/username/i), 'operator');
    await user.type(screen.getByLabelText(/^Password/, { selector: 'input' }), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect(api.listConfiguredServers).toHaveBeenCalledTimes(1);
  });

  it('opens a configured-server detail route and previews an environment secret replacement', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin/servers');
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

    expect(await screen.findByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit static github\/api server/i }));

    expect(routeWindow.history.pushState).toHaveBeenCalledWith(null, '', '/admin/servers/mcpServers/github%2Fapi');
    expect(await screen.findByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
    expect(api.getConfiguredServerDetail).toHaveBeenCalledWith({ source: 'mcpServers', id: 'github/api' });
    expect(api.refreshConfiguredToolInventory).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('https://api.example.com/mcp?token=REDACTED')).toBeInTheDocument();
    expect(screen.queryByText(/raw-token|Bearer raw/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /replace url\.query\.token/i }));
    await user.type(screen.getByLabelText(/environment variable for url\.query\.token/i), 'GITHUB_TOKEN');
    await user.click(screen.getByRole('button', { name: /preview change/i }));

    expect(api.previewConfiguredServerEdit).toHaveBeenCalledWith({
      target: { source: 'mcpServers', id: 'github/api' },
      csrfToken: 'csrf_123',
      connectivityCheck: 'auto',
      model: 'gpt-4o',
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
      target: { source: 'mcpServers', id: 'github/api' },
      csrfToken: 'csrf_123',
      connectivityCheck: 'manual',
      model: 'gpt-4o',
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
    const routeWindow = createRouteWindow('/admin/servers');
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [configuredServerListItem()]),
      getConfiguredServerDetail: vi.fn(async () => configuredServerDetail()),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
    expect(api.getConfiguredServerDetail).not.toHaveBeenCalled();

    routeWindow.location.pathname = '/admin/servers/github%2Fapi';
    await act(async () => {
      routeWindow.emitPopState();
    });

    expect(await screen.findByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
    expect(api.getConfiguredServerDetail).toHaveBeenCalledWith('github/api');

    routeWindow.location.pathname = '/admin/servers';
    await act(async () => {
      routeWindow.emitPopState();
    });

    expect(await screen.findByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /github\/api/i })).not.toBeInTheDocument();
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

    routeWindow.location.pathname = '/admin/servers';
    await act(async () => routeWindow.emitPopState());
    expect(await screen.findByRole('heading', { name: /server inventory/i })).toBeInTheDocument();

    routeWindow.location.pathname = '/admin/oauth';
    await act(async () => routeWindow.emitPopState());
    expect(await screen.findByRole('heading', { name: /^oauth services$/i })).toBeInTheDocument();

    routeWindow.location.pathname = '/admin/audit';
    await act(async () => routeWindow.emitPopState());
    expect(await screen.findByRole('heading', { name: /^audit trail$/i })).toBeInTheDocument();

    routeWindow.location.pathname = '/admin/about';
    await act(async () => routeWindow.emitPopState());

    expect(await screen.findByText('About metadata is unavailable.')).toBeInTheDocument();
  });

  it('starts OAuth authorization with the full service ID and redirects only after success', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin/oauth');
    routeWindow.location.search = '?success=1';
    routeWindow.location.assign = vi.fn();
    const authorization = deferred<{ serviceId: string; redirectUrl: string }>();
    const authorizeOAuthService = vi.fn(() => authorization.promise);
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => ({
        ...status,
        oauth: {
          status: 'ready',
          services: [
            {
              name: 'context7:0123456789abcdef',
              id: 'context7:0123456789abcdef',
              displayName: 'context7:0123456789ab',
              status: 'awaiting_oauth',
              requiresOAuth: true,
            },
          ],
        },
      })),
      listConfiguredServers: vi.fn(async () => []),
      authorizeOAuthService,
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('status')).toHaveTextContent('OAuth authorization completed.');
    expect(routeWindow.history.replaceState).toHaveBeenCalledWith(null, '', '/admin/oauth');
    const authorizeButton = screen.getByRole('button', { name: /authorize context7:0123456789ab/i });
    await user.click(authorizeButton);
    expect(authorizeOAuthService).toHaveBeenCalledWith({
      serviceId: 'context7:0123456789abcdef',
      csrfToken: 'csrf_123',
    });
    expect(authorizeButton).toBeDisabled();
    expect(screen.getByText('Starting authorization...')).toBeInTheDocument();
    expect(routeWindow.location.assign).not.toHaveBeenCalled();

    authorization.resolve({
      serviceId: 'context7:0123456789abcdef',
      redirectUrl: 'https://provider.example/authorize',
    });
    await waitFor(() => expect(routeWindow.location.assign).toHaveBeenCalledWith('https://provider.example/authorize'));
  });

  it('keeps the OAuth workspace open and reports a failed authorization start', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin/oauth');
    routeWindow.location.assign = vi.fn();
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => ({
        ...status,
        oauth: {
          status: 'ready',
          services: [
            { name: 'github', id: 'github', displayName: 'github', status: 'awaiting_oauth', requiresOAuth: true },
          ],
        },
      })),
      listConfiguredServers: vi.fn(async () => []),
      authorizeOAuthService: vi.fn(async () => {
        throw new AdminApiError(
          503,
          { error: { code: 'backend_oauth_runtime_unavailable' } },
          'backend_oauth_runtime_unavailable',
        );
      }),
    });

    renderRoot(api, { windowRef: routeWindow });
    await user.click(await screen.findByRole('button', { name: /authorize github/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Backend OAuth operations are not available on this runtime.',
    );
    expect(routeWindow.location.assign).not.toHaveBeenCalled();
    expect(routeWindow.location.pathname).toBe('/admin/oauth');
  });

  it('clears an in-flight OAuth busy state when the Admin Session changes', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin/oauth');
    routeWindow.location.assign = vi.fn();
    const authorization = deferred<{ serviceId: string; redirectUrl: string }>();
    const nextSession = { ...session, csrfToken: 'csrf_456' };
    const oauthStatus = {
      ...status,
      oauth: {
        status: 'ready',
        services: [
          { name: 'github', id: 'github', displayName: 'github', status: 'awaiting_oauth', requiresOAuth: true },
        ],
      },
    };
    const api = apiClient({
      getSession: vi.fn(async () => session),
      login: vi.fn(async () => nextSession),
      logout: vi.fn(async () => ({ ok: true })),
      getStatus: vi.fn(async () => oauthStatus),
      listConfiguredServers: vi.fn(async () => []),
      authorizeOAuthService: vi.fn(() => authorization.promise),
    });

    renderRoot(api, { windowRef: routeWindow });
    await user.click(await screen.findByRole('button', { name: /authorize github/i }));
    expect(screen.getByRole('button', { name: /authorize github/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /log out/i }));
    await user.type(await screen.findByLabelText(/username/i), 'operator');
    await user.type(screen.getByLabelText(/^Password/, { selector: 'input' }), 'password');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('button', { name: /authorize github/i })).toBeEnabled();
    await act(async () => {
      authorization.resolve({ serviceId: 'github', redirectUrl: 'https://provider.example/authorize' });
      await authorization.promise;
    });
    expect(routeWindow.location.assign).not.toHaveBeenCalled();
  });

  it('uses fallback feedback for OAuth callback keys inherited from Object.prototype', async () => {
    const routeWindow = createRouteWindow('/admin/oauth');
    routeWindow.location.search = '?error=constructor';
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => []),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('alert')).toHaveTextContent('OAuth authorization did not complete.');
    expect(routeWindow.history.replaceState).toHaveBeenCalledWith(null, '', '/admin/oauth');
  });

  it('prevents reentrant preset save from queueing duplicate dialogs or mutations', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin/presets');
    const mutatePreset = vi.fn(async () => ({ ok: true }));
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => []),
      listPresets: vi.fn(async () => ({ revision: 'rev-1', presets: [], targets: [] })),
      previewPreset: vi.fn(async ({ draft }) => ({
        draft,
        revision: 'rev-1',
        previewFingerprint: 'preset-preview-1',
        validation: { status: 'valid', fieldErrors: [], globalErrors: [], warnings: [] },
        matches: [],
        matchCount: 0,
        structuredConversion: { lossless: true, strategy: 'or', tags: [] },
      })),
      mutatePreset,
    });

    renderRoot(api, { windowRef: routeWindow });
    expect(await screen.findByRole('heading', { name: /^presets$/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Preset name'), 'empty-preset');
    await user.click(screen.getByRole('button', { name: /preview matches/i }));
    const saveButton = await screen.findByRole('button', { name: /confirm and save/i });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    const confirmButton = await screen.findByRole('button', { name: /create preset/i });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mutatePreset).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('prevents reentrant preset delete from duplicating preview or mutation requests', async () => {
    const routeWindow = createRouteWindow('/admin/presets');
    const previewPresetDelete = vi.fn(async () => ({
      previewFingerprint: 'delete-preview-1',
      matches: [],
      matchCount: 0,
      consequence: 'The preset will no longer be available.',
    }));
    const deletePreset = vi.fn(async () => ({ ok: true }));
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => []),
      listPresets: vi.fn(async () => ({
        revision: 'rev-1',
        targets: [],
        presets: [
          {
            name: 'obsolete',
            strategy: 'or',
            tagQuery: {},
            querySummary: 'empty query',
            matchCount: 0,
          },
        ],
      })),
      previewPresetDelete,
      deletePreset,
    });

    renderRoot(api, { windowRef: routeWindow });
    const deleteButton = await screen.findByRole('button', { name: /delete/i });
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);
    const confirmButton = await screen.findByRole('button', { name: /delete preset/i });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(deletePreset).toHaveBeenCalledTimes(1));
    expect(previewPresetDelete).toHaveBeenCalledTimes(1);
  });

  it('keeps the current detail route when the operator cancels dirty draft discard', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin/servers');
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [configuredServerListItem()]),
      getConfiguredServerDetail: vi.fn(async () => configuredServerDetail()),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit static github\/api server/i }));
    expect(await screen.findByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('URL'));
    await user.type(screen.getByLabelText('URL'), 'https://api.example.com/v2/mcp');

    routeWindow.location.pathname = '/admin';
    await act(async () => {
      routeWindow.emitPopState();
    });

    expect(await screen.findByRole('dialog', { name: /discard unsaved changes/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(routeWindow.history.replaceState).toHaveBeenLastCalledWith(
      null,
      '',
      '/admin/servers/mcpServers/github%2Fapi',
    );
    expect(screen.getByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
  });

  it('keeps the current detail route when switching servers would discard dirty draft edits', async () => {
    const user = userEvent.setup();
    const routeWindow = createRouteWindow('/admin/servers');
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [
        configuredServerListItem('github/api'),
        configuredServerListItem('filesystem'),
      ]),
      getConfiguredServerDetail: vi.fn(async (target: string | { id: string }) =>
        configuredServerDetail(typeof target === 'string' ? target : target.id),
      ),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit static github\/api server/i }));
    expect(await screen.findByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('URL'));
    await user.type(screen.getByLabelText('URL'), 'https://api.example.com/v2/mcp');

    routeWindow.location.pathname = '/admin/servers/filesystem';
    await act(async () => {
      routeWindow.emitPopState();
    });

    expect(await screen.findByRole('dialog', { name: /discard unsaved changes/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(api.getConfiguredServerDetail).not.toHaveBeenCalledWith({ source: 'mcpServers', id: 'filesystem' });
    expect(routeWindow.history.pushState).toHaveBeenLastCalledWith(null, '', '/admin/servers/mcpServers/github%2Fapi');
    expect(screen.getByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
  });

  it('ignores stale configured-server detail responses after navigating to another target', async () => {
    const routeWindow = createRouteWindow('/admin/servers');
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

    expect(await screen.findByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
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
    const routeWindow = createRouteWindow('/admin/servers');
    const stalePreview = deferred<Awaited<ReturnType<AdminApiClient['previewConfiguredServerEdit']>>>();
    const api = apiClient({
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [
        configuredServerListItem('github/api'),
        configuredServerListItem('filesystem'),
      ]),
      getConfiguredServerDetail: vi.fn(async (target: string | { id: string }) =>
        configuredServerDetail(typeof target === 'string' ? target : target.id),
      ),
      previewConfiguredServerEdit: vi.fn(() => stalePreview.promise),
    });

    renderRoot(api, { windowRef: routeWindow });

    expect(await screen.findByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit static github\/api server/i }));
    expect(await screen.findByRole('heading', { name: /github\/api/i })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /replace url\.query\.token/i }));
    await user.type(screen.getByLabelText(/environment variable for url\.query\.token/i), 'GITHUB_TOKEN');

    const previewButton = screen.getByRole('button', { name: /preview change/i });
    fireEvent.click(previewButton);
    expect(api.previewConfiguredServerEdit).toHaveBeenCalledTimes(1);
    routeWindow.location.pathname = '/admin/servers/filesystem';
    await act(async () => {
      routeWindow.emitPopState();
    });
    await user.click(await screen.findByRole('button', { name: /discard changes/i }));
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

    renderRoot(api, { windowRef: createRouteWindow('/admin/servers') });

    expect(await screen.findByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: /disable filesystem/i }));

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
    refreshConfiguredToolInventory: vi.fn(async ({ target, model }) => ({
      ok: true,
      operationId: 'op_tool_inventory_refresh',
      toolInventory: configuredToolInventory(target, model),
    })),
    previewConfiguredServerEdit: vi.fn(),
    applyConfiguredServerEdit: vi.fn(),
    previewConfiguredServerLifecycle: vi.fn(),
    applyConfiguredServerLifecycle: vi.fn(),
    setConfiguredServerEnabled: vi.fn(),
    authorizeOAuthService: vi.fn(),
    restartOAuthService: vi.fn(),
    ...overrides,
  };
}

function lifecycleConfigChange(reload: { status: string; error?: string }) {
  return {
    status: 'changed',
    operation: 'disable',
    configPath: '[redacted]',
    target: { name: 'worker', source: 'mcpTemplates' },
    changed: true,
    backup: { created: true, path: '[redacted]' },
    retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
    reload,
    warnings: [],
  };
}

function createRouteWindow(pathname: string) {
  const listeners = new Map<string, Array<(event: Event) => void>>();
  const routeWindow = {
    setTimeout: vi.fn((handler: TimerHandler, timeout?: number) => window.setTimeout(handler, timeout)),
    clearTimeout: vi.fn((id: number) => window.clearTimeout(id)),
    location: { pathname, hash: '' },
    history: {
      pushState: vi.fn((_state: unknown, _title: string, url?: string | URL | null) => {
        if (typeof url === 'string') {
          const [nextPathname, nextHash = ''] = url.split('#');
          routeWindow.location.pathname = nextPathname;
          routeWindow.location.hash = nextHash ? `#${nextHash}` : '';
        }
      }),
      replaceState: vi.fn((_state: unknown, _title: string, url?: string | URL | null) => {
        if (typeof url === 'string') {
          const [nextPathname, nextHash = ''] = url.split('#');
          routeWindow.location.pathname = nextPathname;
          routeWindow.location.hash = nextHash ? `#${nextHash}` : '';
        }
      }),
    },
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
    toolInventory: configuredToolInventory(server.target),
  };
}

function configuredToolInventory(target: { source: 'mcpServers' | 'mcpTemplates'; id: string }, model = 'gpt-4o') {
  return {
    targetName: target.id,
    source: target.source,
    targetEnabled: true,
    freshness: 'live' as const,
    model,
    generation: `generation-${target.source}-${target.id}`,
    activeInstanceCount: 1,
    inspection: {
      status: 'complete' as const,
      retryable: false,
      instances: [{ instanceId: target.id, status: 'complete' as const }],
    },
    rows: [],
    counts: { observed: 0, enabled: 0, disabled: 0, unresolved: 0 },
    approximateTokens: { enabled: 0, allObserved: 0, savings: 0 },
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
