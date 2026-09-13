import type { Tool } from '@src/sdk/contracts/index.js';

import { describe, expect, it, vi } from 'vitest';

import { SchemaCache } from './schemaCache.js';

const tool: Tool = { name: 'old', inputSchema: { type: 'object' } };

describe('schema cache isolation and invalidation', () => {
  it('separates ambiguous server/tool pairs', () => {
    const cache = new SchemaCache({ maxEntries: 2 });
    cache.set('a:b', 'c', tool);
    expect(cache.getIfCached('a', 'b:c')).toBeNull();
    expect(cache.getCachedTools()).toEqual([{ server: 'a:b', toolName: 'c' }]);
  });
  it.each(['clear', 'delete', 'set'] as const)('does not republish a load after %s', async (action) => {
    const cache = new SchemaCache({ maxEntries: 2 });
    let finish!: (value: Tool) => void;
    const load = cache.getOrLoad(
      's',
      't',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    if (action === 'clear') cache.clear();
    if (action === 'delete') cache.delete('s', 't');
    if (action === 'set') cache.set('s', 't', { ...tool, name: 'new' });
    finish(tool);
    await load;
    expect(cache.getIfCached('s', 't')?.name ?? null).toBe(action === 'set' ? 'new' : null);
  });
  it('bounds detached in-flight work and releases capacity after failures', async () => {
    const cache = new SchemaCache({ maxEntries: 1 });
    let fail!: (error: Error) => void;
    const first = cache.getOrLoad(
      's',
      't',
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    await Promise.resolve();
    cache.clear();
    const other = vi.fn(async () => tool);
    await expect(cache.getOrLoad('s', 'u', other)).rejects.toThrow('capacity');
    expect(other).not.toHaveBeenCalled();
    fail(new Error('failed'));
    await expect(first).rejects.toThrow('failed');
    await expect(cache.getOrLoad('s', 'u', other)).resolves.toEqual(tool);
  });
  it('expires at the TTL boundary and bounds load wait time without republishing late results', async () => {
    vi.useFakeTimers();
    try {
      const cache = new SchemaCache({ maxEntries: 1, ttlMs: 0 });
      cache.set('s', 't', tool);
      expect(cache.getIfCached('s', 't')).toBeNull();
      let finish!: (value: Tool) => void;
      const load = cache.getOrLoad(
        's',
        't',
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const rejected = expect(load).rejects.toThrow('deadline');
      await vi.advanceTimersByTimeAsync(30000);
      await rejected;
      await expect(cache.getOrLoad('s', 'u', async () => tool)).rejects.toThrow('capacity');
      finish(tool);
      await Promise.resolve();
      expect(cache.getIfCached('s', 't')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
