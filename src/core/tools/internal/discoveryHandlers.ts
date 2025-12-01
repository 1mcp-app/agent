/**
 * Discovery tool handlers
 *
 * This module implements handlers for MCP discovery and information tools
 * including search, registry operations, and server information.
 */
import { AdapterFactory } from '@src/core/tools/internal/adapters/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import {
  McpInfoToolArgs,
  McpRegistryInfoToolArgs,
  McpRegistryListToolArgs,
  McpRegistryStatusToolArgs,
  McpSearchToolArgs,
} from './schemas/index.js';

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

    const adapter = AdapterFactory.getDiscoveryAdapter();
    const servers = await adapter.searchServers(args.query || '', {
      limit: args.limit,
      cursor: args.cursor,
      transport: args.transport as 'stdio' | 'sse' | 'webhook' | undefined,
      status: args.status as 'active' | 'archived' | 'deprecated' | 'all',
      registry_type: args.type as 'npm' | 'pypi' | 'docker',
    });

    // Transform to match expected format
    const result = {
      servers: servers.map((server) => ({
        ...server,
        registryId: 'official',
        lastUpdated: new Date().toISOString(),
      })),
      count: servers.length,
    };

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

    const adapter = AdapterFactory.getDiscoveryAdapter();
    const status = await adapter.getRegistryStatus(args.includeStats);

    // Transform to match expected format
    const registryStatus = {
      registry: args.registry || 'official',
      status: status.available ? 'online' : 'offline',
      responseTime: status.response_time_ms,
      lastCheck: status.last_updated,
      metadata: {
        version: '1.0.0',
        supportedFormats: ['json', 'table'],
        totalServers: status.stats?.total_servers || 0,
        ...status.stats,
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

    const adapter = AdapterFactory.getDiscoveryAdapter();
    const server = await adapter.getServerById(args.name, args.version);

    if (!server) {
      const serverInfo = {
        server: args.name || 'unknown',
        found: false,
        message: `Server '${args.name}' not found in registry`,
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(serverInfo, null, 2),
          },
        ],
      };
    }

    // Transform to match expected format
    const serverInfo = {
      server: args.name || 'unknown',
      found: true,
      info: {
        name: server.name,
        description: server.description || 'MCP server for various operations',
        version: server.version || '1.0.0',
        author: server._meta?.author || 'Server Author',
        license: server._meta?.license || 'MIT',
        homepage: server.websiteUrl || 'https://github.com/example/mcp-server',
        repository: server.repository?.url || 'https://github.com/example/mcp-server.git',
        tags: server._meta?.tags || ['mcp', 'server', 'tools'],
        capabilities: server._meta?.capabilities || {
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
        transport: server._meta?.transport || {
          stdio: true,
          sse: false,
          http: true,
        },
        requirements: server._meta?.requirements || {
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
  AdapterFactory.cleanup();
}
