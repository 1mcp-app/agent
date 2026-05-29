import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { ConnectionResolver, TemplateHashProvider } from '@src/core/server/connectionResolver.js';
import { getDisabledToolError } from '@src/core/server/disabledTools.js';
import { OutboundConnections } from '@src/core/types/index.js';
import logger, { errorIf } from '@src/logger/logger.js';
import { zodToInputSchema, zodToOutputSchema } from '@src/utils/schemaUtils.js';

import { CapabilityCatalog } from './capabilityCatalog.js';
import { SchemaCache } from './schemaCache.js';
import {
  ToolInvokeInputSchema,
  ToolInvokeOutput,
  ToolInvokeOutputSchema,
  ToolListInputSchema,
  ToolListOutput,
  ToolListOutputSchema,
  ToolSchemaInputSchema,
  ToolSchemaOutput,
  ToolSchemaOutputSchema,
} from './schemas/metaToolSchemas.js';
import { ToolMetadata, ToolRegistry } from './toolRegistry.js';

/**
 * Result types for meta-tools
 */
export type ListToolsResult = ToolListOutput;
export type DescribeToolResult = ToolSchemaOutput;
export type CallToolResult = ToolInvokeOutput;

/**
 * Function to load tool schema from upstream server
 */
export type SchemaLoader = (server: string, toolName: string) => Promise<Tool>;

/**
 * Arguments for tool_list
 */
export interface ListAvailableToolsArgs {
  server?: string;
  pattern?: string;
  tag?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Arguments for tool_schema
 */
export interface DescribeToolArgs {
  server: string;
  toolName: string;
}

/**
 * Arguments for tool_invoke
 */
export interface CallToolArgs {
  server: string;
  toolName: string;
  args: unknown;
}

/**
 * Function to get the current tool registry
 * This allows the provider to always have access to the latest registry
 */
export type ToolRegistryProvider = () => ToolRegistry;

/**
 * MetaToolProvider provides meta-tools for lazy loading:
 * 1. tool_list - List all tools (names + descriptions only)
 * 2. tool_schema - Get full tool schema on-demand
 * 3. tool_invoke - Invoke any tool by server and name
 *
 * @example
 * ```typescript
 * const provider = new MetaToolProvider(() => toolRegistry, schemaCache, outboundConnections, loadSchemaFn);
 * const tools = provider.getMetaTools();
 * const result = await provider.callMetaTool('tool_list', { server: 'filesystem' });
 * ```
 */
export class MetaToolProvider {
  private getToolRegistry: ToolRegistryProvider;
  private schemaCache: SchemaCache;
  private outboundConnections: OutboundConnections;
  private loadSchema?: SchemaLoader;
  private allowedServers?: Set<string>;
  private connectionResolver: ConnectionResolver;
  private capabilityCatalog: CapabilityCatalog;
  private templateHashProvider?: TemplateHashProvider;

  constructor(
    getToolRegistry: ToolRegistryProvider,
    schemaCache: SchemaCache,
    outboundConnections: OutboundConnections,
    loadSchema?: SchemaLoader,
    allowedServers?: Set<string>,
    templateHashProvider?: TemplateHashProvider,
  ) {
    this.getToolRegistry = getToolRegistry;
    this.schemaCache = schemaCache;
    this.outboundConnections = outboundConnections;
    this.loadSchema = loadSchema;
    this.allowedServers = allowedServers;
    this.templateHashProvider = templateHashProvider;
    this.connectionResolver = new ConnectionResolver(outboundConnections, templateHashProvider);
    this.capabilityCatalog = new CapabilityCatalog({
      getToolRegistry,
      schemaCache,
      outboundConnections,
      loadSchema,
      defaultAllowedServers: allowedServers,
      templateHashProvider,
      getServerConfigs: () => McpConfigManager.getInstance().getTransportConfig(),
    });
  }

  /**
   * Resolve a clean server name to the actual connection key.
   * Delegates to ConnectionResolver.findByServerName for unified resolution logic.
   *
   * @param cleanServerName - The clean server name (without hash suffix)
   * @returns The actual connection key, or the original name if not found
   */
  private resolveConnectionKey(cleanServerName: string, sessionId?: string): string {
    const result =
      this.connectionResolver.resolveWithKey(cleanServerName, sessionId) ??
      this.connectionResolver.findByServerName(cleanServerName);
    return result?.key ?? cleanServerName;
  }

