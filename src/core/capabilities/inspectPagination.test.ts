import { describe, expect, it } from 'vitest';

import { paginateInspectTools } from './inspectPagination.js';

describe('inspect pagination', () => {
  it('rejects malformed, stale and differently scoped cursors', () => {
    const tools = ['a', 'b'];
    const first = paginateInspectTools(tools, { limit: 1, scope: 'server' });
    expect(() => paginateInspectTools(tools, { limit: 1, scope: 'server', cursor: 'invalid' })).toThrow(
      'Invalid or stale',
    );
    expect(() => paginateInspectTools(['a', 'c'], { limit: 1, scope: 'server', cursor: first.nextCursor })).toThrow(
      'Invalid or stale',
    );
    expect(() => paginateInspectTools(tools, { limit: 1, scope: 'other', cursor: first.nextCursor })).toThrow(
      'Invalid or stale',
    );
    expect(paginateInspectTools(tools, { limit: 1, scope: 'server', cursor: first.nextCursor })).toMatchObject({
      tools: ['b'],
      hasMore: false,
    });
  });

  it('rejects invalid offsets and returns an empty inventory without a cursor', () => {
    const first = paginateInspectTools(['a', 'b'], { limit: 1, scope: 'server' });
    const decoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'));
    for (const offset of [-1, 0, 1.5, 2, Number.MAX_SAFE_INTEGER + 1]) {
      const cursor = Buffer.from(JSON.stringify({ ...decoded, offset })).toString('base64url');
      expect(() => paginateInspectTools(['a', 'b'], { limit: 1, scope: 'server', cursor })).toThrow('Invalid or stale');
    }
    expect(paginateInspectTools([], { limit: 1, scope: 'server' })).toEqual({
      tools: [],
      totalTools: 0,
      hasMore: false,
      nextCursor: undefined,
    });
  });

  it('returns all remaining tools with all, including inventories exceeding upstream page size', () => {
    const tools = Array.from({ length: 5001 }, (_, index) => index);
    expect(paginateInspectTools(tools, { limit: 5000, all: true, scope: 'server' }).tools).toHaveLength(5001);
    const first = paginateInspectTools(tools, { limit: 1, scope: 'server' });
    expect(
      paginateInspectTools(tools, { limit: 1, all: true, scope: 'server', cursor: first.nextCursor }).tools,
    ).toHaveLength(5000);
  });
});
