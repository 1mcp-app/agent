import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ComponentProps } from 'react';
import { vi } from 'vitest';

import type { AdminConsoleState } from '../state/adminConsoleState';
import { createInitialState } from '../state/adminConsoleState';
import { AdminConsoleApp } from './AdminConsoleApp';

describe('AdminConsoleApp', () => {
  it('renders setup-required guidance without authenticated console chrome', () => {
    render(
      <MantineProvider>
        <AdminConsoleApp state={{ ...createInitialState(), view: 'setupRequired' }} />
      </MantineProvider>,
    );

    expect(screen.queryByRole('banner', { name: /admin console/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /runtime identity/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /setup required/i })).toBeInTheDocument();
    expect(
      screen.getByText("1mcp admin bootstrap --username operator --password 'use-a-long-random-password'"),
    ).toBeInTheDocument();
    expect(screen.queryByText('1mcp admin bootstrap')).not.toBeInTheDocument();
  });

  it('renders login and loading states without account-management controls', () => {
    const { rerender } = renderApp({ ...createInitialState(), view: 'login' });

    expect(screen.getByRole('heading', { name: /operator login/i })).toBeInTheDocument();
    expect(screen.queryByRole('banner', { name: /admin console/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /runtime identity/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByText(/create account|disable account|delete account|password reset/i)).not.toBeInTheDocument();

    rerender(
      <MantineProvider>
        <AdminConsoleApp state={createInitialState()} />
      </MantineProvider>,
    );

    expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled();
    expect(screen.queryByRole('banner', { name: /admin console/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /runtime identity/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeDisabled();
  });

  it('shows runtime, OAuth, audit, counters, search, and enabled filtering', async () => {
    const user = userEvent.setup();
    const onServerAction = vi.fn();
    const onCopyText = vi.fn();

    renderApp(consoleState(), { onServerAction, onCopyText });

    expect(screen.getByRole('navigation', { name: /operations navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('banner', { name: /admin console/i })).toHaveTextContent(/runtime online/i);
    expect(screen.getByRole('heading', { name: /operations overview/i })).toBeInTheDocument();
    expect(screen.getByText(/runtime health/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
    expect(screen.getByText('Enabled servers')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('Disabled servers')).toBeInTheDocument();
    expect(screen.getByText('OAuth attention')).toBeInTheDocument();
    expect(screen.getByText('Failed audits')).toBeInTheDocument();
    expect(screen.getAllByText('https://runtime.example.com').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1.2.3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Identity details/i)).toBeInTheDocument();
    expect(screen.getAllByText('scope_123').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('github').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('local / storage')).toBeInTheDocument();
    expect(screen.getByText('npx -y @modelcontextprotocol/server-filesystem /tmp/project')).toBeInTheDocument();
    expect(screen.getByText('awaiting_oauth')).toBeInTheDocument();
    expect(screen.getByText('enableConfiguredServer')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /copy runtime scope/i }));
    expect(onCopyText).toHaveBeenCalledWith('runtimeScopeId', 'scope_123');

    await user.type(screen.getByRole('searchbox', { name: /search servers/i }), 'git');
    expect(within(screen.getByRole('table')).queryByText('filesystem')).not.toBeInTheDocument();
    expect(screen.getAllByText('github').length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('radio', { name: /enabled/i }));
    expect(screen.getByText(/No servers match/i)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /disabled/i }));
    await user.click(screen.getByRole('button', { name: /enable github/i }));
    expect(onServerAction).toHaveBeenCalledWith('github', 'enable');
  });

  it('shows visible copy feedback when clipboard writing fails', async () => {
    const user = userEvent.setup();

    renderApp(consoleState(), {
      onCopyText: vi.fn(async () => {
        throw new Error('clipboard unavailable');
      }),
    });

    await user.click(screen.getByRole('button', { name: /copy runtime scope/i }));

    expect(screen.getByText('Could not copy runtime scope id. Select the value manually.')).toBeInTheDocument();
  });

  it('makes configured-server editing obvious from the server list', async () => {
    const user = userEvent.setup();
    const onOpenServerDetail = vi.fn();

    renderApp(consoleState(), { onOpenServerDetail });

    await user.click(screen.getByRole('button', { name: /edit github server/i }));

    expect(onOpenServerDetail).toHaveBeenCalledWith('github');
  });

  it('renders configured-server detail controls from the normalized contract without raw JSON or apply controls', async () => {
    const user = userEvent.setup();
    const onPreviewServerEdit = vi.fn();

    renderApp(consoleState(), {
      serverDetail: configuredServerDetailState(),
      onPreviewServerEdit,
    });

    expect(screen.getByRole('heading', { name: 'github' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /edit server/i })).toBeInTheDocument();
    expect(screen.getByText(/Draft changes stay local until preview/i)).toBeInTheDocument();
    expect(screen.getByText(/No changes yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview change/i })).toBeDisabled();
    expect(screen.getByDisplayValue('https://example.com/mcp?token=REDACTED')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /preserve existing url\.query\.token/i })).toBeChecked();
    expect(screen.getByText(/Store only the environment variable name/i)).toBeInTheDocument();
    expect(screen.queryByText(/raw-token|Bearer raw/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /raw json/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('URL'));
    await user.type(screen.getByLabelText('URL'), 'https://example.com/v2/mcp');
    await user.click(screen.getByRole('radio', { name: /clear saved url\.query\.token/i }));
    expect(screen.getByText('Unsaved changes', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview change/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /preview change/i }));

    expect(onPreviewServerEdit).toHaveBeenCalledWith(
      'github',
      {
        transport: { url: 'https://example.com/v2/mcp' },
        secrets: [{ fieldPath: ['url', 'query', 'token'], action: 'clear' }],
      },
      'auto',
    );
  });

  it('explains how to start editing when no configured server is selected', () => {
    renderApp(consoleState());

    expect(screen.getByText(/Select Edit server to change target settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Edit fields -> Preview change -> Review result/i)).toBeInTheDocument();
  });

  it('normalizes configured-server structured edit controls without raw JSON', async () => {
    const user = userEvent.setup();
    const onPreviewServerEdit = vi.fn();

    renderApp(consoleState(), {
      serverDetail: configuredServerDetailState({
        fieldGroups: [
          {
            id: 'identity',
            label: 'Target',
            fields: [
              { fieldPath: ['id'], label: 'Target ID', control: 'text', value: 'github', editable: true },
              { fieldPath: ['enabled'], label: 'Enabled', control: 'switch', value: true, editable: true },
              { fieldPath: ['tags'], label: 'Tags', control: 'tag-list', value: ['remote', 'oauth'], editable: true },
            ],
          },
          {
            id: 'transport',
            label: 'Transport',
            fields: [
              {
                fieldPath: ['transport', 'type'],
                label: 'Transport Type',
                control: 'select',
                value: 'http',
                options: ['stdio', 'http', 'sse'],
                editable: true,
              },
              {
                fieldPath: ['transport', 'args'],
                label: 'Args',
                control: 'string-list',
                value: ['--old'],
                editable: true,
              },
              {
                fieldPath: ['transport', 'headers'],
                label: 'Headers',
                control: 'record',
                value: { 'X-Feature': 'old' },
                editable: true,
              },
            ],
          },
          {
            id: 'secrets',
            label: 'Secrets',
            fields: [
              {
                fieldPath: ['headers', 'authorization'],
                label: 'headers.authorization',
                control: 'secret',
                editable: true,
                secret: {
                  state: 'present',
                  defaultAction: 'preserve',
                  allowedActions: ['preserve', 'replace', 'clear'],
                  environmentReference: {
                    supported: true,
                    recommended: true,
                    valueFormat: 'env_var_name_or_substitution',
                    storesSecretMaterial: false,
                    guidance: 'Keep secret material in the runtime environment.',
                  },
                  inlineReplacement: {
                    supported: true,
                    emphasis: 'secondary',
                    guidance: 'Use inline replacement only when an environment reference is not suitable.',
                  },
                },
              },
            ],
          },
        ],
      }),
      onPreviewServerEdit,
    });

    await user.clear(screen.getByLabelText('Target ID'));
    await user.type(screen.getByLabelText('Target ID'), 'github-v2');
    await user.click(screen.getByRole('switch', { name: 'Enabled' }));
    await user.type(screen.getByRole('textbox', { name: 'Tags' }), 'beta{Enter}');
    await user.selectOptions(screen.getByLabelText('Transport Type'), 'sse');
    fireEvent.change(screen.getByLabelText('Args'), { target: { value: '--one\n--two' } });
    expect(screen.getByRole('button', { name: /remove headers x-feature/i })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Headers X-Feature'));
    await user.type(screen.getByLabelText('Headers X-Feature'), 'new');
    await user.click(screen.getByRole('radio', { name: /replace headers\.authorization/i }));
    await user.click(screen.getByRole('button', { name: /use advanced inline secret/i }));
    expect(
      screen
        .getAllByRole('alert')
        .some((alert) => /stores secret material in configuration/i.test(alert.textContent ?? '')),
    ).toBe(true);
    await user.type(screen.getByLabelText(/inline secret for headers\.authorization/i), 'raw-secret');
    await user.click(screen.getByRole('button', { name: /preview change/i }));

    expect(screen.queryByRole('textbox', { name: /raw json/i })).not.toBeInTheDocument();
    expect(onPreviewServerEdit).toHaveBeenCalledWith(
      'github',
      {
        id: 'github-v2',
        enabled: false,
        tags: ['remote', 'oauth', 'beta'],
        transport: {
          type: 'sse',
          args: ['--one', '--two'],
          headers: { 'X-Feature': 'new' },
        },
        secrets: [
          {
            fieldPath: ['headers', 'authorization'],
            action: 'replace',
            replacement: { kind: 'inlineSecret', value: 'raw-secret' },
          },
        ],
      },
      'auto',
    );
  });

  it('passes dirty state when closing a modified configured-server detail form', async () => {
    const user = userEvent.setup();
    const onCloseServerDetail = vi.fn();

    renderApp(consoleState(), {
      serverDetail: configuredServerDetailState(),
      onCloseServerDetail,
    });

    await user.clear(screen.getByLabelText('URL'));
    await user.type(screen.getByLabelText('URL'), 'https://example.com/v2/mcp');
    await user.click(screen.getByRole('button', { name: /^back$/i }));

    expect(onCloseServerDetail).toHaveBeenCalledWith(true);
  });

  it('reruns preview connectivity on demand after a preview exists', async () => {
    const user = userEvent.setup();
    const onPreviewServerEdit = vi.fn();

    renderApp(consoleState(), {
      serverDetail: {
        ...configuredServerDetailState(),
        preview: {
          targetName: 'github',
          proposedTargetName: 'github',
          previewFingerprint: 'preview_123',
          validation: { status: 'valid', errors: [] },
          diff: [],
          configChange: {
            status: 'unchanged',
            operation: 'set_static',
            target: { name: 'github', source: 'mcpServers' },
            changed: false,
            backup: { created: false },
            retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
            reload: { status: 'skipped' },
            warnings: [],
          },
          connectivityCheck: { status: 'skipped', reason: 'connection_critical_fields_unchanged' },
        },
      },
      onPreviewServerEdit,
    });

    await user.click(screen.getByRole('button', { name: /rerun connectivity/i }));

    expect(onPreviewServerEdit).toHaveBeenCalledWith('github', {}, 'manual');
  });

  it('renders preview validation, diff, config-change, and connectivity facts', () => {
    renderApp(consoleState(), {
      serverDetail: {
        ...configuredServerDetailState(),
        preview: {
          targetName: 'github',
          proposedTargetName: 'github',
          previewFingerprint: 'preview_123',
          validation: {
            status: 'invalid',
            errors: [{ fieldPath: ['transport', 'url'], code: 'invalid_url', message: 'URL is invalid.' }],
          },
          diff: [
            {
              fieldPath: ['transport', 'url'],
              oldValue: 'https://example.com/mcp?token=REDACTED',
              newValue: 'not-a-url',
              riskFlags: ['connection_critical'],
            },
          ],
          configChange: {
            status: 'unchanged',
            operation: 'set_static',
            target: { name: 'github', source: 'mcpServers' },
            changed: false,
            backup: { created: false },
            retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
            reload: { status: 'skipped' },
            warnings: [],
          },
          connectivityCheck: { status: 'skipped', reason: 'validation_failed' },
        },
      },
    });

    expect(screen.getByText('preview_123')).toBeInTheDocument();
    expect(screen.getByText(/Preview only - no config has been written/i)).toBeInTheDocument();
    expect(screen.getByText('invalid')).toBeInTheDocument();
    expect(screen.getByText(/set_static \/ unchanged/i)).toBeInTheDocument();
    expect(screen.getByText(/Validation failed before a connectivity check could run/i)).toBeInTheDocument();
    expect(screen.getAllByText('transport.url').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/from/i)).toBeInTheDocument();
    expect(screen.getAllByText(/https:\/\/example\.com\/mcp\?token=REDACTED/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/not-a-url/i)).toBeInTheDocument();
    expect(screen.getByText(/connection critical/i)).toBeInTheDocument();
  });

  it('keeps legacy configured-server rows usable while read-model fields roll forward', async () => {
    const user = userEvent.setup();
    const onServerAction = vi.fn();

    renderApp(
      {
        ...consoleState(),
        configuredServers: [
          {
            id: 'legacy',
            source: 'mcpServers',
            enabled: false,
            transport: { type: 'stdio', command: 'node' },
            secretInputs: [],
          } as any,
        ],
      },
      { onServerAction },
    );

    expect(screen.getByText('node')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /enable legacy/i }));
    expect(onServerAction).toHaveBeenCalledWith('legacy', 'enable');
  });

  it('disables server actions when the read model marks mutations unavailable', async () => {
    const user = userEvent.setup();
    const onServerAction = vi.fn();

    renderApp(
      {
        ...consoleState(),
        configuredServers: [
          {
            id: 'locked',
            source: 'mcpServers',
            target: { type: 'configured_server', id: 'locked', source: 'mcpServers' },
            enabled: false,
            tags: [],
            transportSummary: { kind: 'http', label: 'https://example.com/mcp' },
            mutationAvailability: { available: false, operations: ['enable', 'disable'] },
            actionState: {
              enable: { available: true, label: 'Enable locked' },
              disable: { available: false, label: 'Disable locked', disabledReason: 'already_disabled' },
            },
            transport: { type: 'http', url: 'https://example.com/mcp' },
            secretInputs: [],
          },
        ],
      },
      { onServerAction },
    );

    const button = screen.getByRole('button', { name: /enable locked/i });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onServerAction).not.toHaveBeenCalled();
  });

  it('submits login, logout, refresh, and direct disable actions through callbacks', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    const onLogout = vi.fn();
    const onRefresh = vi.fn();
    const onServerAction = vi.fn();

    const { rerender } = renderApp(
      { ...createInitialState(), view: 'login' },
      { onLogin, onLogout, onRefresh, onServerAction },
    );

    await user.type(screen.getByLabelText(/username/i), 'operator');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /log in/i }));
    expect(onLogin).toHaveBeenCalledWith({ username: 'operator', password: 'correct horse battery staple' });

    rerender(
      <MantineProvider>
        <AdminConsoleApp
          state={consoleState()}
          onLogin={onLogin}
          onLogout={onLogout}
          onRefresh={onRefresh}
          onServerAction={onServerAction}
        />
      </MantineProvider>,
    );

    await user.click(screen.getByRole('button', { name: /refresh/i }));
    await user.click(screen.getByRole('button', { name: /disable filesystem/i }));
    await user.click(screen.getByRole('button', { name: /log out/i }));

    expect(onRefresh).toHaveBeenCalled();
    expect(onServerAction).toHaveBeenCalledWith('filesystem', 'disable');
    expect(onLogout).toHaveBeenCalled();
  });
});

