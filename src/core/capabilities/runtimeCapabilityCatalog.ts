import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { isSourceToolDisabled } from '@src/core/server/disabledTools.js';
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
import { ErrorCode, type Tool } from '@src/sdk/contracts/index.js';
import { MCPError } from '@src/utils/core/errorTypes.js';

import {
  type CapabilityPage,
  type CapabilityPaginationResult,
  compareCodePoints,
  registerCapabilityPaginationNotifications,
  unregisterCapabilityPaginationConnections,
  walkCapabilityPages,
} from './capabilityPagination.js';
import type { CapabilityVisibility } from './capabilityVisibility.js';
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
  errorCursor?: string;
}

export interface PreparedToolCall {
  (result: unknown): Promise<void>;
  assertCurrent(): void;
}

export interface RuntimeCapabilitySnapshot {
  readonly generation: CatalogGeneration;
  prepareToolCall(identity: string, args: unknown, signal?: AbortSignal): Promise<PreparedToolCall>;
  readonly connections: ReadonlyMap<string, OutboundConnection>;
  isCurrent(): boolean;
  /** Issue a session-scoped, backend-bound route for a resource absent from discovery. */
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
    },
  ): Promise<CapabilityPaginationResult<T>>;
}

interface RuntimeScope {
  sessionId?: string;
  latestStarted: number;
  lastAccess: number;
  snapshot?: RuntimeCapabilitySnapshot;
  observedTools?: { started: number; fingerprints: ReadonlyMap<string, string | null> };
  paginationConnections: OutboundConnections;
  resourceRoutes: Map<
    string,
    { entry: CatalogEntry; connection: OutboundConnection; adapter: OutboundConnection['adapter'] }
  >;
}

interface RuntimeState {
  nextId: number;
  scopes: Map<string, RuntimeScope>;
}
const states = new WeakMap<OutboundConnections, RuntimeState>();

/** Release all visibility variants and in-flight publications owned by a disconnected session. */
export function evictRuntimeCapabilityCatalogSession(connections: OutboundConnections, sessionId: string): void {
  const state = states.get(connections);
  if (!state) return;
  for (const [key, scope] of state.scopes) {
    if (scope.sessionId !== sessionId) continue;
    state.scopes.delete(key);
    unregisterCapabilityPaginationConnections(scope.paginationConnections);
    scope.paginationConnections.clear();
    scope.resourceRoutes.clear();
  }
}

