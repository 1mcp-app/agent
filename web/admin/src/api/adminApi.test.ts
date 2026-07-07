import { describe, expect, it } from 'vitest';

import { AdminApiError, createAdminApi } from './adminApi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('admin API client', () => {
  it('logs in and loads the current session through same-origin admin endpoints', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const api = createAdminApi({
      fetch: async (input, init) => {
        calls.push({ input, init });
        if (input === '/admin/api/session/login') {
          return jsonResponse({
            authenticated: true,
            account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
            csrfToken: 'csrf_123',
            expiresAt: '2026-07-07T01:00:00.000Z',
          });
        }
        return jsonResponse({ authenticated: false, adminStatus: 'setupRequired' }, 401);
      },
    });

    const login = await api.login({ username: 'operator', password: 'correct horse battery staple' });
    await expect(api.getSession()).rejects.toMatchObject({
      status: 401,
      body: { authenticated: false, adminStatus: 'setupRequired' },
    });

    expect(login.account.username).toBe('operator');
    expect(calls[0]).toMatchObject({
      input: '/admin/api/session/login',
      init: {
        method: 'POST',
        body: JSON.stringify({ username: 'operator', password: 'correct horse battery staple' }),
      },
    });
    expect(calls[1]).toMatchObject({ input: '/admin/api/session' });
  });

  it('sends CSRF and idempotency headers for enable and disable mutations', async () => {
    const calls: RequestInit[] = [];
    const api = createAdminApi({
      idempotencyKey: ({ action, targetName }) => `key-${action}-${targetName}`,
      fetch: async (_input, init) => {
        calls.push(init ?? {});
        return jsonResponse({ ok: true, operationId: 'op_1', result: { targetName: 'filesystem' } });
      },
    });

    await api.setConfiguredServerEnabled({
      name: 'filesystem',
      enabled: true,
      csrfToken: 'csrf_123',
    });
    await api.setConfiguredServerEnabled({
      name: 'filesystem',
      enabled: false,
      csrfToken: 'csrf_456',
    });

    expect(calls[0].headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf_123',
      'Idempotency-Key': 'key-enable-filesystem',
    });
    expect(calls[1].headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf_456',
      'Idempotency-Key': 'key-disable-filesystem',
    });
  });

  it('keeps default idempotency keys valid for hostile configured-server ids', async () => {
    const calls: RequestInit[] = [];
    const api = createAdminApi({
      fetch: async (_input, init) => {
        calls.push(init ?? {});
        return jsonResponse({ ok: true });
      },
    });

    await api.setConfiguredServerEnabled({
      name: 'hostile\r\nInjected: value',
      enabled: true,
      csrfToken: 'csrf_123',
    });

    expect(calls[0].headers).toMatchObject({
      'X-CSRF-Token': 'csrf_123',
      'Idempotency-Key': expect.stringMatching(/^admin-console-enable-hostile%0D%0AInjected%3A%20value-\d+-/),
    });
  });

  it('raises typed API errors with parsed response bodies', async () => {
    const api = createAdminApi({
      fetch: async () => jsonResponse({ error: 'csrf_required' }, 403),
    });

    await expect(api.logout('bad_csrf')).rejects.toBeInstanceOf(AdminApiError);
    await expect(api.logout('bad_csrf')).rejects.toMatchObject({
      status: 403,
      body: { error: 'csrf_required' },
      message: 'csrf_required',
    });
  });
});
