import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';

import type { CatalogEntry } from '@src/core/capabilities/catalogGeneration.js';
import type { RuntimeCapabilitySnapshot } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import type { OutboundConnection } from '@src/core/types/index.js';

interface ResourceRoute {
  entry: CatalogEntry;
  connection: OutboundConnection;
  upstreamIdentity: string;
}

/** Derive only the namespace owned by this exact catalog template, never by parsing a display name. */
function catalogPrefix(entry: CatalogEntry): string | undefined {
  const upstreamTemplate = entry.route.upstreamIdentity.trim();
  return entry.route.publicIdentity.endsWith(upstreamTemplate)
    ? entry.route.publicIdentity.slice(0, -upstreamTemplate.length)
    : undefined;
}

export function resolveResourceRoute(snapshot: RuntimeCapabilitySnapshot, identity: string): ResourceRoute {
  const exact = snapshot.resolve('resources', identity);
  if (exact?.connection)
    return { entry: exact.entry, connection: exact.connection, upstreamIdentity: exact.entry.route.upstreamIdentity };
  const matches: ResourceRoute[] = [];
  for (const entry of snapshot.generation.entries) {
    if (entry.route.kind !== 'resourceTemplates') continue;
    const connection = snapshot.connections.get(entry.route.connectionKey);
    if (!connection) continue;
    let matched = false;
    try {
      matched = new UriTemplate(entry.route.publicIdentity).match(identity) !== null;
    } catch {
      continue;
    }
    const prefix = catalogPrefix(entry);
    if (matched && prefix !== undefined && identity.startsWith(prefix))
      matches.push({
        entry,
        connection,
        // The full template selected the route; its owned namespace is removed without decoding URI bytes.
        upstreamIdentity: identity.slice(prefix.length),
      });
  }
  if (matches.length !== 1)
    throw new Error(matches.length ? `Ambiguous resource: ${identity}` : `Unknown resource: ${identity}`);
  return matches[0];
}

export function projectResourceUri(
  snapshot: RuntimeCapabilitySnapshot,
  connectionKey: string,
  upstreamIdentity: string,
): string {
  const matches: string[] = [];
  for (const entry of snapshot.generation.entries) {
    if (entry.route.connectionKey !== connectionKey) continue;
    if (entry.route.kind === 'resources' && entry.route.upstreamIdentity === upstreamIdentity)
      return entry.route.publicIdentity;
    if (entry.route.kind !== 'resourceTemplates') continue;
    try {
      if (new UriTemplate(entry.route.upstreamIdentity).match(upstreamIdentity)) {
        const prefix = catalogPrefix(entry);
        if (prefix !== undefined) matches.push(`${prefix}${upstreamIdentity}`);
      }
    } catch {
      continue;
    }
  }
  if (!matches.length) return snapshot.projectUnlistedResource(connectionKey, upstreamIdentity);
  if (new Set(matches).size !== 1) throw new Error(`Ambiguous upstream resource: ${upstreamIdentity}`);
  return matches[0];
}
