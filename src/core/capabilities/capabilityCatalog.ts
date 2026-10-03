import { createHash, randomUUID } from 'node:crypto';

import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { ConnectionResolver, type TemplateHashProvider } from '@src/core/server/connectionResolver.js';
import { getDisabledSourceToolError, isSourceToolDisabled } from '@src/core/server/disabledTools.js';
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
  schemaInputErrorResult,
} from '@src/core/validation/toolSchemaBoundary.js';
import { gatewayFailureFromUnknown } from '@src/gateway/contracts/gatewayFailure.js';
import logger from '@src/logger/logger.js';
import { ErrorCode, type Tool } from '@src/sdk/contracts/index.js';
import { MCPError } from '@src/utils/core/errorTypes.js';

import {
  CAPABILITY_PAGINATION_META_KEY,
  type CapabilityKind,
  type CapabilityPage,
  type CapabilityPaginationResult,
  getCapabilityFailureFacts,
  getCapabilityPaginationGeneration,
  setCapabilityFailureFacts,
  walkCapabilityPages,
} from './capabilityPagination.js';
import { type CapabilityVisibility, getCapabilityVisibleServerNames } from './capabilityVisibility.js';
import type { CapabilityRoute as CatalogRoute } from './catalogGeneration.js';
import { SchemaCache } from './schemaCache.js';
import type { ListToolsOptions, ListToolsResult as RegistryListToolsResult, ToolMetadata } from './toolRegistry.js';
import { ToolRegistry } from './toolRegistry.js';

export interface CapabilityAccessError {
  type: 'validation' | 'not_found' | 'upstream' | 'internal';
  message: string;
}

export type CapabilityRefreshIntent = 'never' | 'ifStale' | 'force';
export type CapabilityRefreshReason = 'list' | 'describe' | 'invoke';

export interface CapabilityRefreshFacts {
  intent: CapabilityRefreshIntent;
  refreshed: boolean;
  changed: boolean;
  shouldNotifyListChanged: boolean;
}

export interface CapabilityRefreshInput {
  intent: Exclude<CapabilityRefreshIntent, 'never'>;
  reason: CapabilityRefreshReason;
}

export interface CapabilityRefreshResult {
  changed?: boolean;
  shouldNotifyListChanged?: boolean;
}

export interface CapabilityCatalogQueryOptions {
  refreshIntent?: CapabilityRefreshIntent;
  signal?: AbortSignal;
  /** Request-scoped registry, e.g. built from the snapshot the request already captured. */
  toolRegistry?: ToolRegistry;
}

export interface CapabilityRoute extends CatalogRoute {
  toolName: string;
}

export interface VisibleTool extends ToolMetadata {}

export interface VisibleToolListResult extends RegistryListToolsResult {
  tools: VisibleTool[];
  servers: string[];
  routes: CapabilityRoute[];
  refresh: CapabilityRefreshFacts;
}

export interface CapabilityCatalogDependencies {
  getToolRegistry: () => ToolRegistry | Promise<ToolRegistry>;
  schemaCache: SchemaCache;
  outboundConnections: OutboundConnections;
  getServerConfigs: () => Record<string, MCPServerParams>;
  loadSchema?: (server: string, toolName: string, signal?: AbortSignal) => Promise<Tool>;
  refreshCapabilities?: (input: CapabilityRefreshInput) => Promise<CapabilityRefreshResult | void>;
  defaultVisibility?: CapabilityVisibility;
  templateHashProvider?: TemplateHashProvider;
}

export interface DescribeVisibleToolResult {
  schema: Tool | Record<string, never>;
  fromCache?: boolean;
  route?: CapabilityRoute;
  error?: CapabilityAccessError;
  refresh: CapabilityRefreshFacts;
}

export interface InvokeVisibleToolResult {
  result: unknown;
  server: string;
  tool: string;
  route?: CapabilityRoute;
  error?: CapabilityAccessError;
  refresh: CapabilityRefreshFacts;
}

const NEVER_REFRESH: CapabilityRefreshFacts = {
  intent: 'never',
  refreshed: false,
  changed: false,
  shouldNotifyListChanged: false,
};

interface ToolListingSnapshot {
  registry: ToolRegistry;
  generation: string;
  visibility: string;
  refresh: CapabilityRefreshFacts;
  expiresAt: number;
  bytes: number;
}

