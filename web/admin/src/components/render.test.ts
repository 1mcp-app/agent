import { describe, expect, it } from 'vitest';

import { createInitialState } from '../state/adminConsoleState';
import { renderApp } from './render';

describe('admin console rendering', () => {
  it('renders setup-required guidance without account-management controls', () => {
    const html = renderApp({
      ...createInitialState(),
      view: 'setupRequired',
    });

    expect(html).toContain('Setup required');
    expect(html).toContain('1mcp admin bootstrap');
    expect(html).not.toMatch(/create account|disable account|delete account|password reset/i);
  });

  it('renders login state with no admin account management controls', () => {
    const html = renderApp({
      ...createInitialState(),
      view: 'login',
    });

    expect(html).toContain('id="login-form"');
    expect(html).toContain('autocomplete="username"');
    expect(html).not.toMatch(/create account|disable account|delete account|password reset/i);
  });

  it('keeps the loading login form inert while session detection runs', () => {
    const html = renderApp(createInitialState());

    expect(html).toContain('Checking session');
    expect(html).toMatch(/id="login-username"[^>]*disabled/);
    expect(html).toMatch(/id="login-password"[^>]*disabled/);
    expect(html).toMatch(/type="submit"[^>]*disabled/);
  });

  it('renders runtime, OAuth, audit, and configured-server controls for operators', () => {
    const html = renderApp({
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
              result: 'completed',
              target: { type: 'configured_server', id: 'filesystem' },
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
      serverMutations: {
        github: { state: 'failed', message: 'Reload failed' },
      },
      banner: { kind: 'success', message: 'Server enable completed.' },
      lastUpdatedAt: '00:01:02',
    });

    expect(html).toContain('Runtime operations');
    expect(html).toContain('scope_123');
    expect(html).toContain('1.2.3');
    expect(html).toContain('github');
    expect(html).toContain('awaiting_oauth');
    expect(html).toContain('enableConfiguredServer');
    expect(html).toContain('filesystem');
    expect(html).toContain('data-action="disable"');
    expect(html).toContain('data-action="enable"');
    expect(html).toContain('server-action-error');
    expect(html).toContain('Reload failed');
    expect(html).toContain('Server enable completed.');
  });

  it('renders detail rows with a layout class that keeps long values truncatable', () => {
    const html = renderApp({
      ...createInitialState(),
      view: 'console',
      status: {
        ok: true,
        runtime: {
          identityProtocolVersion: '1',
          runtimeScopeId: 'scope_with_a_very_long_identifier_that_must_not_force_horizontal_overflow',
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
              status: 'awaiting_oauth_with_a_very_long_status_value',
              requiresOAuth: true,
            },
          ],
        },
        audit: { facts: [] },
      },
    });

    expect(html).toContain('class="row detail-row"');
    expect(html).toContain('scope_with_a_very_long_identifier');
    expect(html).toContain('awaiting_oauth_with_a_very_long_status_value');
  });

  it('renders empty and error states without layout-only blanks', () => {
    const html = renderApp({
      ...createInitialState(),
      view: 'console',
      error: 'Session loaded, but refresh failed: network',
      configuredServers: [],
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
    });

    expect(html).toContain('No configured servers.');
    expect(html).toContain('No OAuth services reported.');
    expect(html).toContain('No recent admin audit facts.');
    expect(html).toContain('Session loaded, but refresh failed: network');
    expect(html).toContain('role="alert"');
  });

  it('escapes untrusted values before rendering', () => {
    const html = renderApp({
      ...createInitialState(),
      view: 'console',
      configuredServers: [
        {
          id: '<script>alert(1)</script>',
          source: 'mcpServers',
          enabled: true,
          transport: { command: '<img src=x onerror=alert(1)>' },
          secretInputs: [],
        },
      ],
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