function renderApp(state: AdminConsoleState, callbacks: Partial<ComponentProps<typeof AdminConsoleApp>> = {}) {
  return render(
    <MantineProvider>
      <AdminConsoleApp state={state} {...callbacks} />
    </MantineProvider>,
  );
}

function consoleState(): AdminConsoleState {
  return {
    ...createInitialState(),
    view: 'console',
    session: {
      authenticated: true,
      account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
      csrfToken: 'csrf_123',
      expiresAt: '2026-07-07T01:00:00.000Z',
    },
    status: {
      ok: true,
      runtime: {
        identityProtocolVersion: '1',
        runtimeScopeId: 'scope_123',
        externalUrl: 'https://runtime.example.com',
        runtimeVersion: '1.2.3',
      },
      session: {
        authenticated: true,
        account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
        expiresAt: '2026-07-07T01:00:00.000Z',
      },
      oauth: {
        status: 'ready',
        services: [
          {
            name: 'github',
            status: 'awaiting_oauth',
            requiresOAuth: true,
            lastError: 'token: [REDACTED]',
          },
        ],
      },
      audit: {
        facts: [
          {
            timestamp: '2026-07-07T00:00:00.000Z',
            operationId: 'op_1',
            operationName: 'enableConfiguredServer',
            result: 'failed',
            target: { type: 'configured_server', id: 'filesystem' },
            request: { requestId: 'req_1' },
          },
        ],
      },
    },
    configuredServers: [
      {
        id: 'filesystem',
        source: 'mcpServers',
        target: { type: 'configured_server', id: 'filesystem', source: 'mcpServers' },
        enabled: true,
        tags: ['local', 'storage'],
        transportSummary: {
          kind: 'stdio',
          label: 'npx -y @modelcontextprotocol/server-filesystem /tmp/project',
        },
        mutationAvailability: { available: true, operations: ['enable', 'disable'] },
        actionState: {
          enable: { available: false, label: 'Enable filesystem', disabledReason: 'already_enabled' },
          disable: { available: true, label: 'Disable filesystem' },
        },
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project'],
        },
        secretInputs: [],
      },
      {
        id: 'github',
        source: 'mcpServers',
        target: { type: 'configured_server', id: 'github', source: 'mcpServers' },
        enabled: false,
        tags: [],
        transportSummary: {
          kind: 'http',
          label: 'https://example.com/mcp?token=REDACTED',
        },
        mutationAvailability: { available: true, operations: ['enable', 'disable'] },
        actionState: {
          enable: { available: true, label: 'Enable github' },
          disable: { available: false, label: 'Disable github', disabledReason: 'already_disabled' },
        },
        transport: { type: 'http', url: 'https://example.com/mcp?token=REDACTED' },
        secretInputs: [{ fieldPath: ['url', 'query', 'token'], label: 'url.query.token', state: 'present' }],
      },
    ],
    lastUpdatedAt: '00:01:02',
  };
}

