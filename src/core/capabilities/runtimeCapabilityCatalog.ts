import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { isSourceToolDisabled } from '@src/core/server/disabledTools.js';
import { parseTemplateConnectionKey } from '@src/core/server/templateIdentity.js';
import { applySourceToolDescription } from '@src/core/server/toolDescriptionOverrides.js';
import {
  ClientStatus,
  type MCPServerParams,
  type OutboundConnection,
  type OutboundConnections,
} from '@src/core/types/index.js';
import { SchemaBoundaryError } from '@src/core/validation/schemaBoundary.js';
import {
  admitToolSchemas,
  prepareToolValidation,
  projectToolSchemas,
  type ToolSchemaContracts,
} from '@src/core/validation/toolSchemaBoundary.js';
import { ErrorCode, OneMcpProtocolError, type Tool } from '@src/sdk/contracts/index.js';
import { MCPError } from '@src/utils/core/errorTypes.js';

import {
  CapabilityCursorCapacityError,
  type CapabilityPage,
  type CapabilityPageProvider,
  type CapabilityPaginationResult,
  type CapabilityResponseBudget,
  compareCodePoints,
  createCapabilityPartialMeta,
  getCapabilityPaginationGeneration,
  registerCapabilityPaginationNotifications,
  unregisterCapabilityPaginationConnections,
  walkCapabilityPages,
} from './capabilityPagination.js';
import {
  type CapabilityVisibility,
  isResourceRouteOwnerActive,
  type ResourceRouteOwner,
} from './capabilityVisibility.js';
import {
  buildCatalogGeneration,
  type CapabilityKind,
  type CapabilitySource,
  type CatalogEntry,
  type CatalogGeneration,
} from './catalogGeneration.js';
import {
  clearConfiguredToolSnapshot,
  publishCompleteConfiguredToolTargetSnapshots,
  publishConfiguredToolSnapshot,
} from './configuredToolSnapshot.js';

/** Only backend replacement is eligible for the aggregate's single collection retry. */
export class RuntimeCatalogBackendChangedError extends Error {
  constructor() {
    super('Capability catalog backend changed; retry the request');
    this.name = 'RuntimeCatalogBackendChangedError';
  }
}

const METHODS: Record<CapabilityKind, string> = {
  tools: 'tools/list',
  prompts: 'prompts/list',
  resources: 'resources/list',
  resourceTemplates: 'resources/templates/list',
};

export interface RuntimeCatalogOptions {
  signal?: AbortSignal;
  serverConfigs?: Record<string, MCPServerParams>;
  internalTools?: readonly unknown[];
  internalResources?: readonly unknown[];
  internalPrompts?: readonly unknown[];
  internalResourceTemplates?: readonly unknown[];
  unprefixedTools?: readonly Tool[];
  continuation?: {
    kind: CapabilityKind;
    cursor: string;
    enablePagination: boolean;
    pageSize?: number;
    internalOnly?: boolean;
    filterSelection?: unknown;
  };
}

interface SourcePages {
  kind: CapabilityKind;
  key: string;
  server: string;
  pages: Map<string | undefined, CapabilityPage<unknown>>;
  error?: unknown;
}

export interface PreparedToolCall {
  (result: unknown): Promise<void>;
  assertCurrent(): void;
}

export interface RuntimeCapabilitySnapshot {
  readonly generation: CatalogGeneration;
  /** Synchronous completeness facts from this captured observation, independent of pagination walks. */
  readonly capabilityMeta?: Partial<Record<CapabilityKind, Record<string, unknown>>>;
  prepareToolCall(identity: string, args: unknown, signal?: AbortSignal): Promise<PreparedToolCall>;
  /** The same admitted schema projection used by tools/list, with its captured source fence. */
  getToolDefinition(identity: string): { tool: Record<string, unknown>; assertCurrent(): void } | undefined;
  readonly connections: ReadonlyMap<string, OutboundConnection>;
  isCurrent(): boolean;
  /** Whether a captured backend failed to enumerate this kind, leaving the snapshot partial. */
  hasFailedSources(kind: CapabilityKind): boolean;
  /** Issue an owner- or session-scoped, backend-bound route for a resource absent from discovery. */
  projectUnlistedResource(connectionKey: string, upstreamIdentity: string): string;
  resolve(
    kind: CapabilityKind,
    publicIdentity: string,
  ): { entry: CatalogEntry; connection?: OutboundConnection } | undefined;
  list<T>(
    kind: CapabilityKind,
    options: {
      cursor?: string;
      enablePagination: boolean;
      pageSize?: number;
      filterSelection?: unknown;
      internalOnly?: boolean;
      visibility?: CapabilityVisibility;
      serverConfigs?: Record<string, MCPServerParams>;
      /** Set when the page becomes a client response; see {@link CapabilityResponseBudget}. */
      responseBudget?: CapabilityResponseBudget<T>;
    },
  ): Promise<CapabilityPaginationResult<T>>;
}

