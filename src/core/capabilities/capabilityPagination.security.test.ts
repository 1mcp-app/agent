import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  advanceCapabilityPaginationGeneration,
  CapabilityCursorCapacityError,
  type CapabilityKind,
  walkCapabilityPages,
} from './capabilityPagination.js';

const kinds: CapabilityKind[] = ['tools', 'prompts', 'resources', 'resourceTemplates'];

afterEach(() => vi.useRealTimers());

describe('authenticated capability cursors', () => {
  it.each(kinds)('binds %s continuation to scope, kind, generation and expiry', async (kind) => {
    vi.useFakeTimers();
    const connections = new Map();
    const list = vi.fn(async (cursor?: string) => ({
      items: [cursor ?? 'first'],
      nextCursor: cursor ? undefined : 'private-upstream-token',
    }));
    const options = {
      connections,
      providers: [{ id: 'private-source-id', name: 'source', list }],
      kind,
      filterSelection: { scope: 'one' },
      enablePagination: true,
    };
    const first = await walkCapabilityPages(options);
    expect(first.nextCursor).toBeDefined();
    await expect(
      walkCapabilityPages({ ...options, cursor: first.nextCursor, enablePagination: false }),
    ).rejects.toMatchObject({ data: { reason: 'filter_mismatch' } });
    const [payload, signature] = first.nextCursor!.split('.');
    expect(Buffer.from(payload, 'base64url').toString()).not.toContain('private');
    const changed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    changed.f = 'other';
    await expect(
      walkCapabilityPages({
        ...options,
        cursor: `${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`,
      }),
    ).rejects.toMatchObject({ data: { reason: 'authentication_failed' } });
    await expect(
      walkCapabilityPages({ ...options, filterSelection: { scope: 'two' }, cursor: first.nextCursor }),
    ).rejects.toMatchObject({ data: { reason: 'filter_mismatch' } });
    await expect(walkCapabilityPages({ ...options, cursor: first.nextCursor })).resolves.toMatchObject({
      items: ['private-upstream-token'],
    });
    vi.advanceTimersByTime(15 * 60 * 1000);
    await expect(walkCapabilityPages({ ...options, cursor: first.nextCursor })).rejects.toMatchObject({
      data: { reason: 'expired' },
    });
    const fresh = await walkCapabilityPages(options);
    advanceCapabilityPaginationGeneration(connections, kind);
    await expect(walkCapabilityPages({ ...options, cursor: fresh.nextCursor })).rejects.toMatchObject({
      data: { reason: 'stale_generation' },
    });
  });

  it('rejects oversized input before calling a provider', async () => {
    const list = vi.fn();
    await expect(
      walkCapabilityPages({
        connections: new Map(),
        providers: [{ id: 'x', name: 'x', list }],
        kind: 'tools',
        filterSelection: null,
        enablePagination: true,
        cursor: 'a'.repeat(4097),
      }),
    ).rejects.toMatchObject({ data: { reason: 'malformed' } });
    expect(list).not.toHaveBeenCalled();
  });
  it.each([true, false])('preserves an empty upstream cursor with pagination=%s', async (enablePagination) => {
    const list = vi.fn(async (cursor?: string) =>
      cursor === undefined ? { items: ['first'], nextCursor: '' } : { items: ['second'] },
    );
    const options = {
      connections: new Map(),
      providers: [{ id: 'p', name: 'p', list }],
      kind: 'tools' as const,
      filterSelection: null,
      enablePagination,
    };
    const first = await walkCapabilityPages(options);
    if (enablePagination) {
      const second = await walkCapabilityPages({ ...options, cursor: first.nextCursor });
      expect(second.items).toEqual(['second']);
    } else expect(first.items).toEqual(['first', 'second']);
    expect(list).toHaveBeenLastCalledWith('');
  });
  it('partitions entry capacity, preserves live cursors and reclaims invalidated generations', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2100-01-01'));
    const scopes = Array.from({ length: 5 }, (_, index) => {
      let next = 0;
      return {
        connections: new Map(),
        kind: 'tools' as const,
        enablePagination: true,
        filterSelection: { session: index },
        providers: [
          {
            id: 'provider',
            name: 'provider',
            list: async (cursor?: string) =>
              cursor === undefined
                ? { items: ['first'], nextCursor: String(++next) }
                : { items: [cursor], ...(cursor === '1' ? { nextCursor: '2' } : {}) },
          },
        ],
      };
    });
    try {
      const first = await walkCapabilityPages(scopes[0]);
      for (let index = 1; index < 1000; index++) await walkCapabilityPages(scopes[0]);
      await expect(walkCapabilityPages(scopes[0])).rejects.toBeInstanceOf(CapabilityCursorCapacityError);
      const second = await walkCapabilityPages(scopes[1]);
      for (let index = 1; index < 1000; index++) await walkCapabilityPages(scopes[1]);
      for (const scope of scopes.slice(2, 4))
        for (let index = 0; index < 1000; index++) await walkCapabilityPages(scope);
      await expect(walkCapabilityPages(scopes[4])).rejects.toMatchObject({
        data: { 'app.1mcp/failure': { code: 'gateway_overloaded' } },
      });
      await expect(walkCapabilityPages({ ...scopes[0], cursor: first.nextCursor })).resolves.toMatchObject({
        items: ['1'],
      });
      advanceCapabilityPaginationGeneration(scopes[0].connections, 'tools');
      await expect(walkCapabilityPages({ ...scopes[0], cursor: first.nextCursor })).rejects.toMatchObject({
        data: { reason: 'stale_generation' },
      });
      await expect(walkCapabilityPages(scopes[4])).resolves.toMatchObject({ items: ['first'] });
      await expect(walkCapabilityPages({ ...scopes[1], cursor: second.nextCursor })).resolves.toMatchObject({
        items: ['1'],
      });
    } finally {
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
      await walkCapabilityPages({ ...scopes[0], providers: [] });
    }
  });

  it('enforces partition and global byte ceilings without evicting live cursors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2100-02-01'));
    const scopes = Array.from({ length: 3 }, (_, session) => {
      let next = 0;
      return {
        connections: new Map(),
        kind: 'resources' as const,
        enablePagination: true,
        filterSelection: { session },
        providers: [
          {
            id: 'provider',
            name: 'provider',
            list: async (cursor?: string) =>
              cursor === undefined
                ? { items: ['first'], nextCursor: `${++next}`.padEnd(65536, 'x') }
                : { items: ['continued'] },
          },
        ],
      };
    });
    try {
      const first = await walkCapabilityPages(scopes[0]);
      for (let index = 1; index < 512; index++) await walkCapabilityPages(scopes[0]);
      await expect(walkCapabilityPages(scopes[0])).rejects.toBeInstanceOf(CapabilityCursorCapacityError);
      for (let index = 0; index < 512; index++) await walkCapabilityPages(scopes[1]);
      await expect(walkCapabilityPages(scopes[2])).rejects.toBeInstanceOf(CapabilityCursorCapacityError);
      await expect(walkCapabilityPages({ ...scopes[0], cursor: first.nextCursor })).resolves.toMatchObject({
        items: ['continued'],
      });
      advanceCapabilityPaginationGeneration(scopes[1].connections, 'resources');
      await expect(walkCapabilityPages(scopes[2])).resolves.toMatchObject({ items: ['first'] });
    } finally {
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
      await walkCapabilityPages({ ...scopes[0], providers: [] });
    }
  });
  it.each([true, false])(
    'does not downgrade internal overload to partial results with pagination=%s',
    async (enablePagination) => {
      const healthy = vi.fn(async () => ({ items: ['healthy'] }));
      await expect(
        walkCapabilityPages({
          connections: new Map(),
          kind: 'tools',
          enablePagination,
          filterSelection: null,
          providers: [
            {
              id: 'a',
              name: 'a',
              list: async () => {
                throw new CapabilityCursorCapacityError();
              },
            },
            { id: 'b', name: 'b', list: healthy },
          ],
        }),
      ).rejects.toBeInstanceOf(CapabilityCursorCapacityError);
      expect(healthy).not.toHaveBeenCalled();
    },
  );
});
