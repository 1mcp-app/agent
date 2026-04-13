import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authLogoutCommand } from './logout.js';

const { mockDiscoverServerWithPidFile, mockDeleteAuthProfile, mockListAuthProfiles } = vi.hoisted(() => ({
  mockDiscoverServerWithPidFile: vi.fn(),
  mockDeleteAuthProfile: vi.fn(),
  mockListAuthProfiles: vi.fn(),
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
  deleteAuthProfile: mockDeleteAuthProfile,
  listAuthProfiles: mockListAuthProfiles,
}));

const baseOptions = { 'config-dir': '/tmp/test-config' } as Parameters<typeof authLogoutCommand>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteAuthProfile.mockResolvedValue(true);
  mockListAuthProfiles.mockResolvedValue([]);
});

describe('authLogoutCommand', () => {
  it('auto-detects server when --url is omitted', async () => {
    mockDiscoverServerWithPidFile.mockResolvedValue({
      url: 'http://localhost:3050/mcp',
      source: 'pidfile',
    });

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await authLogoutCommand(baseOptions);

    expect(mockDiscoverServerWithPidFile).toHaveBeenCalledWith('/tmp/test-config');
    expect(mockDeleteAuthProfile).toHaveBeenCalledWith('/tmp/test-config', 'http://localhost:3050');
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Removed profile'));
    writeSpy.mockRestore();
  });

  it('uses explicit --url when provided', async () => {
    await authLogoutCommand({ ...baseOptions, url: 'http://localhost:3051' });

    expect(mockDiscoverServerWithPidFile).not.toHaveBeenCalled();
    expect(mockDeleteAuthProfile).toHaveBeenCalledWith('/tmp/test-config', 'http://localhost:3051');
  });

  it('removes all profiles with --all', async () => {
    mockListAuthProfiles.mockResolvedValue([
      { serverUrl: 'http://a.example.com', token: 't1', savedAt: 0 },
      { serverUrl: 'http://b.example.com', token: 't2', savedAt: 0 },
    ]);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await authLogoutCommand({ ...baseOptions, all: true });

    expect(mockDeleteAuthProfile).toHaveBeenCalledTimes(2);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Removed 2 profiles'));
    writeSpy.mockRestore();
  });

  it('reports no profile found when auto-detected server has no saved profile', async () => {
    mockDiscoverServerWithPidFile.mockResolvedValue({
      url: 'http://localhost:3050/mcp',
      source: 'portscan',
    });
    mockDeleteAuthProfile.mockResolvedValue(false);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await authLogoutCommand(baseOptions);

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('No saved profile'));
    writeSpy.mockRestore();
  });

  it('throws when no server found and no --url or --all', async () => {
    mockDiscoverServerWithPidFile.mockRejectedValue(new Error('No running 1MCP server found.'));

    await expect(authLogoutCommand(baseOptions)).rejects.toThrow('Specify --url');
  });
});
