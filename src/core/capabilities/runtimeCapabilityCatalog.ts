import { createHash } from 'node:crypto';

import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { isSourceToolDisabled } from '@src/core/server/disabledTools.js';
import { applySourceToolDescription } from '@src/core/server/toolDescriptionOverrides.js';
import {
  ClientStatus,
  type MCPServerParams,
  type OutboundConnection,
  type OutboundConnections,
} from '@src/core/types/index.js';
import { ErrorCode, type Tool } from '@src/sdk/contracts/index.js';
import { MCPError } from '@src/utils/core/errorTypes.js';

import {
  type CapabilityPage,
  type CapabilityPaginationResult,
  registerCapabilityPaginationNotifications,
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

const METHODS: Record<CapabilityKind, string> = {
  tools: 'tools/list',
  prompts: 'prompts/list',
  resources: 'resources/list',
  resourceTemplates: 'resources/templates/list',
};

export interface RuntimeCatalogOptions {
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

export interface RuntimeCapabilitySnapshot {
  readonly generation: CatalogGeneration;
  readonly connections: ReadonlyMap<string, OutboundConnection>;
  isCurrent(): boolean;
  resolve(
    kind: CapabilityKind,
    publicIdentity: string,
  ): { entry: CatalogEntry; connection?: OutboundConnection } | undefined;
  list<T>(
    kind: CapabilityKind,
    options: {
      cursor?: string;
      enablePagination: boolean;
      filterSelection?: unknown;
      internalOnly?: boolean;
      visibility?: CapabilityVisibility;
      serverConfigs?: Record<string, MCPServerParams>;
    },
  ): Promise<CapabilityPaginationResult<T>>;
}

interface RuntimeState {
  nextId: number;
  latestStarted: Map<string, number>;
  snapshots: Map<string, RuntimeCapabilitySnapshot>;
  paginationConnections: Map<string, OutboundConnections>;
}
const states = new WeakMap<OutboundConnections, RuntimeState>();

/** Acquire all route and projection facts before dispatching any capability operation. */
export async function acquireRuntimeCapabilityCatalog(
  connections: OutboundConnections,
  visibility?: CapabilityVisibility,
  options: RuntimeCatalogOptions = {},
): Promise<RuntimeCapabilitySnapshot> {
  options = { ...options, serverConfigs: structuredClone(options.serverConfigs ?? {}) };
  let state = states.get(connections);
  if (!state) {
    state = { nextId: 1, latestStarted: new Map(), snapshots: new Map(), paginationConnections: new Map() };
    states.set(connections, state);
  }
  const captured = new Map(
    Array.from(connections).filter(
      ([key, connection]) =>
        connection.status === ClientStatus.Connected && (!visibility || visibility.serverCandidates.has(key)),
    ),
  );
  const capturedAdapters = new Map(Array.from(captured, ([key, connection]) => [key, connection.adapter]));
  const { continuation, ...catalogOptions } = options;
  const scope = JSON.stringify([Array.from(captured.keys()).sort(), visibility?.sessionId, catalogOptions]);
  if (continuation) {
    const scopedPrevious = state.snapshots.get(scope);
    const previous = scopedPrevious ?? Array.from(state.snapshots.values()).at(-1);
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
  const started = (state.latestStarted.get(scope) ?? 0) + 1;
  let paginationConnections = state.paginationConnections.get(scope);
  if (!paginationConnections) {
    paginationConnections = new Map(captured);
    state.paginationConnections.set(scope, paginationConnections);
  }
  const observedConnections = paginationConnections;
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
  state.latestStarted.set(scope, started);
  const isCurrent = () =>
    Array.from(captured).every(
      ([key, connection]) =>
        connections.get(key) === connection &&
        connection.adapter === capturedAdapters.get(key) &&
        connection.status === ClientStatus.Connected,
    );
  const assertCurrent = () => {
    if (!isCurrent()) {
      throw new Error('Capability catalog backend changed; retry the request');
    }
  };
  const sources: CapabilitySource[] = [];
  const sourcePages: SourcePages[] = [];
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
                { timeoutMs: connection.requestTimeoutMs },
              );
              if (!Array.isArray(result[kind])) throw new Error(`Invalid ${kind} list result`);
              const items = result[kind] as unknown[];
              const nextCursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined;
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
      throw new Error('Capability catalog backend changed; retry the request');
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
  const previous = state.snapshots.get(scope);
  const sameBackends =
    previous &&
    previous.isCurrent() &&
    previous.connections.size === captured.size &&
    Array.from(captured).every(([key, connection]) => previous.connections.get(key) === connection);
  const externalPages = sourcePages.filter((provider) => captured.has(provider.key));
  if (
    externalPages.length > 0 &&
    externalPages.every((provider) => provider.error && provider.pages.size === 0) &&
    sameBackends
  ) {
    for (const connection of captured.values()) clearConfiguredToolSnapshot(connection);
    return previous;
  }
  const generation = buildCatalogGeneration(state.nextId++, sources);
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
            ...entry.publicObject,
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
  const signature = (serverConfigs: Record<string, MCPServerParams> | undefined) =>
    createHash('sha256')
      .update(JSON.stringify([generation.entries, serverConfigs]))
      .digest('hex');
  const snapshot: RuntimeCapabilitySnapshot = Object.freeze({
    generation,
    connections: readonlyConnections(captured),
    isCurrent,
    resolve(kind: CapabilityKind, identity: string) {
      assertCurrent();
      const entry = generation.resolve(kind, identity, keys);
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
        filterSelection?: unknown;
        internalOnly?: boolean;
        visibility?: CapabilityVisibility;
        serverConfigs?: Record<string, MCPServerParams>;
      },
    ) {
      if (!listOptions.cursor) assertCurrent();
      observeConnections();
      const currentVisibility = listOptions.visibility ?? visibility;
      const providers = sourcePages
        .filter((provider) => provider.kind === kind && (!listOptions.internalOnly || !captured.has(provider.key)))
        .map((provider) => ({
          id: provider.key,
          name: provider.server,
          async list(cursor?: string) {
            const page = provider.pages.get(cursor);
            if (provider.error && (!page || cursor === provider.errorCursor)) throw provider.error;
            if (!page) throw new Error('Unknown captured upstream cursor');
            return { items: [...page.items] as T[], nextCursor: page.nextCursor };
          },
        }));
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
          internalOnly: listOptions.internalOnly,
        },
        extraGenerationSignature: signature(listOptions.serverConfigs ?? options.serverConfigs),
        providers: listOptions.internalOnly
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
          : providers,
      });
      assertCurrent();
      return result;
    },
  });
  if (started === state.latestStarted.get(scope)) {
    state.snapshots.set(scope, snapshot);
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
