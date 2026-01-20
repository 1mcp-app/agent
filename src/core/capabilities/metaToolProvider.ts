import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { OutboundConnections } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { zodToInputSchema, zodToOutputSchema } from '@src/utils/schemaUtils.js';

import { z } from 'zod';

import { SchemaCache } from './schemaCache.js';
import { ToolMetadata, ToolRegistry } from './toolRegistry.js';

/**
 * Zod schemas for meta-tool inputs
 */

const ToolListInputSchema = z.object({
  server: z.string().optional(),
  pattern: z.string().optional(),
  tag: z.string().optional(),
  limit: z.number().optional(),
});

const ToolSchemaInputSchema = z.object({
  server: z.string(),
  toolName: z.string(),
});

const ToolInvokeInputSchema = z.object({
  server: z.string(),
  toolName: z.string(),
  args: z.object({}).loose(),
});

/**
 * Zod schemas for meta-tool outputs
 */

const ToolMetadataSchema = z.object({
  name: z.string(),
  server: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
});

const ToolListOutputSchema = z.object({
  tools: z.array(ToolMetadataSchema),
  totalCount: z.number(),
  servers: z.array(z.string()),
  hasMore: z.boolean(),
  nextCursor: z.string().optional(),
  error: z
    .object({
      type: z.enum(['validation', 'upstream', 'not_found']),
      message: z.string(),
    })
    .optional(),
});

const ToolSchemaOutputSchema = z.object({
  schema: z.object({}).loose(), // The full Tool schema
  fromCache: z.boolean().optional(),
  error: z
    .object({
      type: z.enum(['validation', 'upstream', 'not_found']),
      message: z.string(),
    })
    .optional(),
});

const ToolInvokeOutputSchema = z.object({
  result: z.object({}).loose(), // The upstream tool result
  server: z.string(),
  tool: z.string(),
  error: z
    .object({
      type: z.enum(['validation', 'upstream', 'not_found']),
      message: z.string(),
    })
    .optional(),
});

/**
 * Result types for meta-tools
 */
export type ListToolsResult = z.infer<typeof ToolListOutputSchema>;
export type DescribeToolResult = z.infer<typeof ToolSchemaOutputSchema>;
export type CallToolResult = z.infer<typeof ToolInvokeOutputSchema>;

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

  constructor(
    getToolRegistry: ToolRegistryProvider,
    schemaCache: SchemaCache,
    outboundConnections: OutboundConnections,
    loadSchema?: SchemaLoader,
  ) {
    this.getToolRegistry = getToolRegistry;
    this.schemaCache = schemaCache;
    this.outboundConnections = outboundConnections;
    this.loadSchema = loadSchema;
  }

  /**
   * Get the current tool registry
   */
  private toolRegistry(): ToolRegistry {
    return this.getToolRegistry();
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
      case 'tool_list':
        return this.listAvailableTools(args as ListAvailableToolsArgs);
      case 'tool_schema':
        return this.describeTool(args as DescribeToolArgs);
      case 'tool_invoke':
        return this.callTool(args as CallToolArgs);
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
      debugIf(() => ({
        message: `tool_list called, registry size: ${registry.size()}`,
        meta: { registrySize: registry.size() },
      }));
      const result = registry.listTools(args);

      // Format tools for response
      const tools = result.tools.map((tool: ToolMetadata) => ({
        name: tool.name,
        server: tool.server,
        description: tool.description,
        tags: tool.tags,
      }));

      const servers = registry.getServers();

      // Return structured result matching outputSchema
      return {
        tools,
        totalCount: result.totalCount,
        servers,
        hasMore: result.hasMore,
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };
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
          const tool = await this.loadSchema(args.server, args.toolName);

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

      // Get connection
      const connection = this.outboundConnections.get(args.server);
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