  /**
   * Set the allowed servers filter
   * @param serverNames - Set of server names to allow, or undefined to allow all
   */
  public setAllowedServers(serverNames?: Set<string>): void {
    this.allowedServers = serverNames;
    this.capabilityCatalog = new CapabilityCatalog({
      getToolRegistry: this.getToolRegistry,
      schemaCache: this.schemaCache,
      outboundConnections: this.outboundConnections,
      loadSchema: this.loadSchema,
      defaultAllowedServers: serverNames,
      templateHashProvider: this.templateHashProvider,
      getServerConfigs: () => McpConfigManager.getInstance().getTransportConfig(),
    });
  }

  private getDisabledError(logicalServerName: string, toolName: string) {
    return getDisabledToolError(McpConfigManager.getInstance().getTransportConfig(), logicalServerName, toolName);
  }

  private validateResolvedToolAccess(
    args: DescribeToolArgs | CallToolArgs,
    allowedServers?: Set<string>,
  ): { error?: DescribeToolResult['error'] | CallToolResult['error'] } {
    if (!args.server || !args.toolName) {
      return {
        error: {
          type: 'validation',
          message: 'Validation Error: "server" and "toolName" are required parameters',
        },
      };
    }

    if (!this.toolRegistry(allowedServers).hasTool(args.server, args.toolName)) {
      return {
        error: {
          type: 'not_found',
          message: `Tool not found: ${args.server}:${args.toolName}. Call tool_list to see available tools.`,
        },
      };
    }

    return {
      error: this.getDisabledError(args.server, args.toolName),
    };
  }

  /**
   * Get the current tool registry, optionally filtered by allowed servers
   */
  private toolRegistry(allowedServers?: Set<string>): ToolRegistry {
    const registry = this.getToolRegistry();
    const effectiveAllowedServers = allowedServers ?? this.allowedServers;
    if (effectiveAllowedServers !== undefined) {
      return registry.filterByServers(effectiveAllowedServers);
    }
    return registry;
  }

  /**
   * Get all available meta-tools (3 discovery tools)
   */
  public getMetaTools(): Tool[] {
    return [this.createListToolsMetaTool(), this.createDescribeToolMetaTool(), this.createCallToolMetaTool()];
  }

