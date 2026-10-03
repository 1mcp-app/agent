import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  advanceCapabilityPaginationGeneration,
  CapabilityCursorCapacityError,
  type CapabilityKind,
  CapabilityProvidersUnavailableError,
  filterCapabilityPartialMeta,
  getCapabilityFailureFacts,
  getCapabilityFailureSources,
  setCapabilityFailureFacts,
  setCapabilityFailureSources,
  walkCapabilityPages,
} from './capabilityPagination.js';

const kinds: CapabilityKind[] = ['tools', 'prompts', 'resources', 'resourceTemplates'];

afterEach(() => vi.useRealTimers());

describe('authenticated capability cursors', () => {
  it.each([true, false])(
    'preserves sanitized failure metadata when every provider fails with pagination=%s',
    async (enablePagination) => {
      const error = await walkCapabilityPages({
        connections: new Map(),
        kind: 'tools',
        enablePagination,
        filterSelection: null,
        upstreamToolAdmissionTimeouts: ['private-a', 'private-a'],
        providers: [
          {
            id: 'private-a',
            name: 'a',
            list: async () => {
              throw new Error('untrusted error with credentials');
            },
          },
          {
            id: 'private-b',
            name: 'b',
            list: async () => {
              throw new Error('another untrusted error');
            },
          },
        ],
      }).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(CapabilityProvidersUnavailableError);
      if (!(error instanceof CapabilityProvidersUnavailableError)) throw error;
      expect(error.code).toBe(-32000);
      expect(error._meta).toMatchObject({
        'app.1mcp/capability-pagination': {
          partial: true,
          complete: false,
          generation: expect.any(String),
          failedSourceCount: 2,
          failureCategories: { upstream_list_failed: 2, upstream_tool_admission_timeout: 2 },
          retryable: true,
          recovery: 'restart-walk',
        },
      });
      expect([...getCapabilityFailureSources(error._meta)]).toEqual(['private-a', 'private-b']);
      expect([...getCapabilityFailureFacts(error._meta)]).toEqual([
        ['private-a', { upstream_list_failed: 1, upstream_tool_admission_timeout: 2 }],
        ['private-b', { upstream_list_failed: 1 }],
      ]);
      expect(filterCapabilityPartialMeta(error._meta, new Set(['private-b']))).toMatchObject({
        'app.1mcp/capability-pagination': {
          failedSourceCount: 1,
          failureCategories: { upstream_list_failed: 1 },
        },
      });
      const serialized = JSON.stringify(error._meta);
      expect(serialized).not.toContain('private');
      expect(serialized).not.toContain('untrusted');
      expect(serialized).not.toContain('credentials');
    },
  );

  it('filters partial metadata by visible failed sources, including sources with no tools', async () => {
    const result = await walkCapabilityPages({
      connections: new Map(),
      kind: 'tools',
      enablePagination: false,
      filterSelection: null,
      upstreamToolAdmissionTimeouts: ['private-a', 'private-a', 'private-c'],
      providers: [
        {
          id: 'private-a',
          name: 'a',
          list: async () => {
            throw new Error('untrusted');
          },
        },
        {
          id: 'private-b',
          name: 'b',
          list: async () => ({ items: ['healthy'] }),
        },
        {
          id: 'private-c',
          name: 'c',
          list: async () => ({ items: [] }),
        },
      ],
    });
    expect(filterCapabilityPartialMeta(result._meta, new Set(['private-b']))).toBeUndefined();
    const unrelated = filterCapabilityPartialMeta({ ...result._meta, unrelated: true }, new Set(['private-b']));
    // A plain copied object has no process-local provenance; attach it explicitly.
    const copied = setCapabilityFailureFacts(
      { ...result._meta, unrelated: true },
      getCapabilityFailureFacts(result._meta),
    );
    expect(filterCapabilityPartialMeta(copied, new Set(['private-b']))).toEqual({ unrelated: true });
    expect(unrelated).toEqual({ ...result._meta, unrelated: true });
    const failedNoTools = filterCapabilityPartialMeta(result._meta, new Set(['private-c']));
    expect(failedNoTools).toMatchObject({
      'app.1mcp/capability-pagination': {
        partial: true,
        failedSourceCount: 1,
        failureCategories: { upstream_tool_admission_timeout: 1 },
      },
    });
    const multipleTools = filterCapabilityPartialMeta(result._meta, new Set(['private-a']));
    expect(multipleTools).toMatchObject({
      'app.1mcp/capability-pagination': {
        failedSourceCount: 1,
        failureCategories: { upstream_list_failed: 1, upstream_tool_admission_timeout: 2 },
      },
    });
    expect([...getCapabilityFailureSources(multipleTools)]).toEqual(['private-a']);
    expect(JSON.stringify(multipleTools)).not.toContain('private-a');
    expect(JSON.stringify(multipleTools)).not.toContain('untrusted');
  });

  it('carries tool-admission failure facts through the final continuation page', async () => {
    const options = {
      connections: new Map(),
      kind: 'tools' as const,
      filterSelection: null,
      enablePagination: true,
      upstreamToolAdmissionTimeouts: ['private-id', 'private-id'],
      providers: [
        {
          id: 'healthy',
          name: 'healthy',
          list: async (cursor?: string) =>
            cursor === undefined ? { items: ['first'], nextCursor: 'next' } : { items: ['final'] },
        },
      ],
    };
    const first = await walkCapabilityPages(options);
    const last = await walkCapabilityPages({ ...options, cursor: first.nextCursor });
    expect(last._meta).toEqual(first._meta);
    expect(last._meta).toMatchObject({
      'app.1mcp/capability-pagination': {
        failedSourceCount: 1,
        failureCategories: { upstream_tool_admission_timeout: 2 },
        recovery: 'restart-walk',
      },
    });
    expect(JSON.stringify(last._meta)).not.toContain('private-id');
    expect([...getCapabilityFailureSources(last._meta)]).toEqual(['private-id']);
    expect([...getCapabilityFailureFacts(last._meta)]).toEqual([
      ['private-id', { upstream_tool_admission_timeout: 2 }],
    ]);
    const filteredMeta = { ...last._meta };
    const facts = new Map([['other-private-id', { upstream_list_failed: 1, upstream_tool_admission_timeout: 2 }]]);
    expect(setCapabilityFailureFacts(filteredMeta, facts)).toBe(filteredMeta);
    facts.get('other-private-id')!.upstream_tool_admission_timeout = 99;
    facts.clear();
    expect([...getCapabilityFailureFacts(filteredMeta)]).toEqual([
      ['other-private-id', { upstream_list_failed: 1, upstream_tool_admission_timeout: 2 }],
    ]);
    expect([...getCapabilityFailureSources(filteredMeta)]).toEqual(['other-private-id']);
    expect(JSON.stringify(filteredMeta)).not.toContain('other-private-id');
    expect(getCapabilityFailureFacts(undefined).size).toBe(0);
    const copied = { ...last._meta };
    const sources = new Set(['other-private-id']);
    expect(setCapabilityFailureSources(copied, sources)).toBe(copied);
    sources.clear();
    expect([...getCapabilityFailureSources(copied)]).toEqual(['other-private-id']);
    expect(JSON.stringify(copied)).not.toContain('other-private-id');
    expect(getCapabilityFailureSources(undefined).size).toBe(0);
    expect(last.nextCursor).toBeUndefined();
  });

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
