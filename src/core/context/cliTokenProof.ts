import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { TemplateContextCapability } from './templateContextTrust.js';

const MAX_PROOF_AGE_MS = 30_000;
const AUTHORIZATION_SCHEME = '1MCP-CLI ';
const proofSchema = z
  .object({
    version: z.literal(1),
    runtimeScopeId: z.string().min(1).max(256),
    issuedAt: z.number().int(),
    signature: z.string().max(128),
  })
  .strict();
type CliTokenProof = z.infer<typeof proofSchema>;

function signature(proof: Omit<CliTokenProof, 'signature'>, capability: TemplateContextCapability): string {
  return createHmac('sha256', Buffer.from(capability.secret, 'base64url'))
    .update(JSON.stringify(['1mcp-cli-token-v1', proof.runtimeScopeId, proof.issuedAt]))
    .digest('base64url');
}

/** A short-lived, purpose-separated proof; the runtime's root secret never leaves its owner-only file. */
export function createCliTokenAuthorization(capability: TemplateContextCapability, now = Date.now()): string {
  const unsigned = { version: 1 as const, runtimeScopeId: capability.runtimeScopeId, issuedAt: now };
  const proof = { ...unsigned, signature: signature(unsigned, capability) };
  return AUTHORIZATION_SCHEME + Buffer.from(JSON.stringify(proof)).toString('base64url');
}

export function verifyCliTokenAuthorization(
  authorization: unknown,
  capability: TemplateContextCapability,
  now = Date.now(),
): boolean {
  if (typeof authorization !== 'string') return false;
  if (authorization.length > 2048) return false;
  if (!authorization.startsWith(AUTHORIZATION_SCHEME)) return false;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(authorization.slice(AUTHORIZATION_SCHEME.length), 'base64url').toString('utf8'));
  } catch {
    return false;
  }
  const parsed = proofSchema.safeParse(value);
  if (!parsed.success) return false;
  const proof = parsed.data;
  if (proof.runtimeScopeId !== capability.runtimeScopeId) return false;
  const age = now - proof.issuedAt;
  if (age < 0) return false;
  if (age > MAX_PROOF_AGE_MS) return false;
  const expected = Buffer.from(signature(proof, capability));
  const actual = Buffer.from(proof.signature);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