const TOOL_LISTING_TTL_MS = 15 * 60 * 1000;
const MAX_TOOL_LISTING_SNAPSHOTS = 1000;
const MAX_TOOL_LISTING_BYTES = 32 * 1024 * 1024;
const MAX_VISIBILITY_TOOL_LISTINGS = 250;
const MAX_VISIBILITY_TOOL_LISTING_BYTES = 8 * 1024 * 1024;
const MAX_ACTIVE_TOOL_ADMISSIONS = 1000;
const MAX_TOOL_ADMISSION_OUTCOMES = 32768;
type ToolAdmissionOutcome =
  | { attempt: number; withheld: false }
  | {
      attempt: number;
      withheld: true;
      registry: ToolRegistry;
      connection?: OutboundConnection;
      adapter?: OutboundConnection['adapter'];
    };
interface ToolListingState {
  listings: Map<string, ToolListingSnapshot>;
  withheldTools: Map<string, ToolAdmissionOutcome>;
  activeAttempts: Set<number>;
  nextAttempt: number;
}
const toolListingStates = new WeakMap<OutboundConnections, ToolListingState>();

export class CapabilityCatalog {
  private readonly connectionResolver: ConnectionResolver;
  private readonly toolListings: Map<string, ToolListingSnapshot>;
  private readonly withheldTools: ToolListingState['withheldTools'];
  private readonly listingState: ToolListingState;

  constructor(private readonly deps: CapabilityCatalogDependencies) {
    this.connectionResolver = new ConnectionResolver(deps.outboundConnections, deps.templateHashProvider);
    let state = toolListingStates.get(deps.outboundConnections);
    if (!state) {
      state = { listings: new Map(), withheldTools: new Map(), activeAttempts: new Set(), nextAttempt: 0 };
      toolListingStates.set(deps.outboundConnections, state);
    }
    this.toolListings = state.listings;
    this.withheldTools = state.withheldTools;
    this.listingState = state;
  }

  /**
   * List one aggregate page while keeping provider traversal, cursor binding, and
   * visibility enforcement inside the Capability Catalog.
   */
  public async listVisibleCapabilityPages<T>(options: {
    kind: CapabilityKind;
    visibility: CapabilityVisibility;
    cursor?: string;
    enablePagination: boolean;
    list: (
      connection: OutboundConnection,
      cursor: string | undefined,
      serverName: string,
    ) => Promise<CapabilityPage<T>>;
    mapItem?: (item: T, serverName: string) => T;
    internalPages?: Array<{ id: string; name: string; items: T[] }>;
    includeExternal?: boolean;
    filterSelection?: unknown;
    generationSignature?: unknown;
    serverConfigs?: Record<string, MCPServerParams>;
  }): Promise<CapabilityPaginationResult<T>> {
    const externalProviders =
      options.includeExternal === false
        ? []
        : Array.from(options.visibility.serverCandidates.entries()).flatMap(([connectionKey, serverName]) => {
            const connection = this.deps.outboundConnections.get(connectionKey);
            if (!connection || connection.status !== ClientStatus.Connected) return [];
            return [
              {
                id: connectionKey,
                name: serverName,
                list: async (cursor?: string) => {
                  const page = await options.list(connection, cursor, serverName);
                  const mapPage = (items: T[]): CapabilityPage<T> => ({
                    ...page,
                    items: options.mapItem ? items.map((item) => options.mapItem!(item, serverName)) : items,
                  });
                  if (options.kind !== 'tools') return mapPage(page.items);
                  const serverConfigs = options.serverConfigs ?? this.deps.getServerConfigs();
                  const visibleItems = page.items.filter((item) => {
                    const name =
                      item && typeof item === 'object' && 'name' in item && typeof item.name === 'string'
                        ? item.name
                        : undefined;
                    return name === undefined || !isSourceToolDisabled(serverConfigs, serverName, name);
                  });
                  return mapPage(visibleItems);
                },
              },
            ];
          });
    const internalProviders = (options.internalPages ?? []).map((page) => ({
      id: page.id,
      name: page.name,
      list: async () => ({ items: page.items }),
    }));

    return walkCapabilityPages({
      connections: this.deps.outboundConnections,
      providers: [...externalProviders, ...internalProviders],
      kind: options.kind,
      cursor: options.cursor,
      filterSelection: {
        visibility: {
          sessionId: options.visibility.sessionId,
          serverCandidates: Array.from(options.visibility.serverCandidates.entries()).sort(([left], [right]) => {
            if (left === right) return 0;
            return left < right ? -1 : 1;
          }),
          filterSelection: options.visibility.filterSelection,
        },
        selection: options.filterSelection,
      },
      extraGenerationSignature: options.generationSignature,
      enablePagination: options.enablePagination,
    });
  }

