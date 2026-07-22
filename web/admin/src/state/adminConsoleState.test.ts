import { describe, expect, it } from 'vitest';

import { createInitialState, reduceAdminConsoleState } from './adminConsoleState';

describe('admin console state', () => {
  it('moves unauthenticated setup-required sessions into setup view', () => {
    const state = reduceAdminConsoleState(createInitialState(), {
      type: 'sessionUnauthenticated',
      adminStatus: 'setupRequired',
    });

    expect(state.view).toBe('setupRequired');
    expect(state.session).toBeNull();
  });

  it('moves unauthenticated login-required sessions into login view', () => {
    const state = reduceAdminConsoleState(createInitialState(), {
      type: 'sessionUnauthenticated',
      adminStatus: 'loginRequired',
    });

    expect(state.view).toBe('login');
  });

  it('clears session-scoped console data when the session becomes unauthenticated', () => {
    const authenticated = reduceAdminConsoleState(createInitialState(), {
      type: 'sessionLoaded',
      session: {
        authenticated: true,
        account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
        csrfToken: 'csrf_123',
        expiresAt: '2026-07-07T01:00:00.000Z',
      },
    });
    const refreshed = reduceAdminConsoleState(authenticated, {
      type: 'refreshSucceeded',
      status: {
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
      },
      configuredServers: [
        {
          id: 'filesystem',
          source: 'mcpServers',
          enabled: true,
          transport: { type: 'stdio' },
          secretInputs: [],
        },
      ],
      updatedAt: '00:01:02',
    });
    const loggedOut = reduceAdminConsoleState(
      {
        ...refreshed,
        serverMutations: { filesystem: { state: 'busy', action: 'disable' } },
      },
      {
        type: 'sessionUnauthenticated',
        adminStatus: 'loginRequired',
      },
    );

    expect(loggedOut.view).toBe('login');
    expect(loggedOut.session).toBeNull();
    expect(loggedOut.status).toBeNull();
    expect(loggedOut.configuredServers).toEqual([]);
    expect(loggedOut.serverMutations).toEqual({});
  });

  it('stores authenticated session and refresh data for console view', () => {
    const withSession = reduceAdminConsoleState(createInitialState(), {
      type: 'sessionLoaded',
      session: {
        authenticated: true,
        account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
        csrfToken: 'csrf_123',
        expiresAt: '2026-07-07T01:00:00.000Z',
      },
    });
    const refreshed = reduceAdminConsoleState(withSession, {
      type: 'refreshSucceeded',
      status: {
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
      },
      configuredServers: [
        {
          id: 'filesystem',
          source: 'mcpServers',
          enabled: true,
          transport: { type: 'stdio' },
          secretInputs: [],
        },
      ],
      updatedAt: '00:01:02',
    });

    expect(refreshed.view).toBe('console');
    expect(refreshed.session?.csrfToken).toBe('csrf_123');
    expect(refreshed.status?.runtime.runtimeScopeId).toBe('scope_123');
    expect(refreshed.configuredServers).toHaveLength(1);
    expect(refreshed.lastUpdatedAt).toBe('00:01:02');
  });

  it('clears stale error banners after successful session and status recovery', () => {
    const failedLogin = reduceAdminConsoleState(createInitialState(), {
      type: 'loginFailed',
      message: 'Login failed',
    });
    const withSession = reduceAdminConsoleState(failedLogin, {
      type: 'sessionLoaded',
      session: {
        authenticated: true,
        account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
        csrfToken: 'csrf_123',
        expiresAt: '2026-07-07T01:00:00.000Z',
      },
    });
    const failedRefresh = reduceAdminConsoleState(withSession, {
      type: 'refreshFailed',
      message: 'network failed',
    });
    const recovered = reduceAdminConsoleState(failedRefresh, {
      type: 'refreshSucceeded',
      status: {
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
      },
      configuredServers: [],
      updatedAt: '00:01:02',
    });

    expect(withSession.banner).toBeNull();
    expect(withSession.error).toBeNull();
    expect(recovered.banner).toBeNull();
    expect(recovered.error).toBeNull();
  });

  it('keeps mutation success feedback local to the affected server row', () => {
    const succeeded = reduceAdminConsoleState(createInitialState(), {
      type: 'mutationSucceeded',
      serverId: 'filesystem',
      action: 'disable',
    });
    const refreshed = reduceAdminConsoleState(succeeded, {
      type: 'refreshSucceeded',
      status: {
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
      },
      configuredServers: [],
      updatedAt: '00:01:02',
    });

    expect(refreshed.banner).toBeNull();
    expect(refreshed.serverMutations.filesystem).toEqual({
      state: 'succeeded',
      action: 'disable',
      message: 'Server disable completed.',
    });
  });

  it('tracks mutation busy, success, and failure states by server id', () => {
    const busy = reduceAdminConsoleState(createInitialState(), {
      type: 'mutationStarted',
      serverId: 'filesystem',
      action: 'enable',
    });
    const success = reduceAdminConsoleState(busy, {
      type: 'mutationSucceeded',
      serverId: 'filesystem',
      action: 'enable',
    });
    const failed = reduceAdminConsoleState(success, {
      type: 'mutationFailed',
      serverId: 'github',
      action: 'disable',
      message: 'reload failed',
    });

    expect(busy.serverMutations.filesystem).toEqual({ state: 'busy', action: 'enable' });
    expect(success.serverMutations.filesystem).toEqual({
      state: 'succeeded',
      action: 'enable',
      message: 'Server enable completed.',
    });
    expect(failed.serverMutations.github).toEqual({
      state: 'failed',
      action: 'disable',
      message: 'reload failed',
    });
  });
});
