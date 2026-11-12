import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authLoginCommand } from './login.js';

const {
  mockReadLocalCapability,
  mockResolveServeTarget,
  mockSaveAuthProfile,
  mockSetOAuthTokenReference,
  mockApiClientGet,
  mockApiClientPost,
} = vi.hoisted(() => ({
  mockReadLocalCapability: vi.fn(),
  mockResolveServeTarget: vi.fn(),
  mockSaveAuthProfile: vi.fn(),
  mockSetOAuthTokenReference: vi.fn(),
  mockApiClientGet: vi.fn(),
  mockApiClientPost: vi.fn(),
}));

vi.mock('@src/commands/shared/clientSurfaceAttachment.js', () => ({
  readLiveLocalCapability: mockReadLocalCapability,
}));

vi.mock('@src/commands/shared/serveTargetResolver.js', () => ({
  resolveServeTarget: mockResolveServeTarget,
}));

vi.mock('@src/commands/shared/authProfileStore.js', () => ({
  normalizeServerUrl: (url: string) =>
    url
      .replace(/\/mcp$/, '')
      .replace(/\/$/, '')
      .toLowerCase(),
  saveAuthProfile: mockSaveAuthProfile,
}));

vi.mock('@src/domains/runtime-targets/runtimeTargetStore.js', () => ({
  RuntimeTargetStore: vi.fn().mockImplementation(function () {
    return {
      current: vi.fn(() => ({ name: 'prod' })),
      setOAuthTokenReference: mockSetOAuthTokenReference,
    };
  }),
}));

vi.mock('@src/commands/shared/apiClient.js', () => ({
  ApiClient: vi.fn().mockImplementation(function () {
    return {
      get: mockApiClientGet,
      post: mockApiClientPost,
    };
  }),
}));

const baseOptions = { 'config-dir': '/tmp/test-config' } as Parameters<typeof authLoginCommand>[0];

beforeEach(() => {
  mockReadLocalCapability.mockReset();
  mockResolveServeTarget.mockReset();
  mockSaveAuthProfile.mockReset();
  mockSetOAuthTokenReference.mockReset();
  mockApiClientGet.mockReset();
  mockApiClientPost.mockReset();
  mockResolveServeTarget.mockResolvedValue({
    discoveredUrl: 'https://prod.example.com/mcp',
    runtimeTargetContext: {
      name: 'prod',
      kind: 'remote',
      runtimeScopeId: 'scope_prod',
    },
  });
  mockApiClientGet.mockResolvedValue({ ok: false, status: 401 });
  mockApiClientPost.mockResolvedValue({ ok: false, status: 404 });
  mockSaveAuthProfile.mockResolvedValue(undefined);
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
});

