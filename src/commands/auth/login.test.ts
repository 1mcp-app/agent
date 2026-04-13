import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authLoginCommand } from './login.js';

const { mockDiscoverServerWithPidFile, mockSaveAuthProfile, mockApiClientGet, mockApiClientPost } = vi.hoisted(() => ({
  mockDiscoverServerWithPidFile: vi.fn(),
  mockSaveAuthProfile: vi.fn(),
  mockApiClientGet: vi.fn(),
  mockApiClientPost: vi.fn(),
}));

vi.mock('@src/utils/validation/urlDetection.js', () => ({
  discoverServerWithPidFile: mockDiscoverServerWithPidFile,
}));

vi.mock('@src/commands/shared/authProfileStore.js', () => ({
  normalizeServerUrl: (url: string) =>
    url
      .replace(/\/mcp$/, '')
      .replace(/\/$/, '')
      .toLowerCase(),
  saveAuthProfile: mockSaveAuthProfile,
}));

vi.mock('@src/commands/shared/apiClient.js', () => ({
  ApiClient: vi.fn().mockImplementation(() => ({
    get: mockApiClientGet,
    post: mockApiClientPost,
  })),
}));

const baseOptions = { 'config-dir': '/tmp/test-config' } as Parameters<typeof authLoginCommand>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mockApiClientGet.mockResolvedValue({ ok: false, status: 401 });
  mockApiClientPost.mockResolvedValue({ ok: false, status: 404 });
  mockSaveAuthProfile.mockResolvedValue(undefined);
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
});

describe('authLoginCommand', () => {
  it('auto-detects server when --url is omitted', async () => {
    mockDiscoverServerWithPidFile.mockResolvedValue({
      url: 'http://localhost:3050/mcp',
      source: 'pidfile',
    });
    mockApiClientPost.mockResolvedValue({ ok: true, data: { token: 'tk-abc123', authRequired: true } });
    mockApiClientGet
      .mockResolvedValueOnce({ ok: false, status: 401 }) // probe
      .mockResolvedValueOnce({ ok: true, status: 200 }); // validate

    await authLoginCommand(baseOptions);

    expect(mockDiscoverServerWithPidFile).toHaveBeenCalledWith('/tmp/test-config', undefined);
    expect(mockSaveAuthProfile).toHaveBeenCalledWith(
      '/tmp/test-config',
      expect.objectContaining({ token: 'tk-abc123' }),
    );
  });

  it('uses explicit --url when provided', async () => {
    mockDiscoverServerWithPidFile.mockResolvedValue({
      url: 'http://localhost:3051/mcp',
      source: 'user',
    });
    mockApiClientGet.mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce({ ok: true, status: 200 });

    await authLoginCommand({ ...baseOptions, url: 'http://localhost:3051', token: 'mytoken' });

    expect(mockDiscoverServerWithPidFile).toHaveBeenCalledWith('/tmp/test-config', 'http://localhost:3051');
    expect(mockSaveAuthProfile).toHaveBeenCalledWith('/tmp/test-config', expect.objectContaining({ token: 'mytoken' }));
  });

  it('exits early when auth is disabled on server', async () => {
    mockDiscoverServerWithPidFile.mockResolvedValue({
      url: 'http://localhost:3050/mcp',
      source: 'pidfile',
    });
    mockApiClientGet.mockResolvedValue({ ok: true, status: 200 });

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await authLoginCommand(baseOptions);

    expect(mockSaveAuthProfile).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('No login needed'));
    writeSpy.mockRestore();
  });

  it('throws when token rejected by server', async () => {
    mockDiscoverServerWithPidFile.mockResolvedValue({
      url: 'http://localhost:3050/mcp',
      source: 'user',
    });
    mockApiClientGet
      .mockResolvedValueOnce({ ok: false, status: 401 }) // probe
      .mockResolvedValueOnce({ ok: false, status: 401 }); // validate

    await expect(authLoginCommand({ ...baseOptions, token: 'bad-token' })).rejects.toThrow('Authentication failed');
  });

  it('throws when no token and not localhost', async () => {
    mockDiscoverServerWithPidFile.mockResolvedValue({
      url: 'http://remote.example.com/mcp',
      source: 'user',
    });
    mockApiClientGet.mockResolvedValue({ ok: false, status: 401 });

    await expect(authLoginCommand(baseOptions)).rejects.toThrow('No token provided');
  });
});
