import {
  authorizeTemplateContext,
  createTemplateContextProof,
  type TemplateContextTrustMode,
} from '@src/core/context/templateContextTrust.js';
import type { ContextData } from '@src/types/context.js';

import { describe, expect, it, vi } from 'vitest';

import {
  bindProjectPreparationAuthority,
  createProjectPreparationAuthority,
  getProjectPreparationAuthorityIdentity,
  normalizeProjectPreparationAuthority,
  type ProjectPreparationAuthority,
  validateProjectPreparationAuthority,
} from './projectPreparationAuthority.js';

function fixture() {
  const context: ContextData = {
    project: { path: './frontend' },
    user: {},
    environment: {},
    sessionId: 'session-a',
    projectSet: { projects: [{ label: 'front', path: './frontend' }], selection: ['front'] },
  };
  let mode: TemplateContextTrustMode = 'verified';
  let now = Date.parse('2026-10-11T00:00:00Z');
  let capability = {
    version: 1 as const,
    runtimeScopeId: 'runtime-a',
    secret: Buffer.alloc(32, 7).toString('base64url'),
  };
  const proof = createTemplateContextProof(context, capability, { now: () => new Date(now) });
  const verify = vi.fn((signedContext, signedProof, ownerSessionId) =>
    authorizeTemplateContext({
      context: signedContext,
      proof: signedProof,
      transportSessionId: ownerSessionId,
      mode,
      capability,
      maxAgeMs: 1000,
      now: () => now,
    }),
  );
  const authority = createProjectPreparationAuthority({
    context,
    proof,
    authorization: verify(context, proof, context.sessionId),
    verify,
  })!;
  const canonical: ContextData = {
    ...context,
    project: { path: '/repo/frontend', cwd: '/repo/frontend', name: 'front' },
    projectSet: { projects: [{ label: 'front', path: '/repo/frontend' }], selection: ['front'] },
  };
  const normalized = normalizeProjectPreparationAuthority(authority, context, canonical)!;
  const bound = bindProjectPreparationAuthority(normalized, 'binding-a', canonical)!;
  const admission = { bindingId: 'binding-a', context: canonical, ownerSessionId: 'session-a' };
  return {
    context,
    proof,
    authority,
    canonical,
    normalized,
    bound,
    admission,
    verify,
    setMode: (value: TemplateContextTrustMode) => {
      mode = value;
    },
    expire: () => {
      now += 1001;
    },
    rotate: () => {
      capability = { ...capability, secret: Buffer.alloc(32, 9).toString('base64url') };
    },
    changeRuntime: () => {
      capability = { ...capability, runtimeScopeId: 'runtime-b' };
    },
    renew: () => {
      const renewedProof = createTemplateContextProof(context, capability, { now: () => new Date(now) });
      const renewed = createProjectPreparationAuthority({
        context,
        proof: renewedProof,
        authorization: verify(context, renewedProof, context.sessionId),
        verify,
      });
      return bindProjectPreparationAuthority(
        normalizeProjectPreparationAuthority(renewed, context, canonical),
        'binding-a',
        canonical,
      );
    },
  };
}

describe('project preparation authority', () => {
  it('revalidates the original signed context after trusted canonicalization on every admission', () => {
    const f = fixture();
    f.verify.mockClear();
    expect(validateProjectPreparationAuthority(f.bound, f.admission)).toBe(true);
    expect(validateProjectPreparationAuthority(f.bound, f.admission)).toBe(true);
    expect(f.verify).toHaveBeenCalledTimes(2);
    expect(f.verify).toHaveBeenLastCalledWith(f.context, f.proof, 'session-a');
  });

  it.each(['legacy', 'disabled'] as const)('revokes retained authority when current trust becomes %s', (mode) => {
    const f = fixture();
    f.setMode(mode);
    expect(validateProjectPreparationAuthority(f.bound, f.admission)).toBe(false);
  });

  it.each(['expire', 'rotate', 'changeRuntime'] as const)('rechecks current local authority on %s', (operation) => {
    const f = fixture();
    f[operation]();
    expect(validateProjectPreparationAuthority(f.bound, f.admission)).toBe(false);
  });

  it('rejects JSON clones, unbound receipts and other binding owners or contexts', () => {
    const f = fixture();
    const clone = JSON.parse(JSON.stringify(f.bound)) as ProjectPreparationAuthority;
    expect(JSON.stringify(f.bound)).toBe('{}');
    expect(validateProjectPreparationAuthority(clone, f.admission)).toBe(false);
    expect(validateProjectPreparationAuthority(f.normalized, f.admission)).toBe(false);
    expect(validateProjectPreparationAuthority(f.bound, { ...f.admission, bindingId: 'binding-b' })).toBe(false);
    expect(validateProjectPreparationAuthority(f.bound, { ...f.admission, ownerSessionId: 'session-b' })).toBe(false);
    expect(
      validateProjectPreparationAuthority(f.bound, {
        ...f.admission,
        context: { ...f.canonical, project: { path: '/repo/backend' } },
      }),
    ).toBe(false);
  });

  it('does not mint filesystem preparation authority from legacy or untrusted context', () => {
    const f = fixture();
    const legacy = authorizeTemplateContext({ context: f.context, mode: 'legacy' });
    const untrusted = authorizeTemplateContext({ context: f.context, mode: 'verified' });
    expect(
      createProjectPreparationAuthority({
        context: f.context,
        proof: f.proof,
        authorization: legacy,
        verify: f.verify,
      }),
    ).toBeUndefined();
    expect(
      createProjectPreparationAuthority({
        context: f.context,
        proof: f.proof,
        authorization: untrusted,
        verify: f.verify,
      }),
    ).toBeUndefined();
    expect(validateProjectPreparationAuthority(undefined, f.admission)).toBe(false);
  });

  it('snapshots proof and context so later mutation cannot change retained evidence', () => {
    const f = fixture();
    f.context.project.path = '/repo/backend';
    f.proof.signature = 'changed';
    expect(validateProjectPreparationAuthority(f.bound, f.admission)).toBe(true);
  });

  it('rejects source substitution, canonical changes and rebinding an already bound receipt', () => {
    const f = fixture();
    expect(() => normalizeProjectPreparationAuthority(f.authority, { ...f.context, project: {} }, f.canonical)).toThrow(
      'source context',
    );
    expect(() =>
      normalizeProjectPreparationAuthority(f.normalized, f.canonical, { ...f.canonical, sessionId: 'session-b' }),
    ).toThrow('owner changed');
    expect(() => bindProjectPreparationAuthority(f.bound, 'binding-b', f.canonical)).toThrow('binding changed');
  });

  it('renews a proof without changing binding identity while keeping runtime authorities separate', () => {
    const f = fixture();
    const originalIdentity = getProjectPreparationAuthorityIdentity(f.bound, f.canonical);
    f.expire();
    expect(validateProjectPreparationAuthority(f.bound, f.admission)).toBe(false);
    const renewed = f.renew();
    expect(getProjectPreparationAuthorityIdentity(renewed, f.canonical)).toBe(originalIdentity);
    expect(validateProjectPreparationAuthority(renewed, f.admission)).toBe(true);
    f.changeRuntime();
    expect(getProjectPreparationAuthorityIdentity(f.renew(), f.canonical)).not.toBe(originalIdentity);
    expect(getProjectPreparationAuthorityIdentity(undefined, f.canonical)).toBeUndefined();
  });
});
