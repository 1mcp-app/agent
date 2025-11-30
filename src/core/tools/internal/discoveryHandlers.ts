/**
 * Discovery tool handlers
 *
 * This module implements handlers for MCP discovery and information tools
 * including search, registry operations, and server information.
 */
import {
  cleanupSearchHandler,
  handleSearchMCPServers,
  SearchMCPServersResult,
} from '@src/core/tools/handlers/searchHandler.js';
import logger, { debugIf } from '@src/logger/logger.js';

import {
  McpInfoToolArgs,
  McpRegistryInfoToolArgs,
  McpRegistryListToolArgs,
  McpRegistryStatusToolArgs,
  McpSearchToolArgs,
} from './toolSchemas.js';

/**
 * Internal tool handler for searching MCP registry
 */
export async function handleMcpSearch(args: McpSearchToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_search tool',
      meta: { args },
    }));

    const result: SearchMCPServersResult = await handleSearchMCPServers(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_search tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `Search failed: ${errorMessage}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for getting MCP registry status
 */
export async function handleMcpRegistryStatus(args: McpRegistryStatusToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_registry_status tool',
      meta: { args },
    }));

    // Mock registry status - in real implementation, this would check actual registry health
    const registryStatus = {
      registry: args.registry || 'official',
      status: 'online',
      responseTime: 125,
      lastCheck: new Date().toISOString(),
      metadata: {
        version: '1.0.0',
        supportedFormats: ['json', 'table'],
        totalServers: 150,
      },
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(registryStatus, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_registry_status tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `Registry status check failed: ${errorMessage}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for getting MCP registry information
 */
export async function handleMcpRegistryInfo(args: McpRegistryInfoToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_registry_info tool',
      meta: { args },
    }));

    // Mock registry info - in real implementation, this would get detailed registry information
    const registryInfo = {
      registry: args.registry || 'official',
      name: 'Official MCP Registry',
      description: 'The official Model Context Protocol server registry',
      version: '1.0.0',
      baseUrl: 'https://registry.modelcontextprotocol.io',
      api: {
        version: 'v1',
        endpoints: {
          search: '/servers/search',
          get: '/servers/{id}',
          list: '/servers',
        },
      },
      statistics: {
        totalServers: 150,
        categories: 12,
        activeMaintainers: 45,
        lastUpdated: new Date().toISOString(),
      },
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(registryInfo, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_registry_info tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `Registry info check failed: ${errorMessage}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for listing MCP registry contents
 */
export async function handleMcpRegistryList(args: McpRegistryListToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_registry_list tool',
      meta: { args },
    }));

    // Mock registry list - in real implementation, this would query the actual registry
    const registryList = {
      registries: [
        {
          id: 'official',
          name: 'Official MCP Registry',
          url: 'https://registry.modelcontextprotocol.io',
          description: 'The official Model Context Protocol server registry',
          status: 'online',
          serverCount: args.includeStats ? 150 : undefined,
          lastUpdated: args.includeStats ? new Date().toISOString() : undefined,
        },
        {
          id: 'community',
          name: 'Community Registry',
          url: 'https://community-registry.modelcontextprotocol.io',
          description: 'Community-contributed MCP servers',
          status: 'online',
          serverCount: args.includeStats ? 75 : undefined,
          lastUpdated: args.includeStats ? new Date().toISOString() : undefined,
        },
        {
          id: 'experimental',
          name: 'Experimental Registry',
          url: 'https://experimental-registry.modelcontextprotocol.io',
          description: 'Experimental and cutting-edge MCP servers',
          status: 'beta',
          serverCount: args.includeStats ? 25 : undefined,
          lastUpdated: args.includeStats ? new Date().toISOString() : undefined,
        },
      ],
      total: 3,
      includeStats: args.includeStats,
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(registryList, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_registry_list tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `Registry list failed: ${errorMessage}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for getting information about specific MCP servers
 */
export async function handleMcpInfo(args: McpInfoToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_info tool',
      meta: { args },
    }));

    // Mock server info - in real implementation, this would get detailed server information
    const serverInfo = {
      server: args.name || 'unknown',
      found: true,
      info: {
        name: args.name || 'Unknown Server',
        description: 'MCP server for various operations',
        version: '1.0.0',
        author: 'Server Author',
        license: 'MIT',
        homepage: 'https://github.com/example/mcp-server',
        repository: 'https://github.com/example/mcp-server.git',
        tags: ['mcp', 'server', 'tools'],
        capabilities: {
          tools: {
            count: 15,
            listChanged: true,
          },
          resources: {
            count: 8,
            subscribe: true,
            listChanged: true,
          },
          prompts: {
            count: 5,
            listChanged: false,
          },
        },
        transport: {
          stdio: true,
          sse: false,
          http: true,
        },
        requirements: {
          node: '>=16.0.0',
          platform: ['linux', 'darwin', 'win32'],
        },
      },
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(serverInfo, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_info tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `Server info check failed: ${errorMessage}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Cleanup function for discovery handlers
 */
export function cleanupDiscoveryHandlers(): void {
  cleanupSearchHandler();
}
