import { createHash } from 'node:crypto';

import type { TemplateContextAuthorization, TemplateContextProof } from '@src/core/context/templateContextTrust.js';
import type { ContextData } from '@src/types/context.js';
import { createContextHash } from '@src/utils/context/contextHash.js';

declare const projectPreparationAuthorityBrand: unique symbol;

/** Process-local evidence of a verified local proof, never a client or persisted field. */
export interface ProjectPreparationAuthority {
  readonly [projectPreparationAuthorityBrand]: true;
}

interface AuthorityEvidence {
  signedContext: ContextData;
  proof: TemplateContextProof;
  signedContextHash: string;
  ownerSessionId: string;
  runtimeScopeId: string;
  canonicalContextHash?: string;
  bindingId?: string;
  verify(context: ContextData, proof: TemplateContextProof, ownerSessionId: string): TemplateContextAuthorization;
}

const evidenceByReceipt = new WeakMap<ProjectPreparationAuthority, AuthorityEvidence>();

function issueReceipt(evidence: AuthorityEvidence): ProjectPreparationAuthority {
  const receipt = Object.freeze({}) as ProjectPreparationAuthority;
  evidenceByReceipt.set(receipt, evidence);
  return receipt;
}

function immutableSnapshot<T>(value: T): T {
  const snapshot = structuredClone(value);
  function freeze(entry: unknown): void {
    if (!entry || typeof entry !== 'object') return;
    for (const child of Object.values(entry)) freeze(child);
    Object.freeze(entry);
  }
  freeze(snapshot);
  return snapshot;
}

/** Called only at the existing proof boundary, with its actual authorization result. */
export function createProjectPreparationAuthority(input: {
  context: ContextData;
  proof?: TemplateContextProof;
  authorization: TemplateContextAuthorization;
  verify: AuthorityEvidence['verify'];
}): ProjectPreparationAuthority | undefined {
  const { authorization, proof, context } = input;
  if (authorization.status !== 'trusted' || authorization.provenance !== 'verified-local' || !proof) return;
  const signedContextHash = createContextHash(context);
  if (authorization.contextHash !== signedContextHash || proof.contextHash !== signedContextHash) return;
  if (authorization.runtimeScopeId !== proof.runtimeScopeId) return;
  if (context.sessionId !== proof.sessionId) return;
  return issueReceipt({
    signedContext: immutableSnapshot(context),
    proof: immutableSnapshot(proof),
    signedContextHash,
    ownerSessionId: proof.sessionId,
    runtimeScopeId: proof.runtimeScopeId,
    verify: input.verify,
  });
}

/** Bind the proof's raw context to the trusted runtime's canonicalization result. */
export function normalizeProjectPreparationAuthority(
  authority: ProjectPreparationAuthority | undefined,
  sourceContext: ContextData,
  canonicalContext: ContextData,
): ProjectPreparationAuthority | undefined {
  if (!authority) return;
  const evidence = evidenceByReceipt.get(authority);
  if (!evidence || createContextHash(sourceContext) !== (evidence.canonicalContextHash ?? evidence.signedContextHash)) {
    throw new Error('Project preparation authority does not match its source context');
  }
  if (canonicalContext.sessionId !== evidence.ownerSessionId) {
    throw new Error('Project preparation authority owner changed');
  }
  const canonicalContextHash = createContextHash(canonicalContext);
  if (evidence.canonicalContextHash && evidence.canonicalContextHash !== canonicalContextHash) {
    throw new Error('Project preparation authority canonical context changed');
  }
  return issueReceipt({ ...evidence, canonicalContextHash });
}

/** Identity is stable across renewed proofs, and separates verified authority from legacy bindings. */
export function getProjectPreparationAuthorityIdentity(
  authority: ProjectPreparationAuthority | undefined,
  context: ContextData,
): string | undefined {
  if (!authority) return;
  const evidence = evidenceByReceipt.get(authority);
  if (!evidence || evidence.canonicalContextHash !== createContextHash(context)) {
    throw new Error('Project preparation authority does not match the canonical context');
  }
  return createHash('sha256')
    .update(
      JSON.stringify({
        ownerSessionId: evidence.ownerSessionId,
        runtimeScopeId: evidence.runtimeScopeId,
        signedContextHash: evidence.signedContextHash,
        canonicalContextHash: evidence.canonicalContextHash,
      }),
    )
    .digest('hex');
}

export function bindProjectPreparationAuthority(
  authority: ProjectPreparationAuthority | undefined,
  bindingId: string,
  context: ContextData,
): ProjectPreparationAuthority | undefined {
  if (!authority) return;
  getProjectPreparationAuthorityIdentity(authority, context);
  const evidence = evidenceByReceipt.get(authority)!;
  if (evidence.bindingId && evidence.bindingId !== bindingId) {
    throw new Error('Project preparation authority binding changed');
  }
  return issueReceipt({ ...evidence, bindingId });
}

/** A stored receipt is not a grant. Reverify its current local proof authority on every admission. */
export function validateProjectPreparationAuthority(
  authority: ProjectPreparationAuthority | undefined,
  input: { bindingId: string; context: ContextData; ownerSessionId: string },
): boolean {
  if (!authority) return false;
  const evidence = evidenceByReceipt.get(authority);
  if (!evidence) return false;
  if (evidence.bindingId !== input.bindingId) return false;
  if (evidence.ownerSessionId !== input.ownerSessionId || input.context.sessionId !== input.ownerSessionId)
    return false;
  if (evidence.canonicalContextHash !== createContextHash(input.context)) return false;
  try {
    const authorization = evidence.verify(evidence.signedContext, evidence.proof, evidence.ownerSessionId);
    if (authorization.status !== 'trusted') return false;
    if (authorization.provenance !== 'verified-local') return false;
    if (authorization.runtimeScopeId !== evidence.runtimeScopeId) return false;
    return authorization.contextHash === evidence.signedContextHash;
  } catch {
    return false;
  }
}