interface RuntimeResourceRoute {
  entry: CatalogEntry;
  connection: OutboundConnection;
  adapter: OutboundConnection['adapter'];
  sessionId?: string;
  owner?: ResourceRouteOwner;
  expiresAt: number;
  resourcesEpoch: string;
  templatesEpoch: string;
}

interface RuntimeScope {
  sessionId?: string;
  latestStarted: number;
  lastAccess: number;
  snapshot?: RuntimeCapabilitySnapshot;
  observedTools?: { started: number; fingerprints: ReadonlyMap<string, string | null> };
  admissionOutcomes: Map<string, { started: number; connectionKey: string; error?: SchemaBoundaryError }>;
  paginationConnections: OutboundConnections;
  resourceSources: Map<string, OutboundConnections>;
  resourceRoutes: Map<string, RuntimeResourceRoute>;
}

interface RuntimeState {
  nextId: number;
  scopes: Map<string, RuntimeScope>;
}
const states = new WeakMap<OutboundConnections, RuntimeState>();
const issuedResourceEntries = new WeakSet<CatalogEntry>();

/** Provenance alone grants no authority: each read must also assert its current owner and route. */
export function isIssuedRuntimeResourceEntry(entry: CatalogEntry): boolean {
  return issuedResourceEntries.has(entry);
}

let activeAcquisitions = 0;
const MAX_ACTIVE_ACQUISITIONS = 256;
export const RUNTIME_CATALOG_SCOPE_TTL_MS = 15 * 60 * 1000;
export const MAX_RUNTIME_CATALOG_SCOPES = 256;

function resourceRouteIsCurrent(scope: RuntimeScope, route: RuntimeResourceRoute): boolean {
  if (Date.now() >= route.expiresAt) return false;
  if (route.owner && !isResourceRouteOwnerActive(route.owner)) return false;
  const source = scope.resourceSources.get(route.entry.route.connectionKey);
  return (
    !!source &&
    getCapabilityPaginationGeneration(source, 'resources') === route.resourcesEpoch &&
    getCapabilityPaginationGeneration(source, 'resourceTemplates') === route.templatesEpoch
  );
}

function pruneResourceRoutes(scope: RuntimeScope, connections: OutboundConnections): void {
  const retainedSources = new Set<string>();
  for (const [identity, route] of scope.resourceRoutes) {
    const key = route.entry.route.connectionKey;
    if (
      !resourceRouteIsCurrent(scope, route) ||
      connections.get(key) !== route.connection ||
      route.connection.adapter !== route.adapter ||
      route.connection.status !== ClientStatus.Connected
    ) {
      scope.resourceRoutes.delete(identity);
    } else retainedSources.add(key);
  }
  for (const [key, source] of scope.resourceSources) {
    if (retainedSources.has(key)) continue;
    unregisterCapabilityPaginationConnections(source);
    scope.resourceSources.delete(key);
  }
}

function releaseResourceRoutes(scope: RuntimeScope): void {
  scope.resourceRoutes.clear();
  for (const source of scope.resourceSources.values()) unregisterCapabilityPaginationConnections(source);
  scope.resourceSources.clear();
}

function resourceRouteOwnedBy(route: RuntimeResourceRoute, visibility: CapabilityVisibility | undefined): boolean {
  if (visibility?.resourceOwner) return route.owner === visibility.resourceOwner;
  return route.owner === undefined && route.sessionId === visibility?.sessionId;
}

/** Reclaim revoked listener owners without changing legacy session or cursor ownership. */
export function pruneRuntimeResourceRoutes(connections: OutboundConnections): void {
  for (const scope of states.get(connections)?.scopes.values() ?? []) pruneResourceRoutes(scope, connections);
}

/** Release all visibility variants and in-flight publications owned by a disconnected session. */
export function evictRuntimeCapabilityCatalogSession(connections: OutboundConnections, sessionId: string): void {
  const state = states.get(connections);
  if (!state) return;
  for (const [key, scope] of state.scopes) {
    for (const [identity, route] of scope.resourceRoutes) {
      if (!route.owner && route.sessionId === sessionId) scope.resourceRoutes.delete(identity);
    }
    pruneResourceRoutes(scope, connections);
    if (scope.sessionId !== sessionId) continue;
    state.scopes.delete(key);
    unregisterCapabilityPaginationConnections(scope.paginationConnections);
    scope.paginationConnections.clear();
    releaseResourceRoutes(scope);
  }
}

