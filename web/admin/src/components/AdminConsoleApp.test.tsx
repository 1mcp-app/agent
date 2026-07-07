import { MantineProvider } from '@mantine/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ComponentProps } from 'react';
import { vi } from 'vitest';

import type { AdminConsoleState } from '../state/adminConsoleState';
import { createInitialState } from '../state/adminConsoleState';
import { AdminConsoleApp } from './AdminConsoleApp';

describe('AdminConsoleApp', () => {
  it('renders setup-required guidance inside the operations shell', () => {
    render(
      <MantineProvider>
        <AdminConsoleApp state={{ ...createInitialState(), view: 'setupRequired' }} />
      </MantineProvider>,
    );

    expect(screen.getByRole('banner', { name: /admin console/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /setup required/i })).toBeInTheDocument();
    expect(screen.getByText('1mcp admin bootstrap')).toBeInTheDocument();
  });

  it('renders login and loading states without account-management controls', () => {
    const { rerender } = renderApp({ ...createInitialState(), view: 'login' });

    expect(screen.getByRole('heading', { name: /operator login/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByText(/create account|disable account|delete account|password reset/i)).not.toBeInTheDocument();

    rerender(
      <MantineProvider>
        <AdminConsoleApp state={createInitialState()} />
      </MantineProvider>,
    );

    expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled();
    expect(screen.getByLabelText(/username/i)).toBeDisabled();
  });

  it('shows runtime, OAuth, audit, counters, search, and enabled filtering', async () => {
    const user = userEvent.setup();
    const onServerAction = vi.fn();
    const onCopyText = vi.fn();

    renderApp(consoleState(), { onServerAction, onCopyText });

    expect(screen.getByText('Enabled servers')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('Disabled servers')).toBeInTheDocument();
    expect(screen.getByText('OAuth attention')).toBeInTheDocument();
    expect(screen.getByText('Failed audits')).toBeInTheDocument();
    expect(screen.getByText('https://runtime.example.com')).toBeInTheDocument();
    expect(screen.getByText('scope_123')).toBeInTheDocument();
    expect(screen.getAllByText('github').length).toBeGreaterThanOrEqual(2);
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
        enabled: true,
        transport: { type: 'stdio', command: 'npx' },
        secretInputs: [],
      },
      {
        id: 'github',
        source: 'mcpServers',
        enabled: false,
        transport: { type: 'http', url: 'https://example.com/mcp?token=REDACTED' },
        secretInputs: [{ fieldPath: ['url', 'query', 'token'], label: 'url.query.token', state: 'present' }],
      },
    ],
    lastUpdatedAt: '00:01:02',
  };
}
