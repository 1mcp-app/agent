import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { OutboundConnections } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { zodToInputSchema, zodToOutputSchema } from '@src/utils/schemaUtils.js';

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

  constructor(
    getToolRegistry: ToolRegistryProvider,
    schemaCache: SchemaCache,
    outboundConnections: OutboundConnections,
    loadSchema?: SchemaLoader,
    allowedServers?: Set<string>,
  ) {
    this.getToolRegistry = getToolRegistry;
    this.schemaCache = schemaCache;
    this.outboundConnections = outboundConnections;
    this.loadSchema = loadSchema;
    this.allowedServers = allowedServers;
  }

  /**
   * Resolve a clean server name to the actual connection key
   *
   * Template servers are stored with hash-suffixed keys like:
   * - "template-server:abc123" (shareable template with renderedHash)
   * - "template-server:sessionId" (per-client template)
   *
   * But the ToolRegistry uses clean names like "template-server".
   * This method finds the actual connection key by matching the clean name.
   *
   * @param cleanServerName - The clean server name (without hash suffix)
   * @returns The actual connection key, or the original name if not found
   */
  private resolveConnectionKey(cleanServerName: string): string {
    // First try direct lookup (for static servers)
    if (this.outboundConnections.has(cleanServerName)) {
      return cleanServerName;
    }

    // For template servers, search for keys that match the pattern
    // Key format: "serverName:hash" where hash is either renderedHash or sessionId
    for (const [key, connection] of this.outboundConnections.entries()) {
      // Check if connection.name matches the clean server name
      if (connection.name === cleanServerName) {
        return key;
      }

      // Also check if the key starts with the server name followed by colon
      // This handles cases where connection.name might not be set correctly
      if (key.startsWith(cleanServerName + ':')) {
        return key;
      }
    }

    // Not found - return original name
    return cleanServerName;
  }

  /**
   * Set the allowed servers filter
   * @param serverNames - Set of server names to allow, or undefined to allow all
   */
  public setAllowedServers(serverNames?: Set<string>): void {
    this.allowedServers = serverNames;
  }

  /**
   * Get the current tool registry, optionally filtered by allowed servers
   */
  private toolRegistry(): ToolRegistry {
    const registry = this.getToolRegistry();
    if (this.allowedServers !== undefined) {
      return registry.filterByServers(this.allowedServers);
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
        return this.listAvailableTools(parsed.data);
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
        return this.describeTool(parsed.data);
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
        return this.callTool(parsed.data);
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
  private async listAvailableTools(args: ListAvailableToolsArgs): Promise<ListToolsResult> {
    try {
      const registry = this.toolRegistry();
      const result = registry.listTools(args);
      const servers = registry.getServers();

      // Format tools for response
      const tools = result.tools.map((tool: ToolMetadata) => ({
        name: tool.name,
        server: tool.server,
        description: tool.description,
        tags: tool.tags,
      }));

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
      logger.error(`Error in tool_list: ${error}`);
      return {
        tools: [],
        totalCount: 0,
        servers: [],
        hasMore: false,
        error: {
          type: 'upstream',
          message: `Error listing tools: ${error}`,
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
  private async describeTool(args: DescribeToolArgs): Promise<DescribeToolResult> {
    try {
      // Validate arguments
      if (!args.server || !args.toolName) {
        return {
          schema: {},
          error: {
            type: 'validation',
            message: 'Validation Error: "server" and "toolName" are required parameters',
          },
        };
      }

      // Check if tool exists in registry
      if (!this.toolRegistry().hasTool(args.server, args.toolName)) {
        return {
          schema: {},
          error: {
            type: 'not_found',
            message: `Tool not found: ${args.server}:${args.toolName}. Call tool_list to see available tools.`,
          },
        };
      }

      // Try to get from cache first
      const cached = this.schemaCache.getIfCached(args.server, args.toolName);
      if (cached) {
        debugIf(() => ({ message: `Cache hit for tool schema: ${args.server}:${args.toolName}` }));
        return {
          schema: cached,
          fromCache: true,
        };
      }

      // Not in cache - load from server if SchemaLoader is available
      if (this.loadSchema) {
        try {
          debugIf(() => ({ message: `Loading schema from server: ${args.server}:${args.toolName}` }));

          // Resolve the clean server name to the actual connection key
          const connectionKey = this.resolveConnectionKey(args.server);
          const tool = await this.loadSchema(connectionKey, args.toolName);

          // Cache the loaded schema
          await this.schemaCache.preload([{ server: args.server, toolName: args.toolName }], async (s, t) => {
            if (s === args.server && t === args.toolName) {
              return tool;
            }
            throw new Error('Unexpected preload request');
          });

          return {
            schema: tool,
            fromCache: false,
          };
        } catch (loadError) {
          return {
            schema: {},
            error: {
              type: 'upstream',
              message: `Failed to load schema from server: ${loadError}`,
            },
          };
        }
      }

      // No SchemaLoader available - return error
      return {
        schema: {},
        error: {
          type: 'upstream',
          message:
            'Tool schema not loaded and no SchemaLoader available. Please use the tool invocation flow to load schema on first use.',
        },
      };
    } catch (error) {
      logger.error(`Error in tool_schema: ${error}`);
      return {
        schema: {},
        error: {
          type: 'upstream',
          message: `Error describing tool: ${error}`,
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
  private async callTool(args: CallToolArgs): Promise<CallToolResult> {
    try {
      // Validate arguments
      if (!args.server || !args.toolName) {
        return {
          result: {},
          server: args.server,
          tool: args.toolName,
          error: {
            type: 'validation',
            message: 'Validation Error: "server" and "toolName" are required parameters',
          },
        };
      }

      // Check if tool exists
      if (!this.toolRegistry().hasTool(args.server, args.toolName)) {
        return {
          result: {},
          server: args.server,
          tool: args.toolName,
          error: {
            type: 'not_found',
            message: `Tool not found: ${args.server}:${args.toolName}. Call tool_list to see available tools.`,
          },
        };
      }

      // Get connection - resolve clean server name to actual connection key
      const connectionKey = this.resolveConnectionKey(args.server);
      const connection = this.outboundConnections.get(connectionKey);
      if (!connection || !connection.client) {
        return {
          result: {},
          server: args.server,
          tool: args.toolName,
          error: {
            type: 'upstream',
            message: `Server not connected: ${args.server}`,
          },
        };
      }

      // Call the tool
      const upstreamResult = await connection.client.callTool({
        name: args.toolName,
        arguments: args.args as Record<string, unknown>,
      });

      // Return structured result matching outputSchema
      return {
        result: upstreamResult,
        server: args.server,
        tool: args.toolName,
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
