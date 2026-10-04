import { isValidTagName } from '@src/utils/validation/scopeValidation.js';

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface CloudflareAccessJwtConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly groupTagMap: Readonly<Record<string, readonly string[]>>;
}

export interface CloudflareAccessIdentity {
  readonly subject: string;
  readonly email?: string;
  readonly expiresAt: number;
  readonly scopes: readonly string[];
}

export type CloudflareAccessTokenVerifier = (token: string) => Promise<CloudflareAccessIdentity>;

export function parseCloudflareAccessGroupTagMap(value: string | undefined): Record<string, string[]> {
  if (value === undefined || value.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError('Cloudflare Access group-to-tag map must be valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Cloudflare Access group-to-tag map must be a JSON object');
  }
  const result: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const [group, tags] of Object.entries(parsed as Record<string, unknown>)) {
    if (!group.trim() || group.length > 255 || !Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) {
      throw new TypeError('Each Cloudflare Access group mapping must contain a group name and a string tag array');
    }
    if (!(tags as string[]).every(isValidTagName)) {
      throw new TypeError(`Cloudflare Access group '${group}' contains an invalid 1MCP tag`);
    }
    Object.defineProperty(result, group, {
      configurable: false,
      enumerable: true,
      value: [...new Set(tags as string[])],
      writable: false,
    });
  }
  return result;
}

function validatedIssuer(issuer: string): URL {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new TypeError('Cloudflare Access issuer must be an HTTPS team-domain URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !url.hostname.endsWith('.cloudflareaccess.com')
  ) {
    throw new TypeError('Cloudflare Access issuer must be an HTTPS <team>.cloudflareaccess.com URL');
  }
  return url;
}

function identityGroups(payload: Record<string, unknown>): string[] {
  const custom = payload.custom;
  if (custom === undefined) return [];
  if (custom === null || typeof custom !== 'object' || Array.isArray(custom)) {
    throw new TypeError('Cloudflare Access custom claims must be an object');
  }
  const groups = (custom as Record<string, unknown>).groups;
  if (groups === undefined) return [];
  if (!Array.isArray(groups) || groups.length > 256 || !groups.every((group) => typeof group === 'string')) {
    throw new TypeError('Cloudflare Access custom.groups must be an array of group strings');
  }
  return [...new Set(groups as string[])];
}

function scopesForGroups(
  groups: readonly string[],
  groupTagMap: Readonly<Record<string, readonly string[]>>,
): string[] {
  const tags = new Set<string>();
  for (const group of groups) {
    const mappedTags = Object.hasOwn(groupTagMap, group) ? groupTagMap[group] : undefined;
    for (const tag of mappedTags ?? []) {
      if (!isValidTagName(tag)) throw new TypeError(`Invalid Cloudflare Access group-to-tag mapping for tag '${tag}'`);
      tags.add(tag);
    }
  }
  return [...tags].sort().map((tag) => `tag:${tag}`);
}

/** Verifies Access assertions against the team's rotating signing keys and app audience. */
export function createCloudflareAccessTokenVerifier(
  config: CloudflareAccessJwtConfig,
  keySet?: JWTVerifyGetKey,
): CloudflareAccessTokenVerifier {
  if (!config.audience.trim()) throw new TypeError('Cloudflare Access audience is required');
  const issuer = validatedIssuer(config.issuer);
  const jwks = keySet ?? createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));

  return async (token: string): Promise<CloudflareAccessIdentity> => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: issuer.origin,
      audience: config.audience,
      algorithms: ['RS256'],
    });
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new TypeError('Cloudflare Access assertion must contain a future expiry');
    }
    if (payload.type !== 'app') throw new TypeError('Cloudflare Access assertion must be an application token');
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new TypeError('Cloudflare Access assertion is missing its user subject');
    }
    if (payload.email !== undefined && typeof payload.email !== 'string') {
      throw new TypeError('Cloudflare Access assertion email must be a string');
    }

    const groups = identityGroups(payload as Record<string, unknown>);
    return Object.freeze({
      subject: payload.sub,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      expiresAt: payload.exp,
      scopes: scopesForGroups(groups, config.groupTagMap),
    });
  };
}
