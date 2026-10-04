import { createHash, createHmac, randomBytes, scrypt, scryptSync } from 'node:crypto';

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
const fingerprintCache = new Map<string, string>();
const fingerprintCacheKey = randomBytes(32);
const fingerprintOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function fingerprintInput(value: unknown, scope: unknown) {
  const input = JSON.stringify(value);
  const salt = JSON.stringify(['1mcp-oauth-config-v1', scope]);
  // Cache neither raw configuration secrets nor a guessable unkeyed digest.
  const key = createHmac('sha256', fingerprintCacheKey)
    .update(JSON.stringify([input, salt]))
    .digest('hex');
  return { input, salt, key };
}

function rememberFingerprint(key: string, fingerprint: string): string {
  if (fingerprintCache.size >= 128) fingerprintCache.delete(fingerprintCache.keys().next().value!);
  fingerprintCache.set(key, fingerprint);
  return fingerprint;
}

/** Secret-bearing configuration fingerprints must resist offline guessing. */
export function oauthConfigurationFingerprint(value: unknown, scope: unknown): string {
  const { input, salt, key } = fingerprintInput(value, scope);
  const cached = fingerprintCache.get(key);
  if (cached !== undefined) return cached;
  // Stable scope salt preserves restart identity while separating configured authorities.
  return rememberFingerprint(key, scryptSync(input, salt, 32, fingerprintOptions).toString('hex'));
}

export async function oauthConfigurationFingerprintAsync(value: unknown, scope: unknown): Promise<string> {
  const { input, salt, key } = fingerprintInput(value, scope);
  const cached = fingerprintCache.get(key);
  if (cached !== undefined) return cached;
  const fingerprint = await new Promise<Buffer>((resolve, reject) => {
    scrypt(input, salt, 32, fingerprintOptions, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
  return rememberFingerprint(key, fingerprint.toString('hex'));
}

export function authoritySlot(context: OAuthAuthorityContext): string {
  return oauthConfigurationFingerprint([context.owner, context.source, context.route.connectionKey], 'authority-slot');
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
