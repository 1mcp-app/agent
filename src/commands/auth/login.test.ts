import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authLoginCommand } from './login.js';

const { mockResolveServeTarget, mockSaveAuthProfile, mockSetOAuthTokenReference, mockApiClientGet, mockApiClientPost } =
  vi.hoisted(() => ({
    mockResolveServeTarget: vi.fn(),
    mockSaveAuthProfile: vi.fn(),
    mockSetOAuthTokenReference: vi.fn(),
    mockApiClientGet: vi.fn(),
    mockApiClientPost: vi.fn(),
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
});