  public async listVisibleTools(
    options: ListToolsOptions = {},
    visibility?: CapabilityVisibility,
    queryOptions: CapabilityCatalogQueryOptions = {},
  ): Promise<VisibleToolListResult> {
    const continuation = this.decodeToolListingCursor(options.cursor);
    const visibilityKey = this.toolListingVisibility(visibility);
    if (continuation) {
      const snapshot = this.toolListings.get(continuation.walk);
      if (
        !snapshot ||
        snapshot.expiresAt <= Date.now() ||
        snapshot.visibility !== visibilityKey ||
        snapshot.generation !== getCapabilityPaginationGeneration(this.deps.outboundConnections, 'tools') ||
        !snapshot.registry.isCurrent()
      ) {
        throw new MCPError('Invalid capability pagination cursor', ErrorCode.InvalidParams);
      }
      return this.toolListingPage(continuation.walk, snapshot, { ...options, cursor: continuation.cursor }, visibility);
    }

    await this.pruneToolAdmissionOutcomes(queryOptions.toolRegistry);
    if (this.listingState.activeAttempts.size >= MAX_ACTIVE_TOOL_ADMISSIONS) {
      throw new MCPError('Capability admission capacity exceeded', -32000);
    }
    const attempt = ++this.listingState.nextAttempt;
    this.listingState.activeAttempts.add(attempt);
    try {
      const refresh = await this.resolveRefreshFacts(queryOptions.refreshIntent ?? 'never', 'list');
      const sourceRegistry = queryOptions.toolRegistry ?? (await this.deps.getToolRegistry());
      const registry = await this.visibleToolRegistry(visibility, sourceRegistry);
      const admitted = [];
      const timedOutSources: string[] = [];
      const serverNames = Array.from(new Set(registry.getAllTools().map((tool) => tool.server))).sort();
      const configSignature = this.toolListingConfigSignature(serverNames);
      const currentConnections = new Map(
        registry.getAllTools().flatMap((tool) => {
          const key = tool.connectionKey ?? tool.server;
          const connection = this.deps.outboundConnections.get(key);
          return connection ? [[key, connection] as const] : [];
        }),
      );
      const currentAdapters = new Map(Array.from(currentConnections, ([key, connection]) => [key, connection.adapter]));
      const isListingCurrent = () =>
        registry.isCurrent() &&
        this.toolListingConfigSignature(serverNames) === configSignature &&
        Array.from(currentConnections).every(
          ([key, connection]) =>
            this.deps.outboundConnections.get(key) === connection &&
            connection.adapter === currentAdapters.get(key) &&
            connection.status === ClientStatus.Connected,
        );
      for (const tool of registry.getAllTools()) {
        const key = tool.connectionKey ?? tool.server;
        try {
          const definition =
            tool.definition ??
            this.deps.schemaCache.getIfCached(key, tool.name) ??
            (this.deps.loadSchema ? await this.deps.loadSchema(key, tool.name, queryOptions.signal) : undefined);
          if (!definition) continue;
          const contracts = await admitToolSchemas(definition as unknown as Record<string, unknown>, {
            routeKey: JSON.stringify([key, tool.name]),
            generation: this.deps.outboundConnections.get(key)?.adapter.connectionId ?? 'internal',
            sourceRevision: this.deps.outboundConnections.get(key)?.adapter.protocolRevision,
            signal: queryOptions.signal,
          });
          this.recordToolAdmission(
            JSON.stringify([key, tool.name]),
            attempt,
            false,
            sourceRegistry,
            currentConnections.get(key),
            currentAdapters.get(key),
          );
          admitted.push({
            tool: projectToolSchemas(definition as unknown as Record<string, unknown>, contracts) as unknown as Tool,
            server: tool.server,
            connectionKey: key,
            tags: tool.tags,
          });
        } catch (error) {
          if (!(error instanceof SchemaBoundaryError)) throw error;
          if (tool.route?.origin === 'internal') throw error;
          if (!this.deps.outboundConnections.has(key)) throw error;
          if (error.phase !== 'admission') throw error;
          if (error.code === 'schema_evaluation_unavailable') throw error;
          if (error.code === 'schema_evaluation_timeout') {
            timedOutSources.push(key);
            this.recordToolAdmission(
              JSON.stringify([key, tool.name]),
              attempt,
              true,
              sourceRegistry,
              currentConnections.get(key),
              currentAdapters.get(key),
            );
            continue;
          }
          if (error.retryable) throw error;
        }
      }
      if (!isListingCurrent()) {
        throw new MCPError('Capability catalog changed during listing', ErrorCode.InvalidParams);
      }
      const generation = getCapabilityPaginationGeneration(this.deps.outboundConnections, 'tools');
      const meta = this.toolAdmissionMeta(registry.getListingMeta(), timedOutSources, generation);
      const snapshot: ToolListingSnapshot = {
        registry: ToolRegistry.fromToolsWithServer(admitted, meta).withConnections(
          registry.getConnections(),
          () =>
            registry.isCurrent() &&
            this.toolListingConfigSignature(serverNames) === configSignature &&
            Array.from(currentConnections).every(
              ([key, connection]) =>
                this.deps.outboundConnections.get(key) === connection &&
                connection.adapter === currentAdapters.get(key) &&
                connection.status === ClientStatus.Connected,
            ),
        ),
        generation,
        visibility: visibilityKey,
        refresh,
        expiresAt: Date.now() + TOOL_LISTING_TTL_MS,
        bytes: 0,
      };
      const walk = randomUUID();
      for (const [id, saved] of this.toolListings) {
        if (saved.expiresAt <= Date.now()) this.toolListings.delete(id);
      }
      const result = this.toolListingPage(walk, snapshot, { ...options, cursor: undefined }, visibility);
      if (result.nextCursor) {
        snapshot.bytes = Buffer.byteLength(JSON.stringify(snapshot.registry.getAllTools()));
        const visibilityListings = Array.from(this.toolListings.values()).filter(
          (saved) => saved.visibility === visibilityKey,
        );
        const visibilityBytes = visibilityListings.reduce((total, saved) => total + saved.bytes, 0);
        if (visibilityListings.length >= MAX_VISIBILITY_TOOL_LISTINGS) {
          throw new MCPError('Capability cursor capacity exceeded', -32000);
        }
        if (visibilityBytes + snapshot.bytes > MAX_VISIBILITY_TOOL_LISTING_BYTES) {
          throw new MCPError('Capability cursor capacity exceeded', -32000);
        }
        const capturedBytes = Array.from(this.toolListings.values()).reduce((total, saved) => total + saved.bytes, 0);
        if (capturedBytes + snapshot.bytes > MAX_TOOL_LISTING_BYTES) {
          throw new MCPError('Capability cursor capacity exceeded', -32000);
        }
        if (this.toolListings.size >= MAX_TOOL_LISTING_SNAPSHOTS) {
          throw new MCPError('Capability cursor capacity exceeded', -32000);
        }
        this.toolListings.set(walk, snapshot);
      }
      return result;
    } finally {
      this.listingState.activeAttempts.delete(attempt);
      await this.pruneToolAdmissionOutcomes(queryOptions.toolRegistry);
    }
  }

