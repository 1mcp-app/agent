import { toProtocolTool } from '@src/sdk/contracts/index.js';

import { describe, expect, it } from 'vitest';

import { buildCatalogGeneration } from './catalogGeneration.js';
import { searchInspectTools } from './inspectSearch.js';

const tools = buildCatalogGeneration(
  1,
  [
    { name: 'a.b', description: 'Read documents', inputSchema: { type: 'object' } },
    { name: 'axb', description: 'a'.repeat(10000), inputSchema: { type: 'object' } },
  ].map((object) => ({ kind: 'tools', server: 'runner', connectionKey: 'runner', object })),
).entries.map((entry) => toProtocolTool(entry.publicObject));

const search = (query: string, extra = {}) =>
  searchInspectTools(tools, { search: query, ...extra }, {}, { complete: true });

describe('inspect search matching', () => {
  it('matches literal punctuation and whole-reference wildcards without regex semantics', () => {
    expect(search('a.b').tools.map((tool) => tool.tool)).toEqual(['a.b']);
    expect(search('RUNNER/a.?', { glob: true }).tools.map((tool) => tool.tool)).toEqual(['a.b']);
    expect(search('a.?', { glob: true }).tools).toEqual([]);
    expect(search('runner/*', { glob: true }).totalTools).toBe(2);
    expect(search('runner/[ab]*', { glob: true }).totalTools).toBe(0);
  });

  it('handles adversarial wildcard near-matches without regex backtracking', () => {
    expect(search(`${'*a'.repeat(100)}b`, { glob: true, 'include-descriptions': true }).tools).toEqual([]);
  });

  it('keeps description matching independent from display and rejects mode changes on continuation', () => {
    expect(search('documents').totalTools).toBe(0);
    expect(search('documents', { 'show-descriptions': true }).totalTools).toBe(0);
    expect(search('documents', { 'include-descriptions': true }).tools[0]).not.toHaveProperty('description');
    expect(search('documents', { 'include-descriptions': true, 'show-descriptions': true }).tools[0].description).toBe(
      'Read documents',
    );
    const first = search('runner', { limit: 1 });
    expect(() => search('runner', { limit: 1, cursor: first.nextCursor, 'include-descriptions': true })).toThrow(
      'stale',
    );
  });
});
