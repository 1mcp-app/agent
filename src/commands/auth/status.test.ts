import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authStatusCommand } from './status.js';

const { mockResolveServeTarget, mockLoadAuthProfile, mockGetOAuthTokenReference, mockApiClientGet } = vi.hoisted(
  () => ({
    mockResolveServeTarget: vi.fn(),
    mockLoadAuthProfile: vi.fn(),
    mockGetOAuthTokenReference: vi.fn(),
    mockApiClientGet: vi.fn(),
  }),
);

vi.mock('@src/commands/shared/serveTargetResolver.js', () => ({
  resolveServeTarget: mockResolveServeTarget,
}));

vi.mock('@src/commands/shared/authProfileStore.js', () => ({
  normalizeServerUrl: (url: string) =>
    url
      .replace(/\/mcp$/, '')
      .replace(/\/$/, '')
      .toLowerCase(),
  loadAuthProfile: mockLoadAuthProfile,
  listAuthProfiles: vi.fn(),
}));

vi.mock('@src/domains/runtime-targets/runtimeTargetStore.js', () => ({
  RuntimeTargetStore: vi.fn().mockImplementation(function () {
    return {
      current: vi.fn(() => ({ name: 'prod' })),
      getOAuthTokenReference: mockGetOAuthTokenReference,
    };
  }),
}));

vi.mock('@src/commands/shared/apiClient.js', () => ({
  ApiClient: vi.fn().mockImplementation(function () {
    return {
      get: mockApiClientGet,
    };
  }),
}));

const baseOptions = { 'config-dir': '/tmp/test-config' } as Parameters<typeof authStatusCommand>[0];

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
  mockLoadAuthProfile.mockResolvedValue({
    serverUrl: 'https://prod.example.com',
    token: 'tk-prod',
    savedAt: 1_000,
  });
  mockGetOAuthTokenReference.mockReturnValue({
    serverUrl: 'https://prod.example.com',
    token: 'tk-prod',
    savedAt: 1_000,
  });
  mockApiClientGet.mockResolvedValue({ ok: true, status: 200 });
});

describe('authStatusCommand', () => {
  it('requires explicit context and rejects credential URL mode', async () => {
    await expect(authStatusCommand(baseOptions)).rejects.toMatchObject({
      code: 'credential_context_required',
    });
    await expect(authStatusCommand({ ...baseOptions, url: 'https://prod.example.com' })).rejects.toMatchObject({
      code: 'credential_url_unsupported',
    });
    expect(mockResolveServeTarget).not.toHaveBeenCalled();
  });

  it('uses the selected Runtime Target Context to show profile status', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await authStatusCommand({ ...baseOptions, context: 'prod' });

    expect(mockResolveServeTarget).toHaveBeenCalledWith({ context: 'prod', 'config-dir': '/tmp/test-config' });
    expect(mockGetOAuthTokenReference).toHaveBeenCalledWith('prod', 'scope_prod');
    expect(mockLoadAuthProfile).not.toHaveBeenCalled();
    expect(mockApiClientGet).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Profile: prod (https://prod.example.com)'));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Status: connected'));
    writeSpy.mockRestore();
  });

  it('reports no context-scoped profile when no OAuth token reference exists', async () => {
    mockGetOAuthTokenReference.mockReturnValue(undefined);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await authStatusCommand({ ...baseOptions, context: 'prod' });

    expect(mockApiClientGet).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('No saved profile for prod'));
    writeSpy.mockRestore();
  });
});
