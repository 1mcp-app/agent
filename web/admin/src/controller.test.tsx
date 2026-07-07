import { MantineProvider } from '@mantine/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AdminApiError } from './api/adminApi';
import type { AdminApiClient } from './api/adminApi';
import { AdminConsoleRoot } from './controller';

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
    expect(screen.getByText('filesystem')).toBeInTheDocument();

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
    expect(screen.getByText('1mcp admin bootstrap')).toBeInTheDocument();
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
        throw new Error('connect ECONNREFUSED /Users/x/.1mcp/config.json');
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
    setConfiguredServerEnabled: vi.fn(),
    ...overrides,
  };
}
