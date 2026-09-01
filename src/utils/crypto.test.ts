import { createHash as cryptoCreateHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createHash } from './crypto.js';

describe('createHash', () => {
  it('does not expose an unkeyed SHA-256 digest of secret-bearing input', () => {
    const input = 'https://user:password@example.com/mcp';
    const unkeyedDigest = cryptoCreateHash('sha256').update(input).digest('hex');

    expect(createHash(input)).not.toBe(unkeyedDigest);
    expect(createHash(input)).toBe(createHash(input));
  });
});
