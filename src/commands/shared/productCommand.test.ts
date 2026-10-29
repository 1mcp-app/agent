import { finishProductCommand, runProductCommand } from '@src/productTelemetry/commandScope.js';
import { beginProductCommand } from '@src/productTelemetry/index.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

const usage = vi.hoisted(() => ({ finish: vi.fn() }));
vi.mock('@src/productTelemetry/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/productTelemetry/index.js')>()),
  beginProductCommand: vi.fn(() => usage),
}));

afterEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});
describe('registered command completion', () => {
  it('counts nested command delegation once at the outer family', async () => {
    await runProductCommand('mcp', () => runProductCommand('config', async () => {}));
    expect(beginProductCommand).toHaveBeenCalledExactlyOnceWith('mcp');
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('success');
  });
  it('preserves thrown failure and ignores a second finish', async () => {
    const failure = new Error('private target');
    await expect(
      runProductCommand('preset', async () => {
        finishProductCommand(1);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failure');
  });
  it('uses the command exit status when the handler returns normally', async () => {
    await runProductCommand('project', async () => {
      process.exitCode = 4;
    });
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failure');
  });
  it('keeps concurrent invocations separate', async () => {
    await Promise.all([runProductCommand('auth', async () => {}), runProductCommand('wait', async () => {})]);
    expect(beginProductCommand).toHaveBeenCalledTimes(2);
    expect(usage.finish).toHaveBeenCalledTimes(2);
  });
  it('records cancellation once while preserving the existing signal owner', async () => {
    const owner = vi.fn();
    process.once('SIGTERM', owner);
    await runProductCommand('wait', async () => {
      process.emit('SIGTERM');
    });
    expect(owner).toHaveBeenCalledOnce();
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failure');
    expect(process.listenerCount('SIGTERM')).toBe(0);
  });
});