/** Acquire all route and projection facts before dispatching any capability operation. */
export async function acquireRuntimeCapabilityCatalog(
  connections: OutboundConnections,
  visibility?: CapabilityVisibility,
  options: RuntimeCatalogOptions = {},
): Promise<RuntimeCapabilitySnapshot> {
  options = { ...options, serverConfigs: structuredClone(options.serverConfigs ?? {}) };
  let state = states.get(connections);
  if (!state) {
    state = { nextId: 1, scopes: new Map() };
    states.set(connections, state);
  }
  for (const [key, retained] of state.scopes) {
    if (Date.now() - retained.lastAccess < 15 * 60 * 1000) continue;
    state.scopes.delete(key);
    unregisterCapabilityPaginationConnections(retained.paginationConnections);
    retained.paginationConnections.clear();
    retained.resourceRoutes.clear();
  }
  const captured = new Map(
    Array.from(connections).filter(
      ([key, connection]) =>
        connection.status === ClientStatus.Connected && (!visibility || visibility.serverCandidates.has(key)),
    ),
  );
  const capturedAdapters = new Map(Array.from(captured, ([key, connection]) => [key, connection.adapter]));
  const { continuation, signal, ...catalogOptions } = options;
  const scope = createHash('sha256')
    .update(
      JSON.stringify(
        [
          Array.from(captured.keys()).sort(),
          visibility?.sessionId,
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
    if (state.scopes.size >= 256) throw new Error('Capability catalog scope capacity exceeded');
    currentScope = {
      sessionId: visibility?.sessionId,
      latestStarted: started,
      lastAccess: Date.now(),
      paginationConnections: new Map(captured),
      resourceRoutes: new Map(),
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
              const nextCursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined;
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
            provider.error = error;
            provider.errorCursor = cursor;
          }
          for (const page of provider.pages.values()) {
            for (const object of page.items) sources.push({ kind, server, connectionKey: key, object });
          }
        }),
      );
    }),
  );

  for (const kind of Object.keys(METHODS) as CapabilityKind[]) {
    const items =
      kind === 'tools'
        ? options.internalTools
        : kind === 'resources'
          ? options.internalResources
          : kind === 'prompts'
            ? options.internalPrompts
            : options.internalResourceTemplates;
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
  }
  const schemaContracts = new Map<string, ToolSchemaContracts>();
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
      index++;
    } catch (error) {
      if (!(error instanceof SchemaBoundaryError) || error.retryable) throw error;
      sources.splice(index, 1);
    }
  }
  assertCurrent();
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
      const identity = kind === 'resources' ? raw.uri : kind === 'resourceTemplates' ? raw.uriTemplate : raw.name;
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
  const snapshot: RuntimeCapabilitySnapshot = Object.freeze({
    generation,
    async prepareToolCall(identity: string, args: unknown, signal?: AbortSignal) {
      const resolved = snapshot.resolve('tools', identity);
      if (!resolved) throw new SchemaBoundaryError('schema_invalid');
      const routeKey = JSON.stringify([resolved.entry.route.connectionKey, resolved.entry.route.upstreamIdentity]);
      const contract = schemaContracts.get(routeKey);
      if (!contract) throw new SchemaBoundaryError('schema_invalid');
      const assertContractCurrent = () => {
        assertCurrent();
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
      const validateOutput = await prepareToolValidation(contract, args, {
        routeKey,
        generation: String(started),
        signal,
      });
      assertContractCurrent();
      return Object.freeze(Object.assign(validateOutput, { assertCurrent: assertContractCurrent }));
    },
    connections: readonlyConnections(captured),
    isCurrent,
    projectUnlistedResource(connectionKey: string, upstreamIdentity: string) {
      assertCurrent();
      const connection = captured.get(connectionKey);
      if (!connection) throw new Error('Unknown resource backend');
      for (const [identity, route] of scopedState.resourceRoutes) {
        if (
          route.entry.route.connectionKey === connectionKey &&
          route.entry.route.upstreamIdentity === upstreamIdentity
        )
          return identity;
      }
      if (scopedState.resourceRoutes.size >= 1000) throw new Error('Resource route capacity exceeded');
      // This namespace cannot collide with canonical identities, which always contain the MCP separator.
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
      scopedState.resourceRoutes.set(identity, { entry, connection, adapter: connection.adapter });
      return identity;
    },
    resolve(kind: CapabilityKind, identity: string) {
      assertCurrent();
      const issued = kind === 'resources' ? scopedState.resourceRoutes.get(identity) : undefined;
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
      const selectedProviders = sourcePages
        .filter((provider) => provider.kind === kind && (!listOptions.internalOnly || !captured.has(provider.key)))
        .map((provider) => ({
          ...provider,
          pages: new Map([...provider.pages].map(([cursor, page]) => [cursor, { ...page }])),
        }));
      const pages = [...selectedProviders]
        .sort((left, right) => compareCodePoints(left.server, right.server) || compareCodePoints(left.key, right.key))
        .flatMap((provider) => [...provider.pages.values()]);
      const identity = (item: unknown): string => {
        const value = item as Record<string, unknown>;
        return String(kind === 'resources' ? value.uri : kind === 'resourceTemplates' ? value.uriTemplate : value.name);
      };
      const sorted = pages
        .flatMap((page) => page.items)
        .sort((left, right) => compareCodePoints(identity(left), identity(right)));
      let offset = 0;
      for (const page of pages) {
        const length = page.items.length;
        page.items = sorted.slice(offset, offset + length);
        offset += length;
      }
      const providers = selectedProviders.map((provider) => ({
        id: provider.key,
        name: provider.server,
        async list(cursor?: string) {
          const page = provider.pages.get(cursor);
          if (provider.error && (!page || cursor === provider.errorCursor)) throw provider.error;
          if (!page) throw new Error('Unknown captured upstream cursor');
          return { items: [...page.items] as T[], nextCursor: page.nextCursor };
        },
      }));
      const pageSize = listOptions.pageSize;
      if (pageSize !== undefined && (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 5000)) {
        throw new MCPError('Invalid capability page size', ErrorCode.InvalidParams);
      }
      const pagedProviders =
        pageSize === undefined
          ? undefined
          : [
              ...selectedProviders
                .filter((provider) => provider.error)
                .map((provider) => ({
                  id: provider.key,
                  name: '',
                  async list(): Promise<CapabilityPage<T>> {
                    throw provider.error;
                  },
                })),
              ...(sorted.length === 0 && selectedProviders.some((provider) => provider.error)
                ? []
                : [
                    {
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
                    },
                  ]),
            ];
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
        extraGenerationSignature: signature(listOptions.serverConfigs ?? options.serverConfigs),
        providers:
          pagedProviders ??
          (listOptions.internalOnly
            ? [
                {
                  id: '\0app.1mcp/lazy-tools',
                  name: '1mcp',
                  async list() {
                    const pages = await Promise.all(providers.map((provider) => provider.list()));
                    return {
                      items: pages
                        .flatMap((page) => page.items)
                        .sort((left, right) => {
                          const a = (left as { name: string }).name;
                          const b = (right as { name: string }).name;
                          return a < b ? -1 : a > b ? 1 : 0;
                        }),
                    };
                  },
                },
              ]
            : providers),
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
        );
    }
    publishCompleteConfiguredToolTargetSnapshots(connections);
  }
  return snapshot;
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
