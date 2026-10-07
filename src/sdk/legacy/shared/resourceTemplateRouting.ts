import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';

import type { CatalogEntry } from '@src/core/capabilities/catalogGeneration.js';
import type { RuntimeCapabilitySnapshot } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import type { OutboundConnection } from '@src/core/types/index.js';
import { ResourceRouteNotFoundError } from '@src/gateway/contracts/gatewayFailure.js';
import { isValidResourceUri } from '@src/utils/core/resourceUris.js';

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
  if (!isValidResourceUri(identity)) throw new Error('Invalid resource URI');
  const exact = snapshot.resolve('resources', identity);
  if (exact?.connection) {
    if (!isValidResourceUri(exact.entry.route.upstreamIdentity)) throw new Error('Invalid upstream resource URI');
    return { entry: exact.entry, connection: exact.connection, upstreamIdentity: exact.entry.route.upstreamIdentity };
  }
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
    if (!matched || prefix === undefined || !identity.startsWith(prefix)) continue;
    const upstreamIdentity = identity.slice(prefix.length);
    if (!isValidResourceUri(upstreamIdentity)) continue;
    matches.push({
      entry,
      connection,
      // The full template selected the route; its owned namespace is removed without decoding URI bytes.
      upstreamIdentity,
    });
  }
  if (matches.length === 0) throw new ResourceRouteNotFoundError(identity);
  if (matches.length !== 1) throw new Error(`Ambiguous resource: ${identity}`);
  return matches[0];
}

export function projectResourceUri(
  snapshot: RuntimeCapabilitySnapshot,
  connectionKey: string,
  upstreamIdentity: string,
): string {
  if (!isValidResourceUri(upstreamIdentity)) throw new Error('Invalid upstream resource URI');
  const matches: string[] = [];
  for (const entry of snapshot.generation.entries) {
    if (entry.route.connectionKey !== connectionKey) continue;
    if (entry.route.kind === 'resources' && entry.route.upstreamIdentity === upstreamIdentity)
      return entry.route.publicIdentity;
    if (entry.route.kind !== 'resourceTemplates') continue;
    try {
      if (new UriTemplate(entry.route.upstreamIdentity).match(upstreamIdentity)) {
        const prefix = catalogPrefix(entry);
        if (prefix !== undefined) {
          const publicIdentity = `${prefix}${upstreamIdentity}`;
          if (isValidResourceUri(publicIdentity)) matches.push(publicIdentity);
        }
      }
    } catch {
      continue;
    }
  }
  if (!matches.length) return snapshot.projectUnlistedResource(connectionKey, upstreamIdentity);
  if (new Set(matches).size !== 1) throw new Error(`Ambiguous upstream resource: ${upstreamIdentity}`);
  return matches[0];
}
