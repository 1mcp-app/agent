import { describe, expect, it } from 'vitest';

import { buildTagAuthoringQuery, evaluateTagAuthoringQuery, parseTagAuthoringQuery } from './tagAuthoring.js';

describe('tag authoring', () => {
  it('builds TUI-compatible include and exclude queries', () => {
    expect(buildTagAuthoringQuery({ web: 'include', api: 'include', private: 'exclude' }, 'or')).toEqual({
      $and: [{ $or: [{ tag: 'web' }, { tag: 'api' }] }, { $not: { tag: 'private' } }],
    });
  });

  it('round-trips supported structured queries and rejects lossy shapes', () => {
    const query = { $and: [{ tag: 'web' }, { $not: { tag: 'private' } }] };
    expect(parseTagAuthoringQuery(query)).toEqual({
      strategy: 'and',
      states: { web: 'include', private: 'exclude' },
    });
    expect(parseTagAuthoringQuery({ $or: [{ tag: 'web' }, { $not: { tag: 'private' } }] })).toBeNull();
    expect(parseTagAuthoringQuery({ $and: [{ tag: 'web' }, { tag: 'api' }] })).toEqual({
      strategy: 'and',
      states: { web: 'include', api: 'include' },
    });
  });

  it('evaluates the shared query semantics for live impact', () => {
    const query = buildTagAuthoringQuery({ web: 'include', private: 'exclude' }, 'and');
    expect(evaluateTagAuthoringQuery(query, ['web'])).toBe(true);
    expect(evaluateTagAuthoringQuery(query, ['web', 'private'])).toBe(false);
  });
});
