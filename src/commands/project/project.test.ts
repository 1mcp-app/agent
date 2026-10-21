import { resolveAgentSessionOptions } from '@src/commands/shared/agentSession.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatProjectOutput, projectCommand } from './project.js';

vi.mock('@src/commands/shared/agentSession.js', () => ({
  resolveAgentSessionOptions: vi.fn(async (options) => options),
}));
vi.mock('@src/domains/runtime-targets/runtimeTargetStore.js', () => ({
  RuntimeTargetStore: class {
    resolveForConnection(context?: string) {
      return { name: context ?? 'local' };
    }
  },
}));

const attach = vi.hoisted(() => vi.fn());
vi.mock('@src/commands/shared/clientSurfaceAttachment.js', () => ({
  attachReusableClientSurface: attach,
  formatClientSurfaceAuthRequiredMessage: () => 'Authenticate',
}));

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});
const pending = {
  results: [
    {
      checkoutPath: '/checkout',
      admission: 'draining',
      complete: false,
      blockers: [{ kind: 'owner', id: 'other-owner' }],
    },
  ],
};

describe('project lifecycle results', () => {
  it.each(['http://localhost:4000/mcp', 'https://remote.example/mcp'])(
    'does not infer ownership or assignment for explicit URL %s',
    async (url) => {
      vi.mocked(resolveAgentSessionOptions).mockClear();
      attach.mockResolvedValue({ status: 'success', value: pending });
      vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      await projectCommand({ action: 'status', url });
      expect(resolveAgentSessionOptions).not.toHaveBeenCalled();
      expect(attach.mock.lastCall?.[0].options['project-owner']).toBeUndefined();
      await expect(projectCommand({ action: 'release', url })).rejects.toThrow('project-owner');
    },
  );

  it('does not resolve local session defaults for a named remote target', async () => {
    vi.mocked(resolveAgentSessionOptions).mockClear();
    attach.mockResolvedValue({ status: 'success', value: pending });
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await projectCommand({ action: 'status', context: 'production' });
    expect(resolveAgentSessionOptions).not.toHaveBeenCalled();
  });

  it('retains explicit loopback owner resolution and implicit local defaults', async () => {
    vi.mocked(resolveAgentSessionOptions).mockClear();
    attach.mockResolvedValue({ status: 'success', value: pending });
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const explicit = { action: 'status' as const, url: 'http://localhost:4000/mcp', 'project-owner': '/own.json' };
    await projectCommand(explicit);
    expect(resolveAgentSessionOptions).toHaveBeenCalledWith(explicit);
    await projectCommand({ action: 'status' });
    expect(resolveAgentSessionOptions).toHaveBeenCalledWith({ action: 'status' });
  });

  it('returns nonzero for an accepted but incomplete drain and includes blockers in JSON', async () => {
    attach.mockResolvedValue({ status: 'success', value: pending });
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await projectCommand({ action: 'drain', format: 'json' });
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toEqual(pending);
  });

  it('does not turn successful blocked status inspection into a failed command', async () => {
    attach.mockResolvedValue({ status: 'success', value: pending });
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await projectCommand({ action: 'status', format: 'json' });
    expect(process.exitCode).toBeUndefined();
  });

  it('returns zero for completed drain and refuses a malformed success result', async () => {
    const result = { results: [{ ...pending.results[0], complete: true, blockers: [] }] };
    attach.mockResolvedValue({ status: 'success', value: result });
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await projectCommand({ action: 'drain', format: 'json' });
    expect(process.exitCode).toBeUndefined();
    attach.mockResolvedValue({ status: 'success', value: { results: [] } });
    await expect(projectCommand({ action: 'drain', format: 'json' })).rejects.toThrow();
  });

  it('rejects release without this caller credential and invalid wait budgets before attachment', async () => {
    attach.mockClear();
    await expect(projectCommand({ action: 'release' })).rejects.toThrow('project-owner');
    await expect(projectCommand({ action: 'drain', 'wait-ms': 60_001 })).rejects.toThrow();
    await expect(projectCommand({ action: 'resume', 'wait-ms': 1 })).rejects.toThrow();
    expect(attach).not.toHaveBeenCalled();
  });

  it('shows checkout admission and blockers in human output', () => {
    expect(formatProjectOutput(pending, 'text')).toBe('/checkout: draining; cleanup pending\n  owner: other-owner');
  });
});