function configuredServerDetailState(
  overrides: Partial<
    NonNullable<ComponentProps<typeof AdminConsoleApp>['serverDetail']>['detail']['editContract']
  > = {},
): ComponentProps<typeof AdminConsoleApp>['serverDetail'] {
  const server = {
    id: 'github',
    source: 'mcpServers',
    target: { type: 'configured_server' as const, id: 'github', source: 'mcpServers' as const },
    enabled: true,
    tags: ['remote'],
    transportSummary: { kind: 'http', label: 'https://example.com/mcp?token=REDACTED' },
    mutationAvailability: { available: true, operations: ['enable' as const, 'disable' as const] },
    actionState: {
      enable: { available: false, label: 'Enable github', disabledReason: 'already_enabled' as const },
      disable: { available: true, label: 'Disable github' },
    },
    transport: { type: 'http', url: 'https://example.com/mcp?token=REDACTED' },
    secretInputs: [{ fieldPath: ['url', 'query', 'token'], label: 'url.query.token', state: 'present' as const }],
  };

  return {
    status: 'loaded',
    serverId: 'github',
    previewBusy: false,
    detail: {
      ok: true,
      operationId: 'op_detail',
      server,
      editContract: {
        schemaVersion: 1,
        target: server.target,
        capabilities: {
          singleTargetEdit: true,
          rename: { supported: true },
          create: { supported: false },
          delete: { supported: false },
          bulkEdit: { supported: false },
          rawJson: { supported: false },
          preview: { supported: true },
          apply: { supported: false },
        },
        fieldGroups: [
          {
            id: 'transport',
            label: 'Transport',
            fields: [
              {
                fieldPath: ['transport', 'url'],
                label: 'URL',
                control: 'text',
                value: 'https://example.com/mcp?token=REDACTED',
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
                control: 'secret',
                editable: true,
                secret: {
                  state: 'present',
                  defaultAction: 'preserve',
                  allowedActions: ['preserve', 'replace', 'clear'],
                  environmentReference: {
                    supported: true,
                    recommended: true,
                    valueFormat: 'env_var_name_or_substitution',
                    storesSecretMaterial: false,
                    guidance:
                      'Store only the environment variable name or substitution expression; keep secret material outside 1MCP config.',
                  },
                  inlineReplacement: {
                    supported: true,
                    emphasis: 'secondary',
                    guidance:
                      'Use inline replacement only as a secondary path when an environment reference is not suitable.',
                  },
                },
              },
            ],
          },
        ],
        ...overrides,
      },
    },
  };
}