/** Acquire all route and projection facts before dispatching any capability operation. */
export async function acquireRuntimeCapabilityCatalog(
  connections: OutboundConnections,
  visibility?: CapabilityVisibility,
  options: RuntimeCatalogOptions = {},
): Promise<RuntimeCapabilitySnapshot> {
  if (activeAcquisitions >= MAX_ACTIVE_ACQUISITIONS) {
    throw new CapabilityCursorCapacityError();
  }
  activeAcquisitions++;
  try {
    return await collectRuntimeCapabilityCatalog(connections, visibility, options);
  } finally {
    activeAcquisitions--;
  }
}

async function collectRuntimeCapabilityCatalog(
  connections: OutboundConnections,
  visibility: CapabilityVisibility | undefined,
  options: RuntimeCatalogOptions,
): Promise<RuntimeCapabilitySnapshot> {
  options = { ...options, serverConfigs: structuredClone(options.serverConfigs ?? {}) };
  let state = states.get(connections);
  if (!state) {
    state = { nextId: 1, scopes: new Map() };
    states.set(connections, state);
  }
  for (const [key, retained] of state.scopes) {
    pruneResourceRoutes(retained, connections);
    if (Date.now() - retained.lastAccess < RUNTIME_CATALOG_SCOPE_TTL_MS) continue;
    state.scopes.delete(key);
    unregisterCapabilityPaginationConnections(retained.paginationConnections);
    retained.paginationConnections.clear();
    releaseResourceRoutes(retained);
  }
  const captured = new Map(
    Array.from(connections).filter(
      ([key, connection]) =>
        connection.status === ClientStatus.Connected && (!visibility || visibility.serverCandidates.has(key)),
    ),
  );
  const capturedAdapters = new Map(Array.from(captured, ([key, connection]) => [key, connection.adapter]));
  const { continuation, signal, ...catalogOptions } = options;
  signal?.throwIfAborted();
  const scopeSessionId = isSessionIndependent(visibility) ? undefined : visibility?.sessionId;
  const scope = createHash('sha256')
    .update(
      JSON.stringify(
        [
          Array.from(captured.keys()).sort(),
          scopeSessionId,
          visibility?.filterSelection,
          catalogOptions,
          visibility ? Array.from(visibility.serverCandidates).sort(([a], [b]) => compareCodePoints(a, b)) : null,
        ],
        (_key, value: unknown) =>
          value !== null && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareCodePoints(left, right)))
            : value,
      ),
    )
    .digest('hex');
  if (continuation) {
    const scopedPrevious = state.scopes.get(scope)?.snapshot;
    const previous =
      scopedPrevious ??
      Array.from(state.scopes.values())
        .reverse()
        .find((item) => item.snapshot)?.snapshot;
    if (previous) {
      await previous.list(continuation.kind, { ...continuation, visibility, serverConfigs: options.serverConfigs });
      if (!scopedPrevious)
        throw new MCPError('Invalid capability pagination cursor', ErrorCode.InvalidParams, {
          reason: 'stale_generation',
        });
      return previous;
    }
    await walkCapabilityPages({
      connections,
      providers: [],
      kind: continuation.kind,
      cursor: continuation.cursor,
      enablePagination: continuation.enablePagination,
      filterSelection: visibility?.filterSelection,
    });
    throw new Error('Capability cursor has no captured generation');
  }
  const started = state.nextId++;
  let currentScope = state.scopes.get(scope);
  if (!currentScope) {
    if (state.scopes.size >= MAX_RUNTIME_CATALOG_SCOPES) throw new CapabilityCursorCapacityError();
    currentScope = {
      sessionId: scopeSessionId,
      latestStarted: started,
      lastAccess: Date.now(),
      paginationConnections: new Map(captured),
      resourceRoutes: new Map(),
      resourceSources: new Map(),
      admissionOutcomes: new Map(),
    };
    state.scopes.set(scope, currentScope);
  }
  currentScope.latestStarted = started;
  currentScope.lastAccess = Date.now();
  const scopedState = currentScope;
  const observedConnections = scopedState.paginationConnections;
  for (const [identity, route] of scopedState.resourceRoutes) {
    if (
      captured.get(route.entry.route.connectionKey) !== route.connection ||
      route.connection.adapter !== route.adapter
    )
      scopedState.resourceRoutes.delete(identity);
  }
  const observeConnections = () => {
    observedConnections.clear();
    for (const key of captured.keys()) {
      const connection = connections.get(key);
      if (connection) {
        observedConnections.set(key, connection);
        registerCapabilityPaginationNotifications(observedConnections, connection);
      }
    }
  };
  const filterSelection = structuredClone(visibility?.filterSelection);
  const isCurrent = () =>
    state.scopes.get(scope) === scopedState &&
    Array.from(captured).every(
      ([key, connection]) =>
        connections.get(key) === connection &&
        connection.adapter === capturedAdapters.get(key) &&
        connection.status === ClientStatus.Connected,
    );
  const assertCurrent = () => {
    if (!isCurrent()) {
      throw new RuntimeCatalogBackendChangedError();
    }
  };
  const sources: CapabilitySource[] = [];
  const sourcePages: SourcePages[] = [];
  let capturedItems = 0;
  let capturedBytes = 0;
  await Promise.all(
    Array.from(captured, async ([key, connection]) => {
      const server = visibility?.serverCandidates.get(key) ?? connection.name ?? key;
      await Promise.all(
        (Object.keys(METHODS) as CapabilityKind[]).map(async (kind) => {
          const capability = kind === 'resourceTemplates' ? 'resources' : kind;
          if (!connection.capabilities?.[capability]) return;
          const provider: SourcePages = { kind, key, server, pages: new Map() };
          sourcePages.push(provider);
          let cursor: string | undefined;
          const seen = new Set<string>();
          try {
            do {
              const result = await requestLegacyAdapter<Record<string, unknown>>(
                capturedAdapters.get(key)!,
                METHODS[kind],
                cursor === undefined ? undefined : { cursor },
                { timeoutMs: connection.requestTimeoutMs, signal },
              );
              if (!Array.isArray(result[kind])) throw new Error(`Invalid ${kind} list result`);
              const items = result[kind] as unknown[];
              capturedItems += items.length;
              capturedBytes += Buffer.byteLength(JSON.stringify(items));
              if (capturedItems > 100000 || capturedBytes > 32 * 1024 * 1024) {
                throw new Error('Capability snapshot capacity exceeded');
              }
              if (result.nextCursor !== undefined && typeof result.nextCursor !== 'string') {
                throw new Error('Invalid capability continuation cursor');
              }
              const nextCursor = result.nextCursor;
              if (nextCursor !== undefined) {
                const cursorBytes = Buffer.byteLength(nextCursor);
                if (cursorBytes > 64 * 1024) throw new Error('Upstream cursor capacity exceeded');
                capturedBytes += cursorBytes;
                if (capturedBytes > 32 * 1024 * 1024) throw new Error('Capability snapshot capacity exceeded');
              }
              provider.pages.set(cursor, { items, nextCursor });
              cursor = nextCursor;
              if (cursor !== undefined && (seen.has(cursor) || provider.pages.size >= 1000)) {
                throw new Error('Upstream pagination did not terminate');
              }
              if (cursor !== undefined) seen.add(cursor);
            } while (cursor !== undefined);
          } catch (error) {
            signal?.throwIfAborted();
            if (provider.pages.size === 0 && isUnimplementedResourceTemplates(kind, error)) {
              provider.pages.set(undefined, { items: [] });
              return;
            }
            provider.error = error;
            // Retain every captured page, but never replay the failed or looping continuation.
            const lastPage = [...provider.pages.values()].at(-1);
            if (lastPage) lastPage.nextCursor = undefined;
          }
          for (const page of provider.pages.values()) {
            for (const object of page.items) sources.push({ kind, server, connectionKey: key, object });
          }
        }),
      );
    }),
  );

  signal?.throwIfAborted();
  for (const kind of Object.keys(METHODS) as CapabilityKind[]) {
    let items: readonly unknown[] | undefined;
    switch (kind) {
      case 'tools':
        items = options.internalTools;
        break;
      case 'resources':
        items = options.internalResources;
        break;
      case 'prompts':
        items = options.internalPrompts;
        break;
      default:
        items = options.internalResourceTemplates;
    }
    if (!items?.length) continue;
    const key = `\0app.1mcp/${kind}`;
    sourcePages.push({ kind, key, server: '1mcp', pages: new Map([[undefined, { items: [...items] }]]) });
    for (const object of items) sources.push({ kind, server: '1mcp', connectionKey: key, origin: 'internal', object });
  }
  if (options.unprefixedTools?.length) {
    const key = '\0app.1mcp/meta-tools';
    sourcePages.push({
      kind: 'tools',
      key,
      server: '1mcp',
      pages: new Map([[undefined, { items: [...options.unprefixedTools] }]]),
    });
    for (const object of options.unprefixedTools)
      sources.push({
        kind: 'tools',
        server: '1mcp',
        connectionKey: key,
        origin: 'internal',
        object,
        publicIdentity: object.name,
      });
  }

  const disconnected = new Set<string>();
  for (const [key, connection] of captured) {
    if (connections.get(key) !== connection || connection.adapter !== capturedAdapters.get(key))
      throw new RuntimeCatalogBackendChangedError();
    if (connection.status !== ClientStatus.Connected) {
      disconnected.add(key);
      captured.delete(key);
      clearConfiguredToolSnapshot(connection);
    }
  }
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    if (disconnected.has(sources[index].connectionKey)) sources.splice(index, 1);
  }
  for (let index = sourcePages.length - 1; index >= 0; index -= 1) {
    if (disconnected.has(sourcePages[index].key)) sourcePages.splice(index, 1);
  }
  assertCurrent();
  sources.sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.connectionKey.localeCompare(right.connectionKey),
  );
  sourcePages.sort((left, right) => left.key.localeCompare(right.key) || left.kind.localeCompare(right.kind));
  const sourceFingerprints = new Map<string, string | null>();
  for (const source of sources) {
    if (source.kind !== 'tools') continue;
    const key = JSON.stringify([source.connectionKey, (source.object as { name?: unknown } | null)?.name]);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify(source, (_key, value: unknown) =>
          value !== null && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareCodePoints(left, right)))
            : value,
        ),
      )
      .digest('hex');
    // A collision is not a usable source contract, even before admission finishes.
    sourceFingerprints.set(key, sourceFingerprints.has(key) ? null : fingerprint);
  }
  if (!scopedState.observedTools || started > scopedState.observedTools.started) {
    scopedState.observedTools = { started, fingerprints: sourceFingerprints };
    for (const [routeKey, outcome] of scopedState.admissionOutcomes) {
      if (sourceFingerprints.has(routeKey)) continue;
      const provider = sourcePages.find((page) => page.kind === 'tools' && page.key === outcome.connectionKey);
      // Failed listing does not prove a previously observed tool was removed.
      if (provider?.error) continue;
      scopedState.admissionOutcomes.delete(routeKey);
    }
  }
  const recordAdmission = (routeKey: string, connectionKey: string, error?: SchemaBoundaryError) => {
    if (!scopedState.observedTools?.fingerprints.has(routeKey)) return;
    const previous = scopedState.admissionOutcomes.get(routeKey);
    if (previous && previous.started > started) return;
    if (!previous && scopedState.admissionOutcomes.size >= 100000) throw new CapabilityCursorCapacityError();
    scopedState.admissionOutcomes.set(routeKey, { started, connectionKey, error });
    if (!error) return;
    const connection = captured.get(connectionKey);
    if (connection) publishConfiguredToolSnapshot(connection, [], false);
  };
  const schemaContracts = new Map<string, ToolSchemaContracts>();
  const admissionTimeouts: string[] = [];
  for (let index = 0; index < sources.length;) {
    const source = sources[index];
    if (source.kind !== 'tools') {
      index++;
      continue;
    }
    const object = source.object as Record<string, unknown>;
    const routeKey = JSON.stringify([source.connectionKey, object?.name]);
    try {
      schemaContracts.set(
        routeKey,
        await admitToolSchemas(object, {
          routeKey,
          generation: String(started),
          sourceRevision: captured.get(source.connectionKey)?.adapter.protocolRevision,
          signal,
        }),
      );
      signal?.throwIfAborted();
      recordAdmission(routeKey, source.connectionKey);
      index++;
    } catch (error) {
      signal?.throwIfAborted();
      recordAdmission(
        routeKey,
        source.connectionKey,
        error instanceof SchemaBoundaryError ? error : new SchemaBoundaryError('schema_invalid'),
      );
      if (!(error instanceof SchemaBoundaryError)) throw error;
      if (source.origin === 'internal') throw error;
      if (error.phase !== 'admission') throw error;
      if (error.code === 'schema_evaluation_unavailable') throw error;
      if (error.code === 'schema_evaluation_timeout') {
        admissionTimeouts.push(source.connectionKey);
      } else if (error.retryable) {
        throw error;
      }
      sources.splice(index, 1);
    }
  }
  assertCurrent();
  signal?.throwIfAborted();
  const generation = buildCatalogGeneration(started, sources, { allowTemplateInstances: visibility === undefined });
  const keys = new Set(captured.keys());
  for (const source of sources) if (source.origin === 'internal') keys.add(source.connectionKey);
  const accepted = new Map<string, CatalogEntry>();
  for (const entry of generation.entries) {
    accepted.set(JSON.stringify([entry.route.kind, entry.route.connectionKey, entry.route.upstreamIdentity]), entry);
  }
  const publicItems = (kind: CapabilityKind, key: string, items: unknown[]): unknown[] =>
    items.flatMap<unknown>((item) => {
      if (!item || typeof item !== 'object') return [];
      const raw = item as Record<string, unknown>;
      const identity = getCapabilityIdentity(kind, raw);
      const entry = accepted.get(JSON.stringify([kind, key, identity]));
      if (!entry) return [];
      if (kind === 'tools') {
        if (isSourceToolDisabled(options.serverConfigs ?? {}, entry.route.server, entry.route.upstreamIdentity))
          return [];
        const effective = applySourceToolDescription(
          entry.sourceObject as unknown as Tool,
          options.serverConfigs?.[entry.route.server],
          entry.route.server,
        );
        return [
          Object.freeze({
            ...projectToolSchemas(
              entry.publicObject as Record<string, unknown>,
              schemaContracts.get(JSON.stringify([key, entry.route.upstreamIdentity]))!,
            ),
            ...(effective.description === undefined ? {} : { description: effective.description }),
          }),
        ];
      }
      return [entry.publicObject];
    });
  for (const provider of sourcePages)
    for (const [cursor, page] of provider.pages) {
      provider.pages.set(cursor, { ...page, items: publicItems(provider.kind, provider.key, page.items) });
    }
  const entriesJson = JSON.stringify([
    generation.entries,
    admissionTimeouts,
    sourcePages.map((provider) => ({
      kind: provider.kind,
      key: provider.key,
      failed: !!provider.error,
      pages: [...provider.pages].map(([cursor, page]) => [cursor, page.nextCursor, page.items.length]),
    })),
  ]);
  let lastConfigsJson: string | undefined;
  let lastSignature: string;
  const signature = (serverConfigs: Record<string, MCPServerParams> | undefined) => {
    const configsJson = JSON.stringify(serverConfigs ?? null);
    if (configsJson !== lastConfigsJson) {
      lastSignature = createHash('sha256').update(`[${entriesJson},${configsJson}]`).digest('hex');
      lastConfigsJson = configsJson;
    }
    return lastSignature;
  };
  const capabilityMeta: Partial<Record<CapabilityKind, Record<string, unknown>>> = {};
  for (const kind of Object.keys(METHODS) as CapabilityKind[]) {
    const meta = createCapabilityPartialMeta(
      String(generation.id),
      sourcePages.filter((provider) => provider.kind === kind && provider.error).map((provider) => provider.key),
      kind === 'tools' ? admissionTimeouts : [],
    );
    if (meta) capabilityMeta[kind] = meta;
  }
  const snapshot: RuntimeCapabilitySnapshot = Object.freeze({
    generation,
    ...(Object.keys(capabilityMeta).length > 0 ? { capabilityMeta: Object.freeze(capabilityMeta) } : {}),
    getToolDefinition(identity: string) {
      const resolved = snapshot.resolve('tools', identity);
      if (!resolved) return undefined;
      const routeKey = JSON.stringify([resolved.entry.route.connectionKey, resolved.entry.route.upstreamIdentity]);
      const contract = schemaContracts.get(routeKey);
      if (!contract) throw new SchemaBoundaryError('schema_invalid');
      const assertContractCurrent = () => {
        assertCurrent();
        // Admission outcomes invalidate routes even when a newer pending read suppresses publication.
        const failure = scopedState.admissionOutcomes.get(routeKey)?.error;
        if (failure) throw new SchemaBoundaryError(failure.code, failure.retryable, failure.phase);
        // A known changed/removed source invalidates just this route, including an
        // admission that fails. Starting an otherwise identical read does not.
        if (scopedState.observedTools?.fingerprints.get(routeKey) !== sourceFingerprints.get(routeKey))
          throw new SchemaBoundaryError('schema_invalid');
        const latest = scopedState.snapshot?.resolve('tools', identity);
        if (
          !latest ||
          latest.connection !== resolved.connection ||
          !isDeepStrictEqual(latest.entry.route, resolved.entry.route) ||
          !isDeepStrictEqual(latest.entry.sourceObject, resolved.entry.sourceObject)
        )
          throw new SchemaBoundaryError('schema_invalid');
      };
      assertContractCurrent();
      return Object.freeze({
        tool: Object.freeze(projectToolSchemas(resolved.entry.publicObject as Record<string, unknown>, contract)),
        assertCurrent: assertContractCurrent,
      });
    },
    async prepareToolCall(identity: string, args: unknown, signal?: AbortSignal) {
      const definition = snapshot.getToolDefinition(identity);
      if (!definition) throw new SchemaBoundaryError('schema_invalid');
      const resolved = snapshot.resolve('tools', identity)!;
      const routeKey = JSON.stringify([resolved.entry.route.connectionKey, resolved.entry.route.upstreamIdentity]);
      const contract = schemaContracts.get(routeKey)!;
      const validateOutput = await prepareToolValidation(contract, args, {
        routeKey,
        generation: String(started),
        signal,
      });
      definition.assertCurrent();
      return Object.freeze(Object.assign(validateOutput, { assertCurrent: definition.assertCurrent }));
    },
    connections: readonlyConnections(captured),
    isCurrent,
    hasFailedSources(kind: CapabilityKind) {
      return sourcePages.some((provider) => provider.kind === kind && provider.error !== undefined);
    },
    projectUnlistedResource(connectionKey: string, upstreamIdentity: string) {
      assertCurrent();
      if (visibility?.resourceOwner && !isResourceRouteOwnerActive(visibility.resourceOwner))
        throw new Error('Resource route owner is unavailable');
      pruneResourceRoutes(scopedState, connections);
      const connection = captured.get(connectionKey);
      if (!connection) throw new Error('Unknown resource backend');
      for (const [identity, route] of scopedState.resourceRoutes) {
        if (
          resourceRouteOwnedBy(route, visibility) &&
          route.entry.route.connectionKey === connectionKey &&
          route.entry.route.upstreamIdentity === upstreamIdentity
        )
          return identity;
      }
      if (scopedState.resourceRoutes.size >= 1000) throw new Error('Resource route capacity exceeded');
      let source = scopedState.resourceSources.get(connectionKey);
      if (!source) {
        source = new Map([[connectionKey, connection]]);
        scopedState.resourceSources.set(connectionKey, source);
        registerCapabilityPaginationNotifications(source, connection);
      }
      // Generated resource identities use a scheme extension; retained legacy identities contain the MCP separator.
      const identity = `urn:1mcp:resource:${randomUUID()}`;
      const server = visibility?.serverCandidates.get(connectionKey) ?? connection.name ?? connectionKey;
      const entry: CatalogEntry = Object.freeze({
        route: Object.freeze({
          kind: 'resources',
          origin: 'external',
          server,
          connectionKey,
          upstreamIdentity,
          publicIdentity: identity,
        }),
        sourceObject: Object.freeze({ name: upstreamIdentity, uri: upstreamIdentity }),
        publicObject: Object.freeze({ name: upstreamIdentity, uri: identity }),
      });
      issuedResourceEntries.add(entry);
      scopedState.resourceRoutes.set(identity, {
        entry,
        connection,
        adapter: connection.adapter,
        ...(visibility?.resourceOwner ? { owner: visibility.resourceOwner } : { sessionId: visibility?.sessionId }),
        expiresAt: Date.now() + RUNTIME_CATALOG_SCOPE_TTL_MS,
        resourcesEpoch: getCapabilityPaginationGeneration(source, 'resources'),
        templatesEpoch: getCapabilityPaginationGeneration(source, 'resourceTemplates'),
      });
      return identity;
    },
    resolve(kind: CapabilityKind, identity: string) {
      assertCurrent();
      const routed = kind === 'resources' ? scopedState.resourceRoutes.get(identity) : undefined;
      const issued =
        routed && resourceRouteOwnedBy(routed, visibility) && resourceRouteIsCurrent(scopedState, routed)
          ? routed
          : undefined;
      const entry =
        generation.resolve(kind, identity, keys) ??
        (issued &&
        captured.get(issued.entry.route.connectionKey) === issued.connection &&
        capturedAdapters.get(issued.entry.route.connectionKey) === issued.adapter
          ? issued.entry
          : undefined);
      if (
        !entry ||
        (kind === 'tools' &&
          isSourceToolDisabled(options.serverConfigs ?? {}, entry.route.server, entry.route.upstreamIdentity))
      )
        return undefined;
      return { entry, connection: captured.get(entry.route.connectionKey) };
    },
    async list<T>(
      kind: CapabilityKind,
      listOptions: {
        cursor?: string;
        enablePagination: boolean;
        pageSize?: number;
        filterSelection?: unknown;
        internalOnly?: boolean;
        visibility?: CapabilityVisibility;
        serverConfigs?: Record<string, MCPServerParams>;
        responseBudget?: CapabilityResponseBudget<T>;
      },
    ) {
      if (state.scopes.get(scope) !== scopedState) {
        throw new MCPError('Invalid capability pagination cursor', ErrorCode.InvalidParams, {
          reason: 'stale_generation',
        });
      }
      scopedState.lastAccess = Date.now();
      if (listOptions.cursor === undefined) assertCurrent();
      observeConnections();
      const currentVisibility = listOptions.visibility ?? visibility;
      const selectedProviders = sourcePages.filter(
        (provider) => provider.kind === kind && (!listOptions.internalOnly || !captured.has(provider.key)),
      );
      const identity = (item: unknown): string => {
        const value = item as Record<string, unknown>;
        return String(getCapabilityIdentity(kind, value));
      };
      const sorted = selectedProviders
        .flatMap((provider) => [...provider.pages.values()].flatMap((page) => page.items))
        .sort((left, right) => compareCodePoints(identity(left), identity(right)));
      const pageSize = listOptions.pageSize;
      if (pageSize !== undefined && (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 5000)) {
        throw new MCPError('Invalid capability page size', ErrorCode.InvalidParams);
      }
      let providers: CapabilityPageProvider<T>[];
      if (pageSize !== undefined) {
        providers = selectedProviders
          .filter((provider) => provider.error)
          .map((provider) => ({
            id: provider.key,
            name: '',
            async list(): Promise<CapabilityPage<T>> {
              throw provider.error;
            },
          }));
        if (sorted.length > 0 || providers.length === 0) {
          providers.push({
            id: '\0app.1mcp/snapshot-pages',
            name: 'page',
            async list(cursor?: string): Promise<CapabilityPage<T>> {
              const offset = cursor === undefined ? 0 : Number(cursor);
              if (!Number.isSafeInteger(offset) || offset < 0 || offset > sorted.length) {
                throw new MCPError('Invalid capability page position', ErrorCode.InvalidParams);
              }
              return {
                items: sorted.slice(offset, offset + pageSize) as T[],
                nextCursor: offset + pageSize < sorted.length ? String(offset + pageSize) : undefined,
              };
            },
          });
        }
      } else if (listOptions.internalOnly) {
        providers = [
          {
            id: '\0app.1mcp/lazy-tools',
            name: '1mcp',
            async list() {
              return { items: sorted as T[] };
            },
          },
        ];
      } else {
        let offset = 0;
        providers = [...selectedProviders]
          .sort((left, right) => compareCodePoints(left.server, right.server) || compareCodePoints(left.key, right.key))
          .map((provider) => {
            const pages = new Map(
              [...provider.pages].map(([cursor, page]) => {
                const items = sorted.slice(offset, offset + page.items.length) as T[];
                offset += page.items.length;
                return [cursor, { items, nextCursor: page.nextCursor }] as const;
              }),
            );
            return {
              id: provider.key,
              name: provider.server,
              async list(cursor?: string) {
                const page = pages.get(cursor);
                if (!page) throw provider.error ?? new Error('Unknown captured upstream cursor');
                return { ...page, items: [...page.items] };
              },
            };
          });
      }
      const result = await walkCapabilityPages<T>({
        connections: observedConnections,
        kind,
        ...listOptions,
        filterSelection: {
          visibility: listOptions.visibility ? listOptions.visibility.filterSelection : filterSelection,
          keys: currentVisibility
            ? Array.from(currentVisibility.serverCandidates.keys()).sort()
            : Array.from(captured.keys()).sort(),
          selection: listOptions.filterSelection,
          pageSize,
          internalOnly: listOptions.internalOnly,
        },
        failedProviderIds: sourcePages
          .filter((provider) => provider.kind === kind && provider.error)
          .map((provider) => provider.key),
        upstreamToolAdmissionTimeouts: kind === 'tools' ? admissionTimeouts : undefined,
        extraGenerationSignature: signature(listOptions.serverConfigs ?? options.serverConfigs),
        providers,
      });
      assertCurrent();
      return result;
    },
  });
  if (state.scopes.get(scope) === scopedState && (started === scopedState.latestStarted || !scopedState.snapshot)) {
    scopedState.snapshot = snapshot;
    for (const [key, connection] of captured) {
      const provider = sourcePages.find((page) => page.kind === 'tools' && page.key === key);
      if (!provider || provider.error) clearConfiguredToolSnapshot(connection);
      else
        publishConfiguredToolSnapshot(
          connection,
          generation.entries
            .filter((entry) => entry.route.kind === 'tools' && entry.route.connectionKey === key)
            .map((entry) => entry.sourceObject as unknown as Tool),
          !admissionTimeouts.includes(key),
        );
    }
    publishCompleteConfiguredToolTargetSnapshots(connections);
  }
  return snapshot;
}

