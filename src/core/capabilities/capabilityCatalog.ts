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
import type { Tool } from '@src/sdk/contracts/index.js';

import {
  type CapabilityKind,
  type CapabilityPage,
  type CapabilityPaginationResult,
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
  getToolRegistry: () => ToolRegistry;
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

export class CapabilityCatalog {
  private readonly connectionResolver: ConnectionResolver;

  constructor(private readonly deps: CapabilityCatalogDependencies) {
    this.connectionResolver = new ConnectionResolver(deps.outboundConnections, deps.templateHashProvider);
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
    const refresh = await this.resolveRefreshFacts(queryOptions.refreshIntent ?? 'never', 'list');
    const registry = this.visibleToolRegistry(visibility);
    const admitted = [];
    for (const tool of registry.getAllTools()) {
      try {
        const key = tool.connectionKey ?? tool.server;
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
        admitted.push({
          tool: projectToolSchemas(definition as unknown as Record<string, unknown>, contracts) as unknown as Tool,
          server: tool.server,
          connectionKey: key,
          tags: tool.tags,
        });
      } catch (error) {
        if (!(error instanceof SchemaBoundaryError) || error.retryable) throw error;
      }
    }
    const result = ToolRegistry.fromToolsWithServer(admitted).listTools(options);
    const tools = result.tools;
    const servers = Array.from(new Set(tools.map((tool) => tool.server))).sort();
    const routes = tools
      .map((tool) => this.resolveRoute(tool, visibility))
      .filter((route): route is CapabilityRoute => route !== undefined);

    return {
      ...result,
      tools,
      servers,
      routes,
      refresh,
    };
  }

  public async describeVisibleTool(
    args: { server?: string; toolName?: string },
    visibility?: CapabilityVisibility,
    queryOptions: CapabilityCatalogQueryOptions = {},
  ): Promise<DescribeVisibleToolResult> {
    const refresh = await this.resolveRefreshFacts(queryOptions.refreshIntent ?? 'never', 'describe');
    const access = this.resolveVisibleToolAccess(args, visibility);
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
    const access = this.resolveVisibleToolAccess(args, visibility);
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
      const current = this.resolveVisibleToolAccess(args, visibility);
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

  private visibleToolRegistry(visibility?: CapabilityVisibility): ToolRegistry {
    let registry = this.deps.getToolRegistry();
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
    ).withConnections(registry.getConnections(), () => registry.isCurrent());
  }

  private resolveVisibleToolAccess(
    args: { server?: string; toolName?: string },
    visibility?: CapabilityVisibility,
  ):
    | { route: CapabilityRoute; tool: ToolMetadata; connection?: OutboundConnection; error?: never }
    | { route?: never; tool?: never; connection?: never; error: CapabilityAccessError } {
    if (!args.server || !args.toolName) {
      return {
        error: {
          type: 'validation',
          message: 'Validation Error: "server" and "toolName" are required parameters',
        },
      };
    }

    const visibleRegistry = this.visibleToolRegistry(visibility);
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
    if (!tool) {
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
