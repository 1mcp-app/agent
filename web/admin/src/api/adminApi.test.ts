import { describe, expect, it, vi } from 'vitest';

import { AdminApiError, type AdminLogEventSource, createAdminApi } from './adminApi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('admin API client', () => {
  it('manages instruction-template drafts through explicit lifecycle routes', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const api = createAdminApi({
      fetch: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse({ result: { templates: [], previewFingerprint: 'preview_1' } });
      },
    });
    const draft = {
      identity: 'focused',
      variants: { initialization: 'Initialize {{server_instructions}}', cli: 'CLI {{server_instructions}}' },
    };

    await api.listInstructionTemplates();
    await api.saveInstructionTemplate({
      action: 'create',
      draft,
      expectedConfigFingerprint: 'config_1',
      csrfToken: 'csrf_123',
    });
    await api.previewInstructionTemplate({
      identity: 'focused',
      surface: 'cli',
      selection: { mode: 'tags', tags: ['filesystem'] },
      requestContext: { project: { name: 'docs' } },
      csrfToken: 'csrf_123',
    });
    await api.activateInstructionTemplate({
      identity: 'focused',
      expectedConfigFingerprint: 'config_1',
      previewFingerprint: 'preview_1',
      csrfToken: 'csrf_123',
    });

    expect(calls).toMatchObject([
      { input: '/admin/api/instruction-templates' },
      {
        input: '/admin/api/instruction-templates',
        init: {
          method: 'POST',
          headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf_123' }),
          body: JSON.stringify({
            identity: 'focused',
            variants: draft.variants,
            expectedConfigFingerprint: 'config_1',
          }),
        },
      },
      {
        input: '/admin/api/instruction-templates/focused/preview',
        init: {
          method: 'POST',
          body: JSON.stringify({
            surface: 'cli',
            selection: { mode: 'tags', tags: ['filesystem'] },
            requestContext: { project: { name: 'docs' } },
          }),
        },
      },
      {
        input: '/admin/api/instruction-templates/focused/activate',
        init: {
          method: 'POST',
          body: JSON.stringify({ expectedConfigFingerprint: 'config_1', previewFingerprint: 'preview_1' }),
        },
      },
    ]);
  });

  it('addresses configured targets by source and sends explicit instruction override mutations', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const api = createAdminApi({
      fetch: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse({ ok: true, operationId: 'op_1', result: {} });
      },
    });

    await api.getConfiguredServerDetail({ source: 'mcpTemplates', id: 'github/api' });
    await api.setConfiguredServerInstructionOverride({
      target: { source: 'mcpTemplates', id: 'github/api' },
      mutation: { action: 'set', value: '' },
      expectedSourceFingerprint: 'source_1',
      expectedConfigFingerprint: 'config_1',
      csrfToken: 'csrf_123',
    });

    expect(calls[0].input).toBe('/admin/api/configured-servers/mcpTemplates/github%2Fapi');
    expect(calls[1]).toMatchObject({
      input: '/admin/api/configured-servers/mcpTemplates/github%2Fapi/instruction-override',
      init: {
        method: 'POST',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf_123' }),
        body: JSON.stringify({
          mutation: { action: 'set', value: '' },
          expectedSourceFingerprint: 'source_1',
          expectedConfigFingerprint: 'config_1',
        }),
      },
    });
  });
  it('opens one same-origin backend log stream and decodes multiplexed events', () => {
    const listeners = new Map<string, (event: MessageEvent<string>) => void>();
    const close = vi.fn();
    const source: AdminLogEventSource = {
      addEventListener: (type, listener) => listeners.set(type, listener),
      close,
      onerror: null,
      onopen: null,
    };
    const createSource = vi.fn(() => source);
    const handlers = {
      onSnapshot: vi.fn(),
      onGap: vi.fn(),
      onEntry: vi.fn(),
      onSources: vi.fn(),
      onSourceUpdate: vi.fn(),
      onOpen: vi.fn(),
      onError: vi.fn(),
    };
    const api = createAdminApi({ eventSource: createSource });

    const disconnect = api.openBackendLogStream(handlers);
    listeners.get('entry')!(new MessageEvent('entry', { data: JSON.stringify({ sequence: 4, content: 'ready' }) }));
    listeners.get('sources')!(new MessageEvent('sources', { data: JSON.stringify([{ id: 'static:fs' }]) }));
    listeners.get('source')!(
      new MessageEvent('source', { data: JSON.stringify({ sourceId: 'static:fs', removed: true }) }),
    );
    source.onopen!(new Event('open'));

    expect(createSource).toHaveBeenCalledOnce();
    expect(createSource).toHaveBeenCalledWith('/admin/api/logs/stream');
    expect(handlers.onEntry).toHaveBeenCalledWith(expect.objectContaining({ sequence: 4, content: 'ready' }));
    expect(handlers.onSources).toHaveBeenCalledWith([{ id: 'static:fs' }]);
    expect(handlers.onSourceUpdate).toHaveBeenCalledWith({ sourceId: 'static:fs', removed: true });
    expect(handlers.onOpen).toHaveBeenCalledOnce();

    for (const eventName of ['snapshot', 'gap', 'entry', 'sources', 'source']) {
      listeners.get(eventName)!(new MessageEvent(eventName, { data: '{invalid json' }));
    }
    expect(handlers.onError).toHaveBeenCalledTimes(5);

    disconnect();
    expect(close).toHaveBeenCalledOnce();
  });

  it('requests retained backend logs for only the selected source', async () => {
    const fetch = vi.fn(async () => jsonResponse({ sequence: 0, sources: [], entries: [] }));
    const api = createAdminApi({ fetch });

    await api.getBackendLogSnapshot('static:filesystem');

    expect(fetch).toHaveBeenCalledWith('/admin/api/logs/snapshot?sourceId=static%3Afilesystem', expect.any(Object));
  });
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
        return jsonResponse({ authenticated: false, adminStatus: 'setupRequired' });
      },
    });

    const login = await api.login({ username: 'operator', password: 'correct horse battery staple' });
    await expect(api.getSession()).resolves.toEqual({ authenticated: false, adminStatus: 'setupRequired' });

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

  it('loads, previews, and confirms configured-server creation without a force flag', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const api = createAdminApi({
      fetch: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse({ ok: true, createContract: {}, preview: {}, result: {} });
      },
    });
    const draft = {
      name: 'custom',
      enabled: true,
      tags: ['local'],
      transport: { type: 'stdio' as const, command: 'node', args: ['server.js'] },
    };

    await api.getConfiguredServerCreateContract();
    await api.previewConfiguredServerCreate({ draft, connectivityCheck: 'auto', csrfToken: 'csrf_123' });
    await api.createConfiguredServer({
      draft,
      previewFingerprint: 'preview_1',
      confirmationFacts: { previewConfirmed: 'preview_1' },
      idempotencyKey: 'create-key',
      csrfToken: 'csrf_123',
    });

    expect(calls[0]).toMatchObject({ input: '/admin/api/configured-servers/create-contract' });
    expect(calls[1]).toMatchObject({
      input: '/admin/api/configured-servers/create-preview',
      init: {
        method: 'POST',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf_123' }),
        body: JSON.stringify({ draft, connectivityCheck: 'auto' }),
      },
    });
    expect(calls[2]).toMatchObject({
      input: '/admin/api/configured-servers',
      init: {
        method: 'POST',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf_123', 'Idempotency-Key': 'create-key' }),
        body: JSON.stringify({
          draft,
          previewFingerprint: 'preview_1',
          confirmationFacts: { previewConfirmed: 'preview_1' },
        }),
      },
    });
    expect(calls[2].init?.body).not.toContain('force');
  });

  it('authorizes and restarts full OAuth service ids with CSRF, unique idempotency, and redirect results', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const api = createAdminApi({
      idempotencyKey: ({ action, targetName }) => `key-${action}-${targetName}`,
      fetch: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse({
          ok: true,
          operationId: actionOperationId(String(input)),
          result: {
            serviceId: 'context7:0123456789abcdef',
            redirectUrl: String(input).endsWith('/authorize')
              ? 'https://provider.example/authorize'
              : 'https://provider.example/restart',
          },
        });
      },
    });

    const authorized = await api.authorizeOAuthService({
      serviceId: 'context7:0123456789abcdef',
      csrfToken: 'csrf_authorize',
    });
    const restarted = await api.restartOAuthService({
      serviceId: 'context7:0123456789abcdef',
      csrfToken: 'csrf_restart',
    });

    expect(calls).toMatchObject([
      {
        input: '/admin/api/oauth/context7%3A0123456789abcdef/authorize',
        init: {
          method: 'POST',
          headers: {
            'X-CSRF-Token': 'csrf_authorize',
            'Idempotency-Key': 'key-oauth-authorize-context7:0123456789abcdef',
          },
        },
      },
      {
        input: '/admin/api/oauth/context7%3A0123456789abcdef/restart',
        init: {
          method: 'POST',
          headers: {
            'X-CSRF-Token': 'csrf_restart',
            'Idempotency-Key': 'key-oauth-restart-context7:0123456789abcdef',
          },
        },
      },
    ]);
    expect(calls[0].init?.headers).not.toEqual(calls[1].init?.headers);
    expect(authorized).toEqual({
      serviceId: 'context7:0123456789abcdef',
      redirectUrl: 'https://provider.example/authorize',
    });
    expect(restarted).toEqual({
      serviceId: 'context7:0123456789abcdef',
      redirectUrl: 'https://provider.example/restart',
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

function actionOperationId(input: string): string {
  return input.endsWith('/authorize') ? 'op_authorize' : 'op_restart';
}
