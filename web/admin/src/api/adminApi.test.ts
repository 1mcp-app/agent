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

  it('loads configured-server detail with an encoded target id', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const api = createAdminApi({
      fetch: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse({
          ok: true,
          operationId: 'op_detail',
          server: {
            id: 'github/api server',
            source: 'mcpServers',
            target: { type: 'configured_server', id: 'github/api server', source: 'mcpServers' },
            enabled: true,
            tags: [],
            transportSummary: { kind: 'http', label: 'https://api.example.com/mcp?token=REDACTED' },
            mutationAvailability: { available: true, operations: ['enable', 'disable'] },
            actionState: {
              enable: { available: false, label: 'Enable github/api server', disabledReason: 'already_enabled' },
              disable: { available: true, label: 'Disable github/api server' },
            },
            transport: {
              url: 'https://api.example.com/mcp?token=REDACTED',
            },
            secretInputs: [],
          },
          editContract: {
            schemaVersion: 1,
            target: { type: 'configured_server', id: 'github/api server', source: 'mcpServers' },
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
            fieldGroups: [],
          },
        });
      },
    });

    const detail = await api.getConfiguredServerDetail('github/api server');

    expect(calls[0]).toMatchObject({
      input: '/admin/api/configured-servers/github%2Fapi%20server',
    });
    expect(detail).toMatchObject({
      operationId: 'op_detail',
      server: { id: 'github/api server' },
      editContract: {
        capabilities: {
          rename: { supported: true },
          rawJson: { supported: false },
        },
      },
    });
  });

  it('previews configured-server edits with CSRF and without an idempotency key', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const api = createAdminApi({
      fetch: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse({
          ok: true,
          operationId: 'op_preview',
          preview: {
            targetName: 'github/api server',
            proposedTargetName: 'github-renamed',
            previewFingerprint: 'preview_123',
            validation: { status: 'valid', errors: [] },
            diff: [],
            configChange: {
              status: 'unchanged',
              operation: 'set_static',
              configPath: '[redacted]',
              target: { name: 'github/api server', source: 'mcpServers' },
              changed: false,
              backup: { created: false },
              retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
              reload: { status: 'skipped' },
              warnings: [],
            },
            connectivityCheck: { status: 'skipped', reason: 'connection_critical_fields_unchanged' },
          },
        });
      },
    });

    const response = await api.previewConfiguredServerEdit({
      name: 'github/api server',
      csrfToken: 'csrf_123',
      idempotencyKey: 'apply-attempt-123',
      connectivityCheck: 'manual',
      edit: {
        id: 'github-renamed',
        secrets: [
          {
            fieldPath: ['headers', 'Authorization'],
            action: 'replace',
            replacement: { kind: 'inlineSecret', value: 'raw-preview-only-secret' },
          },
        ],
      },
    });

    expect(calls[0]).toMatchObject({
      input: '/admin/api/configured-servers/github%2Fapi%20server/preview',
      init: {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'csrf_123',
        },
      },
    });
    expect(calls[0].init?.headers).not.toHaveProperty('Idempotency-Key');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      connectivityCheck: 'manual',
      edit: {
        id: 'github-renamed',
        secrets: [
          {
            fieldPath: ['headers', 'Authorization'],
            action: 'replace',
            replacement: { kind: 'inlineSecret', value: 'raw-preview-only-secret' },
          },
        ],
      },
    });
    expect(response.preview.previewFingerprint).toBe('preview_123');
  });

  it('applies a confirmed configured-server preview with CSRF and idempotency', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const api = createAdminApi({
      fetch: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse({
          ok: true,
          operationId: 'op_apply',
          result: {
            originalTargetName: 'github/api server',
            targetName: 'github-renamed',
            previewFingerprint: 'preview_123',
            configChange: {},
          },
        });
      },
    });

    await api.applyConfiguredServerEdit({
      name: 'github/api server',
      csrfToken: 'csrf_123',
      idempotencyKey: 'apply-attempt-123',
      edit: { id: 'github-renamed' },
      previewFingerprint: 'preview_123',
      confirmationFacts: { previewConfirmed: 'preview_123', targetNameConfirmed: 'github-renamed' },
    });

    expect(calls[0]).toMatchObject({
      input: '/admin/api/configured-servers/github%2Fapi%20server/apply',
      init: {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'csrf_123',
          'Idempotency-Key': 'apply-attempt-123',
        },
      },
    });
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      edit: { id: 'github-renamed' },
      previewFingerprint: 'preview_123',
      confirmationFacts: { previewConfirmed: 'preview_123', targetNameConfirmed: 'github-renamed' },
    });
  });

  it('maps configured-server apply conflicts to actionable operator copy', async () => {
    const api = createAdminApi({
      fetch: async () =>
        jsonResponse(
          {
            ok: false,
            error: 'configured_server_stale_preview',
            message: 'The configured server changed after preview.',
          },
          409,
        ),
    });

    await expect(
      api.applyConfiguredServerEdit({
        name: 'github',
        csrfToken: 'csrf',
        idempotencyKey: 'apply-1',
        edit: { enabled: true },
        previewFingerprint: 'stale',
        confirmationFacts: { previewConfirmed: 'stale' },
      }),
    ).rejects.toMatchObject({
      failure: {
        kind: 'rejected',
        code: 'configured_server_stale_preview',
        message: 'The server changed after this preview. Preview the edit again before applying.',
      },
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

  it('attaches classified operation facts to adapter errors', () => {
    expect(
      new AdminApiError(401, { error: 'invalid_credentials', requestId: 'req_login' }, 'invalid_credentials').failure,
    ).toEqual({
      kind: 'unauthenticated',
      adminStatus: 'loginRequired',
      code: 'invalid_credentials',
      message: 'Check the admin username and password, then try again. Request ID: req_login',
      requestId: 'req_login',
      status: 401,
    });

    expect(
      new AdminApiError(404, { code: 'configured_server_not_found' }, 'configured_server_not_found').failure,
    ).toMatchObject({ kind: 'configuredServerNotFound', code: 'configured_server_not_found', status: 404 });
  });

  it('classifies fetch failures before they cross the adapter seam', async () => {
    const api = createAdminApi({
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });

    await expect(api.getStatus()).rejects.toMatchObject({
      failure: {
        kind: 'unavailable',
        message:
          'The Admin Console could not reach the runtime. Check that the runtime is still available, then refresh.',
      },
    });
  });
});
