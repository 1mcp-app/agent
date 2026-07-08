import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authLogoutCommand } from './logout.js';

const { mockResolveServeTarget, mockGetOAuthTokenReference, mockClearOAuthTokenReference } = vi.hoisted(() => ({
  mockResolveServeTarget: vi.fn(),
  mockGetOAuthTokenReference: vi.fn(),
  mockClearOAuthTokenReference: vi.fn(),
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
}));

vi.mock('@src/domains/runtime-targets/runtimeTargetStore.js', () => ({
  RuntimeTargetStore: vi.fn().mockImplementation(function () {
    return {
      current: vi.fn(() => ({ name: 'prod' })),
      getOAuthTokenReference: mockGetOAuthTokenReference,
      clearOAuthTokenReference: mockClearOAuthTokenReference,
    };
  }),
}));

const baseOptions = { 'config-dir': '/tmp/test-config' } as Parameters<typeof authLogoutCommand>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveServeTarget.mockResolvedValue({
    discoveredUrl: 'https://prod.example.com/mcp',
    runtimeTargetContext: {
      name: 'prod',
      kind: 'remote',
      runtimeScopeId: 'scope_prod',
    },
  });
  mockGetOAuthTokenReference.mockReturnValue({ token: 'tk-prod' });
});

describe('authLogoutCommand', () => {
  it('requires explicit context and rejects credential URL mode', async () => {
    await expect(authLogoutCommand(baseOptions)).rejects.toMatchObject({
      code: 'credential_context_required',
    });
    await expect(authLogoutCommand({ ...baseOptions, url: 'https://prod.example.com' })).rejects.toMatchObject({
      code: 'credential_url_unsupported',
    });
    expect(mockResolveServeTarget).not.toHaveBeenCalled();
  });

  it('uses the selected Runtime Target Context', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await authLogoutCommand({ ...baseOptions, context: 'prod' });

    expect(mockResolveServeTarget).toHaveBeenCalledWith({ context: 'prod', 'config-dir': '/tmp/test-config' });
    expect(mockClearOAuthTokenReference).toHaveBeenCalledWith('prod', 'scope_prod');
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Removed profile'));
    writeSpy.mockRestore();
  });

  it('does not let --all bypass explicit context enforcement or context-scoped cleanup', async () => {
    await expect(authLogoutCommand({ ...baseOptions, all: true })).rejects.toMatchObject({
      code: 'credential_context_required',
    });
    await expect(authLogoutCommand({ ...baseOptions, context: 'prod', all: true })).rejects.toMatchObject({
      code: 'credential_all_unsupported',
    });
    expect(mockResolveServeTarget).not.toHaveBeenCalled();
    expect(mockClearOAuthTokenReference).not.toHaveBeenCalled();
  });

  it('reports no context-scoped profile when no OAuth token reference exists', async () => {
    mockGetOAuthTokenReference.mockReturnValue(undefined);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await authLogoutCommand({ ...baseOptions, context: 'prod' });

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('No saved profile'));
    expect(mockClearOAuthTokenReference).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('preserves context-scoped profile deletion errors', async () => {
    mockClearOAuthTokenReference.mockImplementation(() => {
      throw new Error('disk write failed');
    });

    await expect(authLogoutCommand({ ...baseOptions, context: 'prod' })).rejects.toThrow('disk write failed');
  });
});
