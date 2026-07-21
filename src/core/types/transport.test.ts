import { describe, expect, it } from 'vitest';

import { transportConfigSchema } from './transport.js';

describe('transportConfigSchema stderr', () => {
  it.each(['inherit', 'ignore', 'overlapped', 'pipe'] as const)('accepts %s', (stderr) => {
    expect(transportConfigSchema.parse({ type: 'stdio', command: 'node', stderr }).stderr).toBe(stderr);
  });

  it('accepts a numeric file descriptor', () => {
    expect(transportConfigSchema.parse({ type: 'stdio', command: 'node', stderr: 2 }).stderr).toBe(2);
  });

  it('rejects unsupported stderr strings', () => {
    expect(() => transportConfigSchema.parse({ type: 'stdio', command: 'node', stderr: 'verbose' })).toThrow();
  });
});
