import { createHash } from 'node:crypto';

import { MCP_URI_SEPARATOR } from '@src/constants/mcp.js';

import { InvalidRequestError } from './errorTypes.js';
import { buildUri } from './parsing.js';

const MAX_PUBLIC_TOOL_NAME_LENGTH = 64;
const HASH_LENGTH = 16;

export function isValidPublicToolName(name: string): boolean {
  if (!name.length) return false;
  if (name.length > MAX_PUBLIC_TOOL_NAME_LENGTH) return false;
  return !/[^A-Za-z0-9_.-]/u.test(name);
}

/** Public names are display identities; only the catalog's exact route grants routing authority. */
export function buildPublicToolName(server: string, upstreamIdentity: string): string {
  const canonical = buildUri(server, upstreamIdentity, MCP_URI_SEPARATOR);
  for (const character of canonical) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) {
      throw new InvalidRequestError('Tool identity must contain only Unicode scalar values');
    }
  }
  if (isValidPublicToolName(canonical)) return canonical;

  // Match historical whitespace normalization, but never hash an ambiguous concatenated identity.
  // Backend instances, catalog generations, and visibility do not change the public name.
  const hash = createHash('sha256')
    .update(JSON.stringify([server.trim(), upstreamIdentity.trim()]))
    .digest('hex');
  const prefix = canonical.replace(/[^A-Za-z0-9_.-]/gu, '_').slice(0, MAX_PUBLIC_TOOL_NAME_LENGTH - HASH_LENGTH - 1);
  return `${prefix}_${hash.slice(0, HASH_LENGTH)}`;
}

/** Configuration may reference an exact source name, its historical qualified name, or its current public name. */
export function getSourceToolConfigReferences(server: string, upstreamIdentity: string): readonly string[] {
  return [
    upstreamIdentity.trim(),
    buildUri(server, upstreamIdentity, MCP_URI_SEPARATOR),
    buildPublicToolName(server, upstreamIdentity),
  ];
}

/** Config-only edits retain opaque public references while supporting historical qualified inputs. */
export function matchesToolConfigReference(server: string, requested: string, configured: string): boolean {
  if (toolConfigReferenceVariants(server, requested).has(configured)) return true;
  return toolConfigReferenceVariants(server, configured).has(requested);
}

function toolConfigReferenceVariants(server: string, reference: string): ReadonlySet<string> {
  const normalized = reference.trim();
  const prefix = `${server}${MCP_URI_SEPARATOR}`;
  const legacyRaw = normalized.startsWith(prefix) ? normalized.slice(prefix.length).trim() : normalized;
  const variants = new Set([normalized]);
  for (const sourceName of [normalized, legacyRaw]) {
    if (!sourceName) continue;
    variants.add(sourceName);
    variants.add(`${prefix}${sourceName}`);
    try {
      variants.add(buildPublicToolName(server, sourceName));
    } catch {
      // Invalid config-only references stay opaque and never grant a catalog route.
    }
  }
  return variants;
}
