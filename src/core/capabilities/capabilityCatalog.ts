import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { ConnectionResolver, type TemplateHashProvider } from '@src/core/server/connectionResolver.js';
import { getDisabledToolError, isToolDisabled } from '@src/core/server/disabledTools.js';
import type { MCPServerParams, OutboundConnections } from '@src/core/types/index.js';

import { SchemaCache } from './schemaCache.js';
import type { ListToolsOptions, ListToolsResult as RegistryListToolsResult, ToolMetadata } from './toolRegistry.js';
import { ToolRegistry } from './toolRegistry.js';

export interface CapabilityAccessError {
  type: 'validation' | 'not_found' | 'upstream' | 'internal';
  message: string;
}

export type CapabilityRefreshIntent = 'never' | 'ifStale' | 'force';

export interface CapabilityRefreshFacts {
  intent: CapabilityRefreshIntent;
  refreshed: boolean;
  changed: boolean;
  shouldNotifyListChanged: boolean;
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
  defaultAllowedServers?: Set<string>;
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

  public listVisibleTools(
    options: ListToolsOptions = {},
    sessionId?: string,
    allowedServers?: Set<string>,
  ): VisibleToolListResult {
    const registry = this.visibleToolRegistry(allowedServers);
    const result = registry.listTools(options);
    const tools = result.tools;
    const servers = Array.from(new Set(tools.map((tool) => tool.server))).sort();
    const routes = tools
      .map((tool) => this.resolveRoute(tool.server, tool.name, sessionId))
      .filter((route): route is CapabilityRoute => route !== undefined);

    return {
      ...result,
      tools,
      servers,
      routes,
      refresh: NEVER_REFRESH,
    };
  }

  public async describeVisibleTool(
    args: { server?: string; toolName?: string },
    sessionId?: string,
    allowedServers?: Set<string>,
  ): Promise<DescribeVisibleToolResult> {
    const access = this.resolveVisibleToolAccess(args, sessionId, allowedServers);
    if (access.error) {
      return { schema: {}, error: access.error, refresh: NEVER_REFRESH };
    }

    const { route } = access;
    const cached = this.deps.schemaCache.getIfCached(route.connectionKey, route.toolName);
    if (cached) {
      return { schema: cached, fromCache: true, route, refresh: NEVER_REFRESH };
    }

    if (!this.deps.loadSchema) {
      return {
        schema: {},
        error: {
          type: 'internal',
          message:
            'Tool schema not loaded and no SchemaLoader available. Please use the tool invocation flow to load schema on first use.',
        },
        refresh: NEVER_REFRESH,
      };
    }

    try {
      const tool = await this.deps.schemaCache.getOrLoad(route.connectionKey, route.toolName, this.deps.loadSchema);
      return { schema: tool, fromCache: false, route, refresh: NEVER_REFRESH };
    } catch (error) {
      return {
        schema: {},
        error: {
          type: 'upstream',
          message: `Failed to load schema from server: ${error}`,
        },
        refresh: NEVER_REFRESH,
      };
    }
  }

  public async invokeVisibleTool(
    args: { server?: string; toolName?: string; args: unknown },
    sessionId?: string,
    allowedServers?: Set<string>,
  ): Promise<InvokeVisibleToolResult> {
    const access = this.resolveVisibleToolAccess(args, sessionId, allowedServers);
    if (access.error) {
      return {
        result: {},
        server: args.server ?? '',
        tool: args.toolName ?? '',
        error: access.error,
        refresh: NEVER_REFRESH,
      };
    }

    const { route } = access;
    const connection = this.deps.outboundConnections.get(route.connectionKey);
    if (!connection?.client) {
      return {
        result: {},
        server: route.server,
        tool: route.toolName,
        route,
        error: {
          type: 'upstream',
          message: `Server not connected: ${route.server}`,
        },
        refresh: NEVER_REFRESH,
      };
    }

    try {
      const result = await connection.client.callTool({
        name: route.toolName,
        arguments: args.args as Record<string, unknown>,
      });
      return { result, server: route.server, tool: route.toolName, route, refresh: NEVER_REFRESH };
    } catch (error) {
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
          refresh: NEVER_REFRESH,
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
        refresh: NEVER_REFRESH,
      };
    }
  }

  private visibleToolRegistry(allowedServers?: Set<string>): ToolRegistry {
    let registry = this.deps.getToolRegistry();
    const effectiveAllowedServers = allowedServers ?? this.deps.defaultAllowedServers;
    if (effectiveAllowedServers !== undefined) {
      registry = registry.filterByServers(effectiveAllowedServers);
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
          tool: {
            name: tool.name,
            description: tool.description,
            inputSchema: { type: 'object' },
          },
          server: tool.server,
          tags: tool.tags,
        })),
    );
  }

  private resolveVisibleToolAccess(
    args: { server?: string; toolName?: string },
    sessionId?: string,
    allowedServers?: Set<string>,
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

    const visibleRegistry = this.visibleToolRegistry(allowedServers);
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
      const disabledError = getDisabledToolError(this.deps.getServerConfigs(), args.server, args.toolName);
      return {
        error: disabledError ?? {
          type: 'not_found',
          message: `Tool not found: ${args.server}:${args.toolName}. Call tool_list to see available tools.`,
        },
      };
    }

    const route = this.resolveRoute(args.server, args.toolName, sessionId);
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

  private resolveRoute(server: string, toolName: string, sessionId?: string): CapabilityRoute | undefined {
    const result =
      this.connectionResolver.resolveWithKey(server, sessionId) ?? this.connectionResolver.findByServerName(server);
    if (!result) {
      return undefined;
    }

    return {
      server,
      toolName,
      connectionKey: result.key,
    };
  }
}
