import { describe, expect, it } from 'vitest';

describe('createTimeout', () => {
  it('should reject with the correct message', async () => {
    const { createTimeout } = await import('./connectionHelper.js');
    const promise = createTimeout(10, 'Test timeout message');
    await expect(promise).rejects.toThrow('Test timeout message');
  });

  it('should reject after the specified duration', async () => {
    const { createTimeout } = await import('./connectionHelper.js');
    const start = Date.now();
    const promise = createTimeout(50, 'Timed out');

    // Wait for the promise to reject
    try {
      await promise;
    } catch {
      // Expected to reject
    }

    // Check that at least the timeout duration passed
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});
