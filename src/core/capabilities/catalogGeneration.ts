import { MCP_SERVER_NAME, MCP_URI_SEPARATOR } from '@src/constants/mcp.js';
import { type ImmutableJsonValue, toImmutableJsonValue } from '@src/gateway/contracts/immutableJson.js';
import {
  toProtocolPrompt,
  toProtocolResource,
  toProtocolResourceTemplate,
  toProtocolTool,
} from '@src/sdk/contracts/index.js';
import { buildUri } from '@src/utils/core/parsing.js';

export type CapabilityKind = 'tools' | 'prompts' | 'resources' | 'resourceTemplates';
export type CapabilityOrigin = 'external' | 'internal';
export type CatalogObject = Readonly<Record<string, ImmutableJsonValue>>;

export interface CapabilitySourceIdentity {
  readonly kind: CapabilityKind;
  readonly server: string;
  readonly connectionKey: string;
  readonly upstreamIdentity: string;
}

export interface CapabilityRoute extends CapabilitySourceIdentity {
  readonly publicIdentity: string;
  readonly origin: CapabilityOrigin;
}

export interface CapabilitySource {
  readonly kind: CapabilityKind;
  readonly server: string;
  readonly connectionKey: string;
  readonly object: unknown;
  readonly origin?: CapabilityOrigin;
  /** Only trusted internal capabilities may retain a raw public identity. */
  readonly publicIdentity?: string;
}

export interface CatalogEntry {
  readonly route: CapabilityRoute;
  readonly sourceObject: CatalogObject;
  readonly publicObject: CatalogObject;
}

export interface CatalogDiagnostic {
  readonly kind: CapabilityKind;
  readonly server: string;
  readonly connectionKey: string;
  readonly reason: 'invalid-source' | 'identity-collision';
}

export interface CatalogGeneration {
  readonly id: number;
  readonly entries: readonly CatalogEntry[];
  readonly quarantine: readonly CatalogDiagnostic[];
  resolve(kind: CapabilityKind, publicIdentity: string, connectionKeys?: ReadonlySet<string>): CatalogEntry | undefined;
}

const converters = {
  tools: toProtocolTool,
  prompts: toProtocolPrompt,
  resources: toProtocolResource,
  resourceTemplates: toProtocolResourceTemplate,
};

const identityFields = { tools: 'name', prompts: 'name', resources: 'uri', resourceTemplates: 'uriTemplate' } as const;
const routeMetadataKey = 'app.1mcp/route';

function objectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reservedKey(key: string): boolean {
  return key === 'app.1mcp' || key.startsWith('app.1mcp/') || key.startsWith('app.1mcp.');
}

function hasReservedOwnership(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasReservedOwnership);
  return (
    objectValue(value) && Object.entries(value).some(([key, child]) => reservedKey(key) || hasReservedOwnership(child))
  );
}

/** Reads gateway provenance on a received public object; never grants local routing authority. */
export function readPublicCapabilityRoute(
  value: unknown,
): Pick<CapabilityRoute, 'kind' | 'server' | 'upstreamIdentity'> | undefined {
  if (!objectValue(value) || !objectValue(value._meta)) return undefined;
  const route = value._meta[routeMetadataKey];
  if (
    !objectValue(route) ||
    typeof route.kind !== 'string' ||
    !Object.hasOwn(identityFields, route.kind) ||
    typeof route.server !== 'string' ||
    typeof route.upstreamIdentity !== 'string'
  )
    return undefined;
  return Object.freeze({
    kind: route.kind as CapabilityKind,
    server: route.server,
    upstreamIdentity: route.upstreamIdentity,
  });
}

