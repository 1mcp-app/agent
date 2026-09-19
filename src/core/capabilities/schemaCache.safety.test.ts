import type { Tool } from '@src/sdk/contracts/index.js';

import { describe, expect, it, vi } from 'vitest';

import { SchemaCache } from './schemaCache.js';

const tool: Tool = { name: 'old', inputSchema: { type: 'object' } };

describe('schema cache isolation and invalidation', () => {
  it.each([NaN, Infinity, 0, -1, 1.5])('rejects invalid cache capacity %s', (maxEntries) => {
    expect(() => new SchemaCache({ maxEntries })).toThrow();
  });
  it.each([NaN, Infinity, -1])('rejects invalid cache TTL %s', (ttlMs) => {
    expect(() => new SchemaCache({ maxEntries: 1, ttlMs })).toThrow();
  });

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
  it('cancels one caller without cancelling a coalesced caller', async () => {
    const cache = new SchemaCache({ maxEntries: 1 });
    let finish!: (value: Tool) => void;
    let upstreamSignal!: AbortSignal;
    const loader = vi.fn((_server: string, _tool: string, signal?: AbortSignal) => {
      upstreamSignal = signal!;
      return new Promise<Tool>((resolve) => {
        finish = resolve;
      });
    });
    const controller = new AbortController();
    const first = cache.getOrLoad('s', 't', loader, controller.signal);
    const second = cache.getOrLoad('s', 't', loader);
    await Promise.resolve();
    controller.abort();
    await expect(first).rejects.toThrow('cancelled');
    expect(upstreamSignal.aborted).toBe(false);
    finish(tool);
    await expect(second).resolves.toEqual(tool);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.getIfCached('s', 't')).toEqual(tool);
  });
  it('aborts abandoned loads but retains capacity until an uncooperative loader settles', async () => {
    const cache = new SchemaCache({ maxEntries: 1 });
    let finish!: (value: Tool) => void;
    let upstreamSignal!: AbortSignal;
    const loader = (_server: string, _tool: string, signal?: AbortSignal) => {
      upstreamSignal = signal!;
      return new Promise<Tool>((resolve) => {
        finish = resolve;
      });
    };
    const controller = new AbortController();
    const pending = cache.getOrLoad('s', 't', loader, controller.signal);
    const otherController = new AbortController();
    const other = cache.getOrLoad('s', 't', loader, otherController.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(upstreamSignal.aborted).toBe(false);
    otherController.abort();
    await expect(other).rejects.toThrow('cancelled');
    expect(upstreamSignal.aborted).toBe(true);
    await expect(cache.getOrLoad('s', 't', async () => tool)).rejects.toThrow('capacity');
    finish(tool);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cache.getIfCached('s', 't')).toBeNull();
    await expect(cache.getOrLoad('s', 't', async () => tool)).resolves.toEqual(tool);
  });
  it('bounds continuations retained by cancelled coalesced callers', async () => {
    const cache = new SchemaCache({ maxEntries: 1 });
    let finish!: (value: Tool) => void;
    const loader = () =>
      new Promise<Tool>((resolve) => {
        finish = resolve;
      });
    const active = cache.getOrLoad('s', 't', loader);
    for (let index = 1; index < 256; index++) {
      const controller = new AbortController();
      const pending = cache.getOrLoad('s', 't', loader, controller.signal);
      controller.abort();
      await expect(pending).rejects.toThrow('cancelled');
    }
    await expect(cache.getOrLoad('s', 't', loader)).rejects.toThrow('waiter capacity');
    finish(tool);
    await expect(active).resolves.toEqual(tool);
  });
  it('does not start upstream work for an already cancelled caller', async () => {
    const cache = new SchemaCache({ maxEntries: 1 });
    const loader = vi.fn(async () => tool);
    await expect(cache.getOrLoad('s', 't', loader, AbortSignal.abort())).rejects.toThrow();
    expect(loader).not.toHaveBeenCalled();
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
