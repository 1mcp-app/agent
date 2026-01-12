import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { OutboundConnections } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { SchemaCache } from './schemaCache.js';
import { ToolMetadata, ToolRegistry } from './toolRegistry.js';

/**
 * Result of calling a meta-tool
 */
export interface MetaToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  _errorType?: 'validation' | 'upstream' | 'not_found';
  _meta?: Record<string, unknown>;
}

/**
 * Function to load tool schema from upstream server
 */
export type SchemaLoader = (server: string, toolName: string) => Promise<Tool>;

/**
 * Function to call a tool on upstream server
 */
export type ToolCaller = (server: string, toolName: string, args: unknown) => Promise<MetaToolResult>;

/**
 * Arguments for mcp_list_available_tools
 */
export interface ListAvailableToolsArgs {
  server?: string;
  pattern?: string;
  tag?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Arguments for mcp_describe_tool
 */
export interface DescribeToolArgs {
  server: string;
  toolName: string;
}

/**
 * Arguments for mcp_call_tool
 */
export interface CallToolArgs {
  server: string;
  toolName: string;
  args: unknown;
}

/**
 * MetaToolProvider provides three meta-tools for lazy loading:
 * 1. mcp_list_available_tools - List all tools (names + descriptions only)
 * 2. mcp_describe_tool - Get full tool schema on-demand
 * 3. mcp_call_tool - Invoke any tool by server and name
 *
 * @example
 * ```typescript
 * const provider = new MetaToolProvider(toolRegistry, schemaCache);
 * const tools = provider.getMetaTools();
 * const result = await provider.callMetaTool('mcp_list_available_tools', { server: 'filesystem' });
 * ```
 */
export class MetaToolProvider {
  private toolRegistry: ToolRegistry;
  private schemaCache: SchemaCache;
  private outboundConnections: OutboundConnections;

  constructor(toolRegistry: ToolRegistry, schemaCache: SchemaCache, outboundConnections: OutboundConnections) {
    this.toolRegistry = toolRegistry;
    this.schemaCache = schemaCache;
    this.outboundConnections = outboundConnections;
  }

  /**
   * Get the three meta-tools
   */
  public getMetaTools(): Tool[] {
    return [this.createListToolsMetaTool(), this.createDescribeToolMetaTool(), this.createCallToolMetaTool()];
  }