function capture(source: CapabilitySource): CatalogEntry {
  const origin = source.origin ?? 'external';
  if (
    !source.server.trim() ||
    !source.connectionKey.trim() ||
    (origin === 'external' && (source.server.trim() === MCP_SERVER_NAME || source.publicIdentity !== undefined)) ||
    (origin === 'internal' && source.server !== MCP_SERVER_NAME)
  )
    throw new TypeError('Invalid capability source identity');

  const normalized = converters[source.kind](source.object) as unknown as Record<string, unknown>;
  if (
    Object.keys(normalized).some(reservedKey) ||
    ['_meta', 'annotations', 'extensions', 'namespaces'].some((key) => hasReservedOwnership(normalized[key]))
  )
    throw new TypeError('Source asserted reserved ownership');
  const identityField = identityFields[source.kind];
  const upstreamIdentity = normalized[identityField];
  if (typeof upstreamIdentity !== 'string' || !upstreamIdentity.trim())
    throw new TypeError('Invalid capability identity');
  const publicIdentity = source.publicIdentity ?? buildUri(source.server, upstreamIdentity, MCP_URI_SEPARATOR);
  if (!publicIdentity.trim()) throw new TypeError('Invalid public identity');
  const route = Object.freeze({
    kind: source.kind,
    server: source.server,
    connectionKey: source.connectionKey,
    upstreamIdentity,
    publicIdentity,
    origin,
  });
  return Object.freeze({
    route,
    sourceObject: toImmutableJsonValue(normalized) as CatalogObject,
    publicObject: toImmutableJsonValue({
      ...normalized,
      [identityField]: publicIdentity,
      _meta: {
        ...(objectValue(normalized._meta) ? normalized._meta : {}),
        [routeMetadataKey]: { kind: source.kind, server: source.server, upstreamIdentity },
      },
    }) as CatalogObject,
  });
}

/** Builds privately, then exposes only frozen records and an exact, closure-owned index. */
export function buildCatalogGeneration(id: number, sources: readonly CapabilitySource[]): CatalogGeneration {
  if (!Number.isSafeInteger(id) || id < 0) throw new TypeError('Invalid catalog generation');
  const quarantine: CatalogDiagnostic[] = [];
  const candidates: CatalogEntry[] = [];
  const reject = (source: CapabilitySourceIdentity | CapabilitySource, reason: CatalogDiagnostic['reason']): void => {
    quarantine.push(
      Object.freeze({ kind: source.kind, server: source.server, connectionKey: source.connectionKey, reason }),
    );
  };
  for (const source of sources) {
    try {
      candidates.push(capture(source));
    } catch {
      reject(source, 'invalid-source');
    }
  }
  const groups = new Map<string, CatalogEntry[]>();
  const sourceGroups = new Map<string, CatalogEntry[]>();
  for (const entry of candidates) {
    const key = JSON.stringify([entry.route.kind, entry.route.publicIdentity]);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
    const sourceKey = JSON.stringify([
      entry.route.kind,
      entry.route.server,
      entry.route.connectionKey,
      entry.route.upstreamIdentity,
    ]);
    const sourceGroup = sourceGroups.get(sourceKey) ?? [];
    sourceGroup.push(entry);
    sourceGroups.set(sourceKey, sourceGroup);
  }
  const collisions = new Set([...sourceGroups.values()].filter((group) => group.length > 1).flat());
  const index = new Map<string, readonly CatalogEntry[]>();
  for (const group of groups.values()) {
    const logicalSources = new Set(
      group.map(({ route }) => JSON.stringify([route.server, route.upstreamIdentity, route.origin])),
    );
    const connections = new Set(group.map(({ route }) => route.connectionKey));
    if (logicalSources.size > 1 || connections.size !== group.length) {
      for (const entry of group) collisions.add(entry);
    }
  }
  for (const [key, group] of groups) {
    const accepted = group.filter((entry) => !collisions.has(entry));
    if (accepted.length) index.set(key, Object.freeze(accepted));
  }
  for (const entry of collisions) reject(entry.route, 'identity-collision');
  return Object.freeze({
    id,
    entries: Object.freeze([...index.values()].flat()),
    quarantine: Object.freeze(quarantine),
    resolve(
      kind: CapabilityKind,
      publicIdentity: string,
      connectionKeys?: ReadonlySet<string>,
    ): CatalogEntry | undefined {
      const matches = index
        .get(JSON.stringify([kind, publicIdentity]))
        ?.filter((entry) => !connectionKeys || connectionKeys.has(entry.route.connectionKey));
      return matches?.length === 1 ? matches[0] : undefined;
    },
  });
}