  private async pruneToolAdmissionOutcomes(requestRegistry?: ToolRegistry): Promise<void> {
    const currentRegistry = requestRegistry ?? (await this.deps.getToolRegistry());
    const oldestAttempt = Math.min(...this.listingState.activeAttempts);
    for (const [key, outcome] of this.withheldTools) {
      if (!outcome.withheld) {
        if (outcome.attempt <= oldestAttempt) this.withheldTools.delete(key);
        continue;
      }
      const [connectionKey] = JSON.parse(key) as [string, string];
      const connection = this.deps.outboundConnections.get(connectionKey);
      const obsolete =
        outcome.registry !== currentRegistry ||
        outcome.connection !== connection ||
        outcome.adapter !== connection?.adapter;
      if (!obsolete) continue;
      if (outcome.attempt > oldestAttempt) {
        this.withheldTools.set(key, { attempt: outcome.attempt, withheld: false });
      } else {
        this.withheldTools.delete(key);
      }
    }
  }

  private recordToolAdmission(
    key: string,
    attempt: number,
    withheld: boolean,
    registry: ToolRegistry,
    connection?: OutboundConnection,
    adapter?: OutboundConnection['adapter'],
  ): void {
    const previous = this.withheldTools.get(key);
    if (previous && previous.attempt > attempt) return;
    const [connectionKey] = JSON.parse(key) as [string, string];
    const currentConnection = this.deps.outboundConnections.get(connectionKey);
    if (connection !== currentConnection || adapter !== currentConnection?.adapter) return;
    if (!withheld && !Array.from(this.listingState.activeAttempts).some((active) => active < attempt)) {
      this.withheldTools.delete(key);
      return;
    }
    if (!this.withheldTools.has(key) && this.withheldTools.size >= MAX_TOOL_ADMISSION_OUTCOMES) {
      throw new MCPError('Capability admission capacity exceeded', -32000);
    }
    if (!withheld) {
      this.withheldTools.set(key, { attempt, withheld: false });
      return;
    }
    this.withheldTools.set(key, { attempt, withheld: true, registry, connection, adapter });
  }

