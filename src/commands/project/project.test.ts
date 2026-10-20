import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatProjectOutput, projectCommand } from './project.js';

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