describe('authLoginCommand', () => {
  it('requires explicit context and rejects credential URL mode', async () => {
    await expect(authLoginCommand({ ...baseOptions, token: 'tk' })).rejects.toMatchObject({
      code: 'credential_context_required',
    });
    await expect(
      authLoginCommand({ ...baseOptions, context: 'prod', url: 'https://prod.example.com', token: 'tk' }),
    ).rejects.toMatchObject({
      code: 'credential_url_unsupported',
    });
    expect(mockResolveServeTarget).not.toHaveBeenCalled();
  });

  it('uses the selected Runtime Target Context', async () => {
    mockApiClientPost.mockResolvedValue({ ok: true, data: { token: 'tk-abc123', authRequired: true } });
    mockApiClientGet
      .mockResolvedValueOnce({ ok: false, status: 401 }) // probe
      .mockResolvedValueOnce({ ok: true, status: 200 }); // validate

    await authLoginCommand({ ...baseOptions, context: 'prod', token: 'tk-abc123' });

    expect(mockResolveServeTarget).toHaveBeenCalledWith({ context: 'prod', 'config-dir': '/tmp/test-config' });
    expect(mockSetOAuthTokenReference).toHaveBeenCalledWith(
      'prod',
      'scope_prod',
      expect.objectContaining({ serverUrl: 'https://prod.example.com', token: 'tk-abc123' }),
    );
    expect(mockSaveAuthProfile).not.toHaveBeenCalled();
  });

  it('uses explicit token after resolving the context', async () => {
    mockApiClientGet.mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce({ ok: true, status: 200 });

    await authLoginCommand({ ...baseOptions, context: 'prod', token: 'mytoken' });

    expect(mockSetOAuthTokenReference).toHaveBeenCalledWith(
      'prod',
      'scope_prod',
      expect.objectContaining({ serverUrl: 'https://prod.example.com', token: 'mytoken' }),
    );
    expect(mockSaveAuthProfile).not.toHaveBeenCalled();
  });

  it('exits early when auth is disabled on server', async () => {
    mockApiClientGet.mockResolvedValue({ ok: true, status: 200 });

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await authLoginCommand({ ...baseOptions, context: 'prod' });

    expect(mockSetOAuthTokenReference).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('No login needed'));
    writeSpy.mockRestore();
  });

  it('throws when token rejected by server', async () => {
    mockApiClientGet
      .mockResolvedValueOnce({ ok: false, status: 401 }) // probe
      .mockResolvedValueOnce({ ok: false, status: 401 }); // validate

    await expect(authLoginCommand({ ...baseOptions, context: 'prod', token: 'bad-token' })).rejects.toThrow(
      'Authentication failed',
    );
  });

  it('throws when no token and not localhost', async () => {
    mockApiClientGet.mockResolvedValue({ ok: false, status: 401 });

    await expect(authLoginCommand({ ...baseOptions, context: 'prod' })).rejects.toThrow('No token provided');
  });
  it('automatically authenticates only a verified local runtime and forbids redirects', async () => {
    mockResolveServeTarget.mockResolvedValue({
      discoveredUrl: 'http://127.0.0.1:3050/mcp',
      runtimeTargetContext: { name: 'local', kind: 'local', runtimeScopeId: 'scope-local' },
    });
    mockReadLocalCapability.mockResolvedValue({
      version: 1,
      runtimeScopeId: 'scope-local',
      secret: Buffer.alloc(32, 1).toString('base64url'),
    });
    mockApiClientGet.mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce({ ok: true, status: 200 });
    mockApiClientPost.mockResolvedValue({ ok: true, data: { token: 'local-token' } });
    await authLoginCommand({ ...baseOptions, context: 'local' });
    expect(mockApiClientPost).toHaveBeenCalledWith(
      '/api/auth/cli-token',
      {},
      {
        headers: { Authorization: expect.stringMatching(/^1MCP-CLI /) },
        redirect: 'error',
      },
    );
  });

  it('never loads local authority for a remote context even when its URL is loopback', async () => {
    mockResolveServeTarget.mockResolvedValue({
      discoveredUrl: 'http://127.0.0.1:3050/mcp',
      runtimeTargetContext: { name: 'forwarded', kind: 'remote', runtimeScopeId: 'scope-remote' },
    });
    await expect(authLoginCommand({ ...baseOptions, context: 'forwarded' })).rejects.toThrow('No token provided');
    expect(mockReadLocalCapability).not.toHaveBeenCalled();
    expect(mockApiClientPost).not.toHaveBeenCalled();
  });

  it('does not mint when local authority is unavailable or belongs to another scope', async () => {
    mockResolveServeTarget.mockResolvedValue({
      discoveredUrl: 'http://127.0.0.1:3050/mcp',
      runtimeTargetContext: { name: 'local', kind: 'local', runtimeScopeId: 'scope-local' },
    });
    for (const capability of [undefined, { version: 1, runtimeScopeId: 'scope-other', secret: 'unused' }]) {
      mockReadLocalCapability.mockResolvedValue(capability);
      await expect(authLoginCommand({ ...baseOptions, context: 'local' })).rejects.toThrow('No token provided');
    }
    expect(mockApiClientPost).not.toHaveBeenCalled();
  });
});
