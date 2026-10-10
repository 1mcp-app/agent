import { describe, expect, it, vi } from 'vitest';

import { codegraphReadonlyCommand } from './codegraphReadonly.js';

describe('explicit read-only CodeGraph stdio launcher', () => {
  it('passes only the validated pinned installation and exact checkout to the native server', async () => {
    const serve = vi.fn(async () => undefined);
    const stdout = vi.spyOn(process.stdout, 'write');
    await codegraphReadonlyCommand(
      { executable: '/installed/codegraph', path: '/checkout', allowedActions: ['install'] },
      { serve },
    );
    expect(serve).toHaveBeenCalledExactlyOnceWith({
      executable: '/installed/codegraph',
      checkoutPath: '/checkout',
      expectedVersion: '1.6.2',
    });
    expect(stdout).not.toHaveBeenCalled();
    stdout.mockRestore();
  });

  it.each([
    { executable: 'codegraph', path: '/checkout' },
    { executable: '/installed/codegraph', path: 'relative' },
    { executable: '/installed/codegraph', path: '/checkout', expectedVersion: 'latest' },
    { executable: '/installed/codegraph' },
  ])('rejects invalid authority before loading or starting native code: %j', async (options) => {
    const serve = vi.fn(async () => undefined);
    await expect(codegraphReadonlyCommand(options, { serve })).rejects.toThrow();
    expect(serve).not.toHaveBeenCalled();
  });
});
