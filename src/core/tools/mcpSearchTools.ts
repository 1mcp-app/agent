import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolResult,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { handleSearchMCPServers, cleanupSearchHandler } from './handlers/searchHandler.js';
import { handleGetRegistryStatus, cleanupRegistryHandler } from './handlers/registryHandler.js';
import {
  SearchMCPServersArgsSchema,
  GetRegistryStatusArgsSchema,
  SearchMCPServersArgs,
  GetRegistryStatusArgs,
} from '../../utils/mcpToolSchemas.js';
// Remove unused import
import logger from '../../logger/logger.js';

/**
 * Available MCP search tools
 */
const SEARCH_TOOLS: Tool[] = [
  {
    name: 'search_mcp_servers',
    description:
      'Search for MCP servers in the official registry. Returns servers matching query with detailed package information.',
    inputSchema: SearchMCPServersArgsSchema,
  },
  {
    name: 'get_registry_status',
    description: 'Get MCP Registry availability status and optional statistics about server counts and distributions.',
    inputSchema: GetRegistryStatusArgsSchema,
  },
];

/**
 * Register MCP search tools with the server
 */
export function registerSearchTools(server: Server): void {
  logger.debug('Registering MCP search tools');

  // Register list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('Listing MCP search tools');
    return {
      tools: SEARCH_TOOLS,
    };
  });

  // Register call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    logger.debug(`Calling tool: ${name}`, args);

    try {
      let result: any;

      switch (name) {
        case 'search_mcp_servers':
          result = await handleSearchMCPServers(args as SearchMCPServersArgs);
          break;

        case 'get_registry_status':
          result = await handleGetRegistryStatus(args as GetRegistryStatusArgs);
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      const response: CallToolResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: false,
      };

      logger.debug(`Tool ${name} completed successfully`);
      return response;
    } catch (error) {
      logger.error(`Tool ${name} failed:`, error);

      const errorResponse: CallToolResult = {
        content: [
          {
            type: 'text',
            text: `Error calling ${name}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };

      return errorResponse;
    }
  });

  logger.info(`Registered ${SEARCH_TOOLS.length} MCP search tools`);
}

/**
 * Cleanup search tools resources
 */
export function cleanupSearchTools(): void {
  logger.debug('Cleaning up MCP search tools resources');

  cleanupSearchHandler();
  cleanupRegistryHandler();
}

/**
 * Get information about registered search tools
 */
export function getSearchToolsInfo(): { tools: Tool[]; count: number } {
  return {
    tools: SEARCH_TOOLS,
    count: SEARCH_TOOLS.length,
  };
}