  private toolListingConfigSignature(serverNames: readonly string[]): string {
    const configs = this.deps.getServerConfigs();
    return createHash('sha256')
      .update(JSON.stringify(serverNames.map((name) => [name, configs[name]])))
      .digest('hex');
  }

  private toolListingPage(
    walk: string,
    snapshot: ToolListingSnapshot,
    options: ListToolsOptions,
    visibility?: CapabilityVisibility,
  ): VisibleToolListResult {
    const result = snapshot.registry.listTools(options);
    const tools = result.tools;
    return {
      ...result,
      ...(result.nextCursor
        ? { nextCursor: Buffer.from(JSON.stringify({ walk, cursor: result.nextCursor })).toString('base64url') }
        : {}),
      tools,
      servers: Array.from(new Set(tools.map((tool) => tool.server))).sort(),
      routes: tools
        .map((tool) => this.resolveRoute(tool, visibility))
        .filter((route): route is CapabilityRoute => route !== undefined),
      refresh: snapshot.refresh,
    };
  }

  private decodeToolListingCursor(cursor?: string): { walk: string; cursor: string } | undefined {
    if (!cursor) return undefined;
    if (cursor.length > 4096) throw new MCPError('Invalid capability pagination cursor', ErrorCode.InvalidParams);
    try {
      const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (!decoded || typeof decoded !== 'object' || !('walk' in decoded)) {
        throw new MCPError('Invalid capability pagination cursor', ErrorCode.InvalidParams);
      }
      if (typeof decoded.walk !== 'string' || !('cursor' in decoded) || typeof decoded.cursor !== 'string') {
        throw new MCPError('Invalid capability pagination cursor', ErrorCode.InvalidParams);
      }
      return { walk: decoded.walk, cursor: decoded.cursor };
    } catch (error) {
      if (error instanceof MCPError) throw error;
      throw new MCPError('Invalid capability pagination cursor', ErrorCode.InvalidParams);
    }
  }

  private toolListingVisibility(visibility?: CapabilityVisibility): string {
    const effective = visibility ?? this.deps.defaultVisibility;
    return JSON.stringify({
      sessionId: effective?.sessionId,
      candidates: effective ? Array.from(effective.serverCandidates).sort(([a], [b]) => a.localeCompare(b)) : null,
      filters: effective?.filterSelection,
    });
  }

  public async requiresToolListingRecovery(visibility?: CapabilityVisibility): Promise<boolean> {
    return (await this.visibleToolRegistry(visibility)).getListingMeta() !== undefined;
  }

  private toolAdmissionMeta(
    inherited: Record<string, unknown> | undefined,
    timedOutSources: readonly string[],
    generation: string,
  ): Record<string, unknown> | undefined {
    if (timedOutSources.length === 0) return inherited;
    const facts = new Map(getCapabilityFailureFacts(inherited));
    for (const source of timedOutSources) {
      const previous = facts.get(source);
      facts.set(source, {
        ...previous,
        upstream_tool_admission_timeout: (previous?.upstream_tool_admission_timeout ?? 0) + 1,
      });
    }
    const failureCategories = { upstream_list_failed: 0, upstream_tool_admission_timeout: 0 };
    for (const fact of facts.values()) {
      failureCategories.upstream_list_failed += fact.upstream_list_failed ?? 0;
      failureCategories.upstream_tool_admission_timeout += fact.upstream_tool_admission_timeout ?? 0;
    }
    const previous = inherited?.[CAPABILITY_PAGINATION_META_KEY] as Record<string, unknown> | undefined;
    return setCapabilityFailureFacts(
      {
        ...inherited,
        [CAPABILITY_PAGINATION_META_KEY]: {
          ...previous,
          partial: true,
          complete: false,
          generation,
          failedSourceCount: facts.size,
          failureCategories: {
            ...(failureCategories.upstream_list_failed
              ? { upstream_list_failed: failureCategories.upstream_list_failed }
              : {}),
            upstream_tool_admission_timeout: failureCategories.upstream_tool_admission_timeout,
          },
          retryable: true,
          recovery: 'restart-walk',
        },
      },
      facts,
    );
  }

