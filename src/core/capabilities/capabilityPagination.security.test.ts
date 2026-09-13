import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  advanceCapabilityPaginationGeneration,
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
});
