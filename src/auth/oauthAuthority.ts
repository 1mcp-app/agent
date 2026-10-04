import { createHash, scrypt, scryptSync } from 'node:crypto';

import { z } from 'zod';

export const OAUTH_ATTEMPT_TTL_MS = 15 * 60 * 1000;
export const OAUTH_MAX_ATTEMPTS = 32;
export const OAUTH_AUTHORITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OAuthRouteSchema = z.object({
  kind: z.enum(['http', 'sse']),
  connectionKey: z.string().min(1),
  url: z.url(),
});
export const OAuthAuthorityContextSchema = z.object({
  owner: z.string().min(1),
  source: z.string().min(1),
  route: OAuthRouteSchema,
  configuration: z.string().min(1),
});
export type OAuthAuthorityContext = z.infer<typeof OAuthAuthorityContextSchema>;
export const OAuthAuthoritySchema = OAuthAuthorityContextSchema.extend({
  version: z.literal(1),
  issuer: z.string().min(1),
  resource: z.url(),
  authorizationEndpoint: z.url(),
  tokenEndpoint: z.url(),
  registrationEndpoint: z.url().optional(),
  requireIssuer: z.boolean(),
});
export type OAuthAuthority = z.infer<typeof OAuthAuthoritySchema>;
export const OAuthAttemptSchema = z.object({
  authority: OAuthAuthoritySchema,
  generation: z.string().min(1),
  redirect: z.string().min(1),
  verifier: z.string().min(43).max(128),
  createdAt: z.number(),
  expires: z.number(),
  consumed: z.boolean(),
  adminReturnOrigin: z.string().optional(),
});
export type OAuthAttempt = z.infer<typeof OAuthAttemptSchema>;
export const BoundClientSessionSchema = z.object({
  authority: OAuthAuthoritySchema,
  generation: z.string().min(1),
  revision: z.number().int().nonnegative(),
  clientInfo: z.string().optional(),
  tokens: z.string().optional(),
  discovery: z.string(),
  attempts: z.record(z.string(), OAuthAttemptSchema),
  createdAt: z.number(),
  expires: z.number(),
});
export type BoundClientSession = z.infer<typeof BoundClientSessionSchema>;
export function oauthDigest(value: unknown): string {
  // This deterministic digest identifies durable OAuth authority/configuration state
  // and correlates opaque protocol values; it does not store or verify passwords.
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
const authoritySlots = new Map<string, string>();
const fingerprintOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Secret-bearing configuration fingerprints must resist offline guessing. */
export function oauthConfigurationFingerprint(value: unknown, scope: unknown): string {
  return scryptSync(
    JSON.stringify(value),
    JSON.stringify(['1mcp-oauth-config-v1', scope]),
    32,
    fingerprintOptions,
  ).toString('hex');
}

export async function oauthConfigurationFingerprintAsync(value: unknown, scope: unknown): Promise<string> {
  const input = JSON.stringify(value);
  const salt = JSON.stringify(['1mcp-oauth-config-v1', scope]);
  const fingerprint = await new Promise<Buffer>((resolve, reject) => {
    scrypt(input, salt, 32, fingerprintOptions, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
  return fingerprint.toString('hex');
}

export function authoritySlot(context: OAuthAuthorityContext): string {
  // These stable identity labels contain no configuration credentials.
  const identity = [context.owner, context.source, context.route.connectionKey];
  const key = JSON.stringify(identity);
  const cached = authoritySlots.get(key);
  if (cached !== undefined) return cached;
  const slot = oauthConfigurationFingerprint(identity, 'authority-slot');
  if (authoritySlots.size >= 128) authoritySlots.delete(authoritySlots.keys().next().value!);
  authoritySlots.set(key, slot);
  return slot;
}

export function sameAuthority(a: OAuthAuthority, b: OAuthAuthority): boolean {
  return JSON.stringify(OAuthAuthoritySchema.parse(a)) === JSON.stringify(OAuthAuthoritySchema.parse(b));
}
export function matchesAuthorityContext(authority: OAuthAuthority, context: OAuthAuthorityContext): boolean {
  return (
    JSON.stringify(OAuthAuthorityContextSchema.parse(authority)) ===
    JSON.stringify(OAuthAuthorityContextSchema.parse(context))
  );
}
export function oauthAuthorityError(): Error {
  return new Error('OAuth authority or authorization attempt is no longer valid; start authorization again');
}

export class OAuthAuthorizationDeniedError extends Error {
  constructor(readonly errorCode: 'access_denied' | 'provider_error') {
    super('OAuth authorization was denied; start authorization again');
  }
}