  public async describeVisibleTool(
    args: { server?: string; toolName?: string },
    visibility?: CapabilityVisibility,
    queryOptions: CapabilityCatalogQueryOptions = {},
  ): Promise<DescribeVisibleToolResult> {
    const refresh = await this.resolveRefreshFacts(queryOptions.refreshIntent ?? 'never', 'describe');
    const access = await this.resolveVisibleToolAccess(args, visibility, queryOptions.toolRegistry);
    if (access.error) {
      return { schema: {}, error: access.error, refresh };
    }

    const { route } = access;
    const connection = access.connection;
    if (access.tool.definition && connection) {
      const cached = this.deps.schemaCache.getIfCached(route.connectionKey, route.toolName);
      const fromCache = cached !== null && JSON.stringify(cached) === JSON.stringify(access.tool.definition);
      const contracts = await admitToolSchemas(access.tool.definition as unknown as Record<string, unknown>, {
        routeKey: JSON.stringify(route),
        generation: connection.adapter.connectionId,
        sourceRevision: connection.adapter.protocolRevision,
        signal: queryOptions.signal,
      });
      if (!fromCache) this.deps.schemaCache.set(route.connectionKey, route.toolName, access.tool.definition);
      return {
        schema: applySourceToolDescription(
          projectToolSchemas(
            access.tool.definition as unknown as Record<string, unknown>,
            contracts,
          ) as unknown as Tool,
          this.deps.getServerConfigs()[route.server],
          route.server,
        ),
        fromCache,
        route,
        refresh,
      };
    }
    const cached = this.deps.schemaCache.getIfCached(route.connectionKey, route.toolName);
    if (cached) {
      const contracts = await admitToolSchemas(cached as unknown as Record<string, unknown>, {
        routeKey: JSON.stringify(route),
        generation: this.deps.outboundConnections.get(route.connectionKey)?.adapter.connectionId ?? '',
        sourceRevision: this.deps.outboundConnections.get(route.connectionKey)?.adapter.protocolRevision,
        signal: queryOptions.signal,
      });
      return {
        schema: applySourceToolDescription(
          projectToolSchemas(cached as unknown as Record<string, unknown>, contracts) as unknown as Tool,
          this.deps.getServerConfigs()[route.server],
          route.server,
        ),
        fromCache: true,
        route,
        refresh,
      };
    }

    if (!this.deps.loadSchema) {
      return {
        schema: {},
        error: {
          type: 'internal',
          message:
            'Tool schema not loaded and no SchemaLoader available. Please use the tool invocation flow to load schema on first use.',
        },
        refresh,
      };
    }

    try {
      const tool = await this.deps.schemaCache.getOrLoad(
        route.connectionKey,
        route.toolName,
        this.deps.loadSchema,
        queryOptions.signal,
      );
      const contracts = await admitToolSchemas(tool as unknown as Record<string, unknown>, {
        routeKey: JSON.stringify(route),
        generation: this.deps.outboundConnections.get(route.connectionKey)?.adapter.connectionId ?? '',
        sourceRevision: this.deps.outboundConnections.get(route.connectionKey)?.adapter.protocolRevision,
        signal: queryOptions.signal,
      });
      return {
        schema: applySourceToolDescription(
          projectToolSchemas(tool as unknown as Record<string, unknown>, contracts) as unknown as Tool,
          this.deps.getServerConfigs()[route.server],
          route.server,
        ),
        fromCache: false,
        route,
        refresh,
      };
    } catch (error) {
      const failure = gatewayFailureFromUnknown(error, 'transport');
      logger.error('Failed to load upstream tool schema', { failure });
      return {
        schema: {},
        error: {
          type: 'upstream',
          message: failure.message,
        },
        refresh,
      };
    }
  }