  /**
   * Call a meta-tool by name
   */
  public async callMetaTool(
    name: string,
    args: unknown,
    sessionId?: string,
    allowedServers?: Set<string>,
  ): Promise<ListToolsResult | DescribeToolResult | CallToolResult> {
    switch (name) {
      case 'tool_list': {
        const parsed = ToolListInputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            tools: [],
            totalCount: 0,
            servers: [],
            hasMore: false,
            error: {
              type: 'validation',
              message: `Invalid arguments for tool_list: ${parsed.error.message}`,
            },
          } as ListToolsResult;
        }
        return this.listAvailableTools(parsed.data, sessionId, allowedServers);
      }
      case 'tool_schema': {
        const parsed = ToolSchemaInputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            schema: {},
            error: {
              type: 'validation',
              message: `Invalid arguments for tool_schema: ${parsed.error.message}`,
            },
          } as DescribeToolResult;
        }
        return this.describeTool(parsed.data, sessionId, allowedServers);
      }
      case 'tool_invoke': {
        const parsed = ToolInvokeInputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            result: {},
            server: '',
            tool: '',
            error: {
              type: 'validation',
              message: `Invalid arguments for tool_invoke: ${parsed.error.message}`,
            },
          } as CallToolResult;
        }
        return this.callTool(parsed.data, sessionId, allowedServers);
      }
      default:
        return {
          tools: [],
          totalCount: 0,
          servers: [],
          hasMore: false,
          error: {
            type: 'not_found',
            message: `Unknown meta-tool: ${name}. Valid meta-tools are: tool_list, tool_schema, tool_invoke`,
          },
        } as ListToolsResult;
    }
  }

  /**
   * Create the tool_list meta-tool
   */
  private createListToolsMetaTool(): Tool {
    return {
      name: 'tool_list',
      description: 'List all available MCP tools with names and descriptions. Use for tool discovery.',
      inputSchema: zodToInputSchema(ToolListInputSchema) as Tool['inputSchema'],
      outputSchema: zodToOutputSchema(ToolListOutputSchema) as Tool['outputSchema'],
    };
  }

  /**
   * Implement tool_list
   */
  private async listAvailableTools(
    args: ListAvailableToolsArgs,
    sessionId?: string,
    allowedServers?: Set<string>,
  ): Promise<ListToolsResult> {
    try {
      const result = await this.capabilityCatalog.listVisibleTools(args, sessionId, allowedServers);

      // Format tools for response
      const tools = result.tools.map((tool: ToolMetadata) => ({
        name: tool.name,
        server: tool.server,
        description: tool.description,
        tags: tool.tags,
      }));

      // Get unique servers from filtered results to keep output consistent with applied filters
      const servers = Array.from(new Set(result.tools.map((t) => t.server))).sort();

      // Return structured result matching outputSchema
      const response: ListToolsResult = {
        tools,
        totalCount: result.totalCount,
        servers,
        hasMore: result.hasMore,
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorIf(() => ({
        message: 'Error in tool_list meta-tool',
        meta: { args, error: errorMessage },
      }));

      return {
        tools: [],
        totalCount: 0,
        servers: [],
        hasMore: false,
        error: {
          type: 'internal',
          message: `Internal error listing tools: ${errorMessage}`,
        },
      };
    }
  }

  /**
   * Create the tool_schema meta-tool
   */
  private createDescribeToolMetaTool(): Tool {
    return {
      name: 'tool_schema',
      description: 'Get the full schema for a specific tool including input validation rules',
      inputSchema: zodToInputSchema(ToolSchemaInputSchema) as Tool['inputSchema'],
      outputSchema: zodToOutputSchema(ToolSchemaOutputSchema) as Tool['outputSchema'],
    };
  }

  /**
   * Implement tool_schema
   */
  private async describeTool(
    args: DescribeToolArgs,
    sessionId?: string,
    allowedServers?: Set<string>,
  ): Promise<DescribeToolResult> {
    try {
      const result = await this.capabilityCatalog.describeVisibleTool(args, sessionId, allowedServers);
      if (result.error) {
        return {
          schema: {},
          error: result.error,
        };
      }

      return {
        schema: result.schema as Tool,
        fromCache: result.fromCache,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorIf(() => ({
        message: 'Error in tool_schema meta-tool',
        meta: { server: args.server, toolName: args.toolName, error: errorMessage },
      }));

      return {
        schema: {},
        error: {
          type: 'internal',
          message: `Internal error describing tool: ${errorMessage}`,
        },
      };
    }
  }

  /**
   * Create the tool_invoke meta-tool
   */
  private createCallToolMetaTool(): Tool {
    return {
      name: 'tool_invoke',
      description: 'Execute any tool on any MCP server with proper argument validation',
      inputSchema: zodToInputSchema(ToolInvokeInputSchema) as Tool['inputSchema'],
      outputSchema: zodToOutputSchema(ToolInvokeOutputSchema) as Tool['outputSchema'],
    };
  }

  /**
   * Implement tool_invoke
   */
  private async callTool(
    args: CallToolArgs,
    sessionId?: string,
    allowedServers?: Set<string>,
  ): Promise<CallToolResult> {
    try {
      const result = await this.capabilityCatalog.invokeVisibleTool(args, sessionId, allowedServers);
      if (result.error) {
        return {
          result: {},
          server: args.server,
          tool: args.toolName,
          error: result.error,
        };
      }

      return {
        result: result.result as Record<string, unknown>,
        server: result.server,
        tool: result.tool,
      };
    } catch (error) {
      logger.error(`Error in tool_invoke: ${error}`);

      // Check if it's a tool not found error from upstream
      if (error instanceof Error && error.message.includes('not found')) {
        return {
          result: {},
          server: args.server,
          tool: args.toolName,
          error: {
            type: 'not_found',
            message: `Tool not found: ${args.server}:${args.toolName}`,
          },
        };
      }

      return {
        result: {},
        server: args.server,
        tool: args.toolName,
        error: {
          type: 'upstream',
          message: `Server Error: ${error}. This is an upstream server issue - please report it.`,
        },
      };
    }
  }
}
