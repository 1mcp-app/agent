import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exportUpstreamCredentialsCommand } from './exportUpstreamCredentials.js';

const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  export: vi.fn(),
  shutdown: vi.fn(),
  storage: vi.fn(),
  prompt: vi.fn(),
}));
vi.mock('@src/auth/storage/upstreamOAuthStorage.js', () => ({
  UpstreamOAuthStorage: class {
    constructor(options: unknown) {
      mocks.storage(options);
    }
    exportToFile = mocks.export;
    shutdown = mocks.shutdown;
  },
}));
vi.mock('@src/commands/serve/serveStatus.js', () => ({ getRuntimeStatusReport: mocks.report }));
vi.mock('@src/core/server/runtimeScopeOwnership.js', () => ({ claimRuntimeScope: mocks.claim }));
vi.mock('prompts', () => ({ default: mocks.prompt }));

describe('explicit upstream plaintext export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.report.mockResolvedValue({ status: 'not-running' });
    mocks.claim.mockReturnValue({ release: mocks.release });
    mocks.export.mockResolvedValue({ records: 2 });
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the exact destination and refuses noninteractive export without explicit confirmation', async () => {
    await expect(exportUpstreamCredentialsCommand({ 'config-dir': '/tmp/scoped' })).rejects.toThrow(
      '--confirm-plaintext-export',
    );
    expect(process.stdout.write).toHaveBeenCalledWith(
      'Plaintext upstream OAuth destination: /tmp/scoped/clientSessions/sessions/client\n',
    );
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it.each(['running', 'starting', 'unreachable', 'orphaned', 'error'])('blocks %s runtime state', async (status) => {
    mocks.report.mockResolvedValue({ status });
    await expect(
      exportUpstreamCredentialsCommand({ 'config-dir': '/tmp/scoped', 'confirm-plaintext-export': true }),
    ).rejects.toThrow('Stop the selected Runtime Scope');
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.export).not.toHaveBeenCalled();
  });
  it('claims runtime ownership before export and releases it afterward', async () => {
    await exportUpstreamCredentialsCommand({
      'config-dir': '/tmp/scoped',
      'session-storage-path': '/tmp/custom',
      'confirm-plaintext-export': true,
    });
    expect(mocks.storage).toHaveBeenCalledWith({
      baseDir: '/tmp/clientSessions',
      mode: 'native',
      runtimeScope: '/tmp/scoped',
    });
    expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(mocks.export.mock.invocationCallOrder[0]);
    expect(mocks.shutdown).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('cannot race a runtime that starts between inspection and claim', async () => {
    mocks.claim.mockImplementationOnce(() => {
      throw new Error('Runtime Scope is already owned');
    });
    await expect(
      exportUpstreamCredentialsCommand({ 'config-dir': '/tmp/scoped', 'confirm-plaintext-export': true }),
    ).rejects.toThrow('already owned');
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it('reports incomplete export and releases ownership on persistence failure', async () => {
    mocks.export.mockRejectedValueOnce(new Error('Native cleanup incomplete'));
    await expect(
      exportUpstreamCredentialsCommand({ 'config-dir': '/tmp/scoped', 'confirm-plaintext-export': true }),
    ).rejects.toThrow('incomplete');
    expect(mocks.shutdown).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