  public async invokeVisibleTool(
    args: { server?: string; toolName?: string; args: unknown },
    visibility?: CapabilityVisibility,
    queryOptions: CapabilityCatalogQueryOptions = {},
  ): Promise<InvokeVisibleToolResult> {
    const refresh = await this.resolveRefreshFacts(queryOptions.refreshIntent ?? 'never', 'invoke');
    const access = await this.resolveVisibleToolAccess(args, visibility, queryOptions.toolRegistry);
    if (access.error) {
      return {
        result: {},
        server: args.server ?? '',
        tool: args.toolName ?? '',
        error: access.error,
        refresh,
      };
    }

    const { route } = access;
    const connection = access.connection ?? this.deps.outboundConnections.get(route.connectionKey);
    if (
      !connection ||
      connection.status !== ClientStatus.Connected ||
      this.deps.outboundConnections.get(route.connectionKey) !== connection
    ) {
      return {
        result: {},
        server: route.server,
        tool: route.toolName,
        route,
        error: {
          type: 'upstream',
          message: `Server not connected: ${route.server}`,
        },
        refresh,
      };
    }

    try {
      const adapter = connection.adapter;
      const definition =
        access.tool.definition ??
        this.deps.schemaCache.getIfCached(route.connectionKey, route.toolName) ??
        (this.deps.loadSchema
          ? await this.deps.loadSchema(route.connectionKey, route.toolName, queryOptions.signal)
          : undefined);
      if (!definition) throw new SchemaBoundaryError('schema_invalid');
      const binding = {
        routeKey: JSON.stringify(route),
        generation: adapter.connectionId,
        sourceRevision: adapter.protocolRevision,
        signal: queryOptions.signal,
      };
      const contracts = await admitToolSchemas(definition as unknown as Record<string, unknown>, binding);
      const validateOutput = await prepareToolValidation(contracts, args.args, binding);
      const current = await this.resolveVisibleToolAccess(args, visibility, queryOptions.toolRegistry);
      if (
        queryOptions.signal?.aborted ||
        current.error ||
        this.deps.outboundConnections.get(route.connectionKey) !== connection ||
        connection.adapter !== adapter ||
        JSON.stringify(current.route) !== JSON.stringify(route) ||
        (current.tool.definition && JSON.stringify(current.tool.definition) !== JSON.stringify(definition))
      )
        throw new SchemaBoundaryError('schema_invalid');
      const result = await requestLegacyAdapter(
        adapter,
        'tools/call',
        {
          name: route.toolName,
          arguments: args.args as never,
        },
        { signal: queryOptions.signal, timeoutMs: connection.requestTimeoutMs },
      );
      await validateOutput(result);
      return { result, server: route.server, tool: route.toolName, route, refresh };
    } catch (error) {
      if (error instanceof SchemaBoundaryError && error.code === 'schema_input_invalid')
        return { result: schemaInputErrorResult(), server: route.server, tool: route.toolName, route, refresh };
      if (error instanceof SchemaBoundaryError)
        return {
          result: {},
          server: route.server,
          tool: route.toolName,
          route,
          refresh,
          error: {
            type: !error.retryable && error.phase === 'input' ? 'validation' : 'upstream',
            message: error.code,
          },
        };
      const failure = gatewayFailureFromUnknown(error, 'transport');
      logger.error('Tool invocation failed', { failure });

      return {
        result: {},
        server: route.server,
        tool: route.toolName,
        route,
        error: {
          type: 'upstream',
          message: failure.message,
        },
        refresh,
      };
    }
  }

  private async resolveRefreshFacts(
    intent: CapabilityRefreshIntent,
    reason: CapabilityRefreshReason,
  ): Promise<CapabilityRefreshFacts> {
    if (intent === 'never') {
      return NEVER_REFRESH;
    }

    if (!this.deps.refreshCapabilities) {
      return {
        intent,
        refreshed: false,
        changed: false,
        shouldNotifyListChanged: false,
      };
    }

    const result = await this.deps.refreshCapabilities({ intent, reason });
    return {
      intent,
      refreshed: true,
      changed: result?.changed ?? false,
      shouldNotifyListChanged: result?.shouldNotifyListChanged ?? false,
    };
  }

  private async visibleToolRegistry(
    visibility?: CapabilityVisibility,
    requestRegistry?: ToolRegistry,
  ): Promise<ToolRegistry> {
    let registry = requestRegistry ?? (await this.deps.getToolRegistry());
    if (registry.isCurrent?.() === false) return ToolRegistry.empty();
    const effectiveVisibility = visibility ?? this.deps.defaultVisibility;
    if (effectiveVisibility !== undefined) {
      const connectedCandidates = new Map(
        Array.from(effectiveVisibility.serverCandidates).filter(
          ([connectionKey]) => this.deps.outboundConnections.get(connectionKey)?.status === ClientStatus.Connected,
        ),
      );
      registry = registry.filterByServerCandidates(connectedCandidates);
    }

    if (typeof registry.getAllTools !== 'function') {
      return registry;
    }

    const serverConfigs = this.deps.getServerConfigs();
    return ToolRegistry.fromToolsWithServer(
      registry
        .getAllTools()
        .filter((tool) => !isSourceToolDisabled(serverConfigs, tool.server, tool.name))
        .map((tool) => ({
          tool: applySourceToolDescription(
            tool.definition ?? {
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema ?? { type: 'object' },
            },
            serverConfigs[tool.server],
            tool.server,
          ),
          server: tool.server,
          connectionKey: tool.connectionKey,
          tags: tool.tags,
        })),
      registry.getListingMeta(),
    ).withConnections(registry.getConnections(), () => registry.isCurrent());
  }

