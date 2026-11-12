import { describe, expect, it } from 'vitest';

import { createCliTokenAuthorization, verifyCliTokenAuthorization } from './cliTokenProof.js';
import { createTemplateContextProof } from './templateContextTrust.js';

const capability = {
  version: 1 as const,
  runtimeScopeId: 'scope-a',
  secret: Buffer.alloc(32, 1).toString('base64url'),
};

describe('local CLI token authority', () => {
  it('accepts a fresh purpose-bound proof without transmitting the root secret', () => {
    const authorization = createCliTokenAuthorization(capability, 100_000);
    expect(verifyCliTokenAuthorization(authorization, capability, 100_001)).toBe(true);
    expect(Buffer.from(authorization.slice('1MCP-CLI '.length), 'base64url').toString()).not.toContain(
      capability.secret,
    );
  });

  it('rejects missing, malformed, wrong-key, wrong-scope, expired and future proofs', () => {
    const proof = createCliTokenAuthorization(capability, 100_000);
    for (const invalid of [undefined, '', 'Bearer token', '1MCP-CLI invalid', ['1MCP-CLI invalid']]) {
      expect(verifyCliTokenAuthorization(invalid, capability, 100_000)).toBe(false);
    }
    expect(verifyCliTokenAuthorization(proof, { ...capability, runtimeScopeId: 'scope-b' }, 100_000)).toBe(false);
    expect(
      verifyCliTokenAuthorization(proof, { ...capability, secret: Buffer.alloc(32, 2).toString('base64url') }, 100_000),
    ).toBe(false);
    expect(verifyCliTokenAuthorization(proof, capability, 130_001)).toBe(false);
    expect(verifyCliTokenAuthorization(proof, capability, 99_999)).toBe(false);
  });

  it('does not accept a template context proof as token issuance authority', () => {
    const owner = createTemplateContextProof(
      { project: { path: '/test' }, user: {}, environment: {}, sessionId: 'test-session' },
      capability,
    );
    const authorization = '1MCP-CLI ' + Buffer.from(JSON.stringify(owner)).toString('base64url');
    expect(verifyCliTokenAuthorization(authorization, capability)).toBe(false);
  });
});
