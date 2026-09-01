import type { Tool } from '@src/sdk/legacy/types.js';

import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { ConnectionResolver, type TemplateHashProvider } from '@src/core/server/connectionResolver.js';
import { getDisabledToolError, isToolDisabled } from '@src/core/server/disabledTools.js';
import { applyEffectiveToolDescription } from '@src/core/server/toolDescriptionOverrides.js';
import {
  ClientStatus,
  type MCPServerParams,
  type OutboundConnection,
  type OutboundConnections,
} from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import {
  type CapabilityKind,
  type CapabilityPage,
  type CapabilityPaginationResult,
  walkCapabilityPages,
} from './capabilityPagination.js';
import { type CapabilityVisibility, getCapabilityVisibleServerNames } from './capabilityVisibility.js';
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
}

export interface CapabilityRoute {
  server: string;
  toolName: string;
  connectionKey: string;
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
  loadSchema?: (server: string, toolName: string) => Promise<Tool>;
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
                    return name === undefined || !isToolDisabled(serverConfigs, serverName, name);
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
    const result = registry.listTools(options);
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
    const cached = this.deps.schemaCache.getIfCached(route.connectionKey, route.toolName);
    if (cached) {
      return {
        schema: applyEffectiveToolDescription(cached, this.deps.getServerConfigs()[route.server], route.server),
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
      const tool = await this.deps.schemaCache.getOrLoad(route.connectionKey, route.toolName, this.deps.loadSchema);
      return {
        schema: applyEffectiveToolDescription(tool, this.deps.getServerConfigs()[route.server], route.server),
        fromCache: false,
        route,
        refresh,
      };
    } catch (error) {
      logger.error(`Failed to load tool schema from upstream server: ${route.server}:${route.toolName}`, { error });
      return {
        schema: {},
        error: {
          type: 'upstream',
          message: `Failed to load schema from server: ${error}`,
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
    const connection = this.deps.outboundConnections.get(route.connectionKey);
    if (!connection || connection.status !== ClientStatus.Connected) {
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
      const result = await requestLegacyAdapter(connection.adapter, 'tools/call', {
        name: route.toolName,
        arguments: args.args as never,
      });
      return { result, server: route.server, tool: route.toolName, route, refresh };
    } catch (error) {
      logger.error(`Tool invocation failed: ${route.server}:${route.toolName}`, { error });
      if (error instanceof Error && error.message.includes('not found')) {
        return {
          result: {},
          server: route.server,
          tool: route.toolName,
          route,
          error: {
            type: 'not_found',
            message: `Tool not found: ${route.server}:${route.toolName}`,
          },
          refresh,
        };
      }

      return {
        result: {},
        server: route.server,
        tool: route.toolName,
        route,
        error: {
          type: 'upstream',
          message: `Server Error: ${error}. This is an upstream server issue - please report it.`,
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
        .filter((tool) => !isToolDisabled(serverConfigs, tool.server, tool.name))
        .map((tool) => ({
          tool: applyEffectiveToolDescription(
            {
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
    );
  }

  private resolveVisibleToolAccess(
    args: { server?: string; toolName?: string },
    visibility?: CapabilityVisibility,
  ):
    | { route: CapabilityRoute; tool: ToolMetadata; error?: never }
    | { route?: never; tool?: never; error: CapabilityAccessError } {
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
        ? getDisabledToolError(this.deps.getServerConfigs(), args.server, args.toolName)
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

    return { route, tool };
  }

  private isServerVisible(server: string, visibility?: CapabilityVisibility): boolean {
    const effectiveVisibility = visibility ?? this.deps.defaultVisibility;
    return effectiveVisibility === undefined || getCapabilityVisibleServerNames(effectiveVisibility).has(server);
  }

  private resolveRoute(tool: ToolMetadata, visibility?: CapabilityVisibility): CapabilityRoute | undefined {
    const registryConnectionKey = tool.connectionKey ?? tool.server;
    if (this.deps.outboundConnections.has(registryConnectionKey)) {
      return {
        server: tool.server,
        toolName: tool.name,
        connectionKey: registryConnectionKey,
      };
    }

    const sessionId = visibility?.sessionId ?? this.deps.defaultVisibility?.sessionId;
    const sessionResult = sessionId ? this.connectionResolver.resolveWithKey(tool.server, sessionId) : undefined;
    const result = sessionResult ?? (!sessionId ? this.connectionResolver.findByServerName(tool.server) : undefined);
    if (!result) {
      return undefined;
    }

    return {
      server: tool.server,
      toolName: tool.name,
      connectionKey: result.key,
    };
  }
}