/**
 * Template listing shares the `resources` capability, and some servers that declare it
 * only implement `resources/list`. Their "method not found" means "no templates".
 */
function isUnimplementedResourceTemplates(kind: CapabilityKind, error: unknown): boolean {
  return (
    kind === 'resourceTemplates' && error instanceof OneMcpProtocolError && error.code === ErrorCode.MethodNotFound
  );
}

/**
 * Static servers look the same to every session, so their catalog scope can be shared.
 * Stateless inbound requests run each page in a fresh session; a shared scope lets the
 * next request resume a cursor. Session-scoped template instances keep their own scope.
 */
function isSessionIndependent(visibility: CapabilityVisibility | undefined): boolean {
  if (!visibility) return true;
  for (const key of visibility.serverCandidates.keys()) {
    if (parseTemplateConnectionKey(key).kind !== 'static') return false;
  }
  return true;
}

function getCapabilityIdentity(kind: CapabilityKind, value: Record<string, unknown>): unknown {
  if (kind === 'resources') return value.uri;
  if (kind === 'resourceTemplates') return value.uriTemplate;
  return value.name;
}

function readonlyConnections(map: Map<string, OutboundConnection>): ReadonlyMap<string, OutboundConnection> {
  return Object.freeze({
    get size() {
      return map.size;
    },
    get: (key: string) => map.get(key),
    has: (key: string) => map.has(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    values: () => map.values(),
    [Symbol.iterator]: () => map[Symbol.iterator](),
    forEach: (
      callback: (value: OutboundConnection, key: string, map: ReadonlyMap<string, OutboundConnection>) => void,
      thisArg?: unknown,
    ) => {
      map.forEach((value, key) => callback.call(thisArg, value, key, readonlyConnections(map)));
    },
  });
}
