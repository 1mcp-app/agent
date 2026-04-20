import { describe, expect, it } from 'vitest';

import { stripMcpSuffix } from './urlUtils.js';

describe('stripMcpSuffix', () => {
  it('removes a trailing /mcp segment', () => {
    expect(stripMcpSuffix('http://localhost:3050/mcp')).toBe('http://localhost:3050');
  });

  it('removes a trailing /mcp/ segment', () => {
    expect(stripMcpSuffix('http://localhost:3050/mcp/')).toBe('http://localhost:3050');
  });

  it('removes /mcp before a query string', () => {
    expect(stripMcpSuffix('http://localhost:3050/mcp?x=1')).toBe('http://localhost:3050?x=1');
  });

  it('removes /mcp before a hash fragment', () => {
    expect(stripMcpSuffix('http://localhost:3050/mcp/#details')).toBe('http://localhost:3050#details');
  });
});