  private async resolveVisibleToolAccess(
    args: { server?: string; toolName?: string },
    visibility?: CapabilityVisibility,
    requestRegistry?: ToolRegistry,
  ): Promise<
    | { route: CapabilityRoute; tool: ToolMetadata; connection?: OutboundConnection; error?: never }
    | { route?: never; tool?: never; connection?: never; error: CapabilityAccessError }
  > {
    if (!args.server || !args.toolName) {
      return {
        error: {
          type: 'validation',
          message: 'Validation Error: "server" and "toolName" are required parameters',
        },
      };
    }

    const sourceRegistry = requestRegistry ?? (await this.deps.getToolRegistry());
    await this.pruneToolAdmissionOutcomes(sourceRegistry);
    const visibleRegistry = await this.visibleToolRegistry(visibility, sourceRegistry);
    if (typeof visibleRegistry.getTool !== 'function') {
      return {
        error: {
          type: 'internal',
          message:
            'Tool schema not loaded and no SchemaLoader available. Please use the tool invocation flow to load schema on first use.',
        },
      };
    }

    const tool = visibleRegistry.getTool(args.server, args.toolName);
    const withheld = tool && this.isToolWithheld(tool, sourceRegistry);
    if (!tool || withheld) {
      const disabledError = this.isServerVisible(args.server, visibility)
        ? getDisabledSourceToolError(this.deps.getServerConfigs(), args.server, args.toolName)
        : undefined;
      return {
        error: disabledError ?? {
          type: 'not_found',
          message: `Tool not found: ${args.server}:${args.toolName}. Call tool_list to see available tools.`,
        },
      };
    }

    const route = this.resolveRoute(tool, visibility);
    if (!route) {
      return {
        error: {
          type: 'upstream',
          message: `Server not connected: ${args.server}`,
        },
      };
    }

    return { route, tool, connection: visibleRegistry.getConnections()?.get(route.connectionKey) };
  }

  private isToolWithheld(tool: ToolMetadata, registry: ToolRegistry): boolean {
    const key = tool.connectionKey ?? tool.server;
    const outcome = this.withheldTools.get(JSON.stringify([key, tool.name]));
    if (!outcome?.withheld) return false;
    if (outcome.registry !== registry) return false;
    const connection = this.deps.outboundConnections.get(key);
    if (outcome.connection !== connection) return false;
    if (outcome.adapter !== connection?.adapter) return false;
    return true;
  }

  private isServerVisible(server: string, visibility?: CapabilityVisibility): boolean {
    const effectiveVisibility = visibility ?? this.deps.defaultVisibility;
    return effectiveVisibility === undefined || getCapabilityVisibleServerNames(effectiveVisibility).has(server);
  }

  private resolveRoute(tool: ToolMetadata, visibility?: CapabilityVisibility): CapabilityRoute | undefined {
    const registryConnectionKey = tool.connectionKey ?? tool.server;
    const sessionId = visibility?.sessionId ?? this.deps.defaultVisibility?.sessionId;
    if (
      sessionId &&
      registryConnectionKey !== tool.server &&
      this.connectionResolver.resolveWithKey(tool.server, sessionId)?.key !== registryConnectionKey
    )
      return undefined;
    if (this.deps.outboundConnections.has(registryConnectionKey)) {
      return {
        ...tool.route!,
        kind: 'tools',
        origin: 'external',
        upstreamIdentity: tool.name,
        publicIdentity: tool.route?.publicIdentity ?? `${tool.server}_1mcp_${tool.name}`,
        server: tool.server,
        toolName: tool.name,
        connectionKey: registryConnectionKey,
      };
    }

    const sessionResult = sessionId ? this.connectionResolver.resolveWithKey(tool.server, sessionId) : undefined;
    const result = sessionResult ?? (!sessionId ? this.connectionResolver.findByServerName(tool.server) : undefined);
    if (!result) {
      return undefined;
    }

    return {
      ...tool.route!,
      kind: 'tools',
      origin: 'external',
      upstreamIdentity: tool.name,
      publicIdentity: tool.route?.publicIdentity ?? `${tool.server}_1mcp_${tool.name}`,
      server: tool.server,
      toolName: tool.name,
      connectionKey: result.key,
    };
  }
}