  /**
   * Call a meta-tool by name
   */
  public async callMetaTool(name: string, args: unknown): Promise<MetaToolResult> {
    switch (name) {
      case 'mcp_list_available_tools':
        return this.listAvailableTools(args as ListAvailableToolsArgs);
      case 'mcp_describe_tool':
        return this.describeTool(args as DescribeToolArgs);
      case 'mcp_call_tool':
        return this.callTool(args as CallToolArgs);
      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown meta-tool: ${name}. Valid meta-tools are: mcp_list_available_tools, mcp_describe_tool, mcp_call_tool`,
            },
          ],
          isError: true,
          _errorType: 'not_found',
        };
    }
  }

  /**
   * Create the mcp_list_available_tools meta-tool
   */
  private createListToolsMetaTool(): Tool {
    return {
      name: 'mcp_list_available_tools',
      description:
        'List all available MCP tools from all connected servers. Returns tool names with their source server for identification. Use mcp_describe_tool to get full input schema for a specific tool.',
      inputSchema: {
        type: 'object',
        properties: {
          server: {
            type: 'string',
            description: 'Optional: filter by server name',
          },
          pattern: {
            type: 'string',
            description: 'Optional: filter by tool name pattern (supports wildcards like *file*)',
          },
          tag: {
            type: 'string',
            description: 'Optional: filter by server tag',
          },
          limit: {
            type: 'number',
            description: 'Optional: maximum number of tools to return (default: 1000, max: 5000)',
          },
          cursor: {
            type: 'string',
            description: 'Optional: pagination cursor from previous response',
          },
        },
      },
    };
  }

  /**
   * Implement mcp_list_available_tools
   */
  private async listAvailableTools(args: ListAvailableToolsArgs): Promise<MetaToolResult> {
    try {
      const result = this.toolRegistry.listTools(args);

      // Format tools for response
      const tools = result.tools.map((tool: ToolMetadata) => ({
        name: tool.name,
        server: tool.server,
        description: tool.description,
        tags: tool.tags,
      }));

      const servers = this.toolRegistry.getServers();

      let responseText = `Found ${result.totalCount} tools from ${servers.length} servers:\n\n`;
      responseText += `Servers: ${servers.join(', ')}\n\n`;
      responseText += `Tools:\n`;

      for (const tool of tools) {
        responseText += `- ${tool.server}:${tool.name} - ${tool.description}\n`;
      }

      if (result.hasMore) {
        responseText += `\nMore tools available. Use cursor: ${result.nextCursor}`;
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
        _meta: {
          tools,
          totalCount: result.totalCount,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
          servers,
        },
      };
    } catch (error) {
      logger.error(`Error in mcp_list_available_tools: ${error}`);
      return {
        content: [
          {
            type: 'text',
            text: `Error listing tools: ${error}`,
          },
        ],
        isError: true,
        _errorType: 'upstream',
      };
    }
  }

  /**
   * Create the mcp_describe_tool meta-tool
   */
  private createDescribeToolMetaTool(): Tool {
    return {
      name: 'mcp_describe_tool',
      description:
        'Get the complete definition of a specific tool including its input schema. Call this before invoking a tool to understand required parameters.',
      inputSchema: {
        type: 'object',
        required: ['server', 'toolName'],
        properties: {
          server: {
            type: 'string',
            description: 'The server name that provides the tool',
          },
          toolName: {
            type: 'string',
            description: 'The exact name of the tool (from mcp_list_available_tools)',
          },
        },
      },
    };
  }

  /**
   * Implement mcp_describe_tool
   */
  private async describeTool(args: DescribeToolArgs): Promise<MetaToolResult> {
    try {
      // Validate arguments
      if (!args.server || !args.toolName) {
        return {
          content: [
            {
              type: 'text',
              text: 'Validation Error: "server" and "toolName" are required parameters',
            },
          ],
          isError: true,
          _errorType: 'validation',
        };
      }

      // Check if tool exists in registry
      if (!this.toolRegistry.hasTool(args.server, args.toolName)) {
        return {
          content: [
            {
              type: 'text',
              text: `Tool not found: ${args.server}:${args.toolName}. Call mcp_list_available_tools to see available tools.`,
            },
          ],
          isError: true,
          _errorType: 'not_found',
        };
      }

      // Try to get from cache first
      const cached = this.schemaCache.getIfCached(args.server, args.toolName);
      if (cached) {
        debugIf(() => ({ message: `Cache hit for tool schema: ${args.server}:${args.toolName}` }));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(cached, null, 2),
            },
          ],
          _meta: { fromCache: true },
        };
      }

      // Not in cache - need to load from server
      // This is handled by the LazyLoadingOrchestrator which provides the loader
      return {
        content: [
          {
            type: 'text',
            text: `Tool schema not loaded. Please use the tool invocation flow to load schema on first use.`,
          },
        ],
        isError: true,
        _errorType: 'upstream',
      };
    } catch (error) {
      logger.error(`Error in mcp_describe_tool: ${error}`);
      return {
        content: [
          {
            type: 'text',
            text: `Error describing tool: ${error}`,
          },
        ],
        isError: true,
        _errorType: 'upstream',
      };
    }
  }

  /**
   * Create the mcp_call_tool meta-tool
   */
  private createCallToolMetaTool(): Tool {
    return {
      name: 'mcp_call_tool',
      description:
        'Invoke any available MCP tool by server and name. Use mcp_describe_tool first to get the input schema, then call this with the required arguments.',
      inputSchema: {
        type: 'object',
        required: ['server', 'toolName', 'args'],
        properties: {
          server: {
            type: 'string',
            description: 'The server name that provides the tool',
          },
          toolName: {
            type: 'string',
            description: 'The exact name of the tool to invoke',
          },
          args: {
            description: "Arguments object matching the tool's input schema",
          },
        },
      },
    };
  }

  /**
   * Implement mcp_call_tool
   */
  private async callTool(args: CallToolArgs): Promise<MetaToolResult> {
    try {
      // Validate arguments
      if (!args.server || !args.toolName) {
        return {
          content: [
            {
              type: 'text',
              text: 'Validation Error: "server" and "toolName" are required parameters',
            },
          ],
          isError: true,
          _errorType: 'validation',
        };
      }

      // Check if tool exists
      if (!this.toolRegistry.hasTool(args.server, args.toolName)) {
        return {
          content: [
            {
              type: 'text',
              text: `Tool not found: ${args.server}:${args.toolName}. Call mcp_list_available_tools to see available tools.`,
            },
          ],
          isError: true,
          _errorType: 'not_found',
        };
      }

      // Get connection
      const connection = this.outboundConnections.get(args.server);
      if (!connection || !connection.client) {
        return {
          content: [
            {
              type: 'text',
              text: `Server not connected: ${args.server}`,
            },
          ],
          isError: true,
          _errorType: 'upstream',
        };
      }

      // Call the tool
      const result = await connection.client.callTool({
        name: args.toolName,
        arguments: args.args as Record<string, unknown>,
      });

      return result as MetaToolResult;
    } catch (error) {
      logger.error(`Error in mcp_call_tool: ${error}`);

      // Check if it's a tool not found error from upstream
      if (error instanceof Error && error.message.includes('not found')) {
        return {
          content: [
            {
              type: 'text',
              text: `Tool not found: ${args.server}:${args.toolName}`,
            },
          ],
          isError: true,
          _errorType: 'not_found',
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Server Error: ${error}. This is an upstream server issue - please report it.`,
          },
        ],
        isError: true,
        _errorType: 'upstream',
      };
    }
  }
}
