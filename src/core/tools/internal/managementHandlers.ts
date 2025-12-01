/**
 * Management tool handlers
 *
 * This module implements handlers for MCP server management operations
 * including enable/disable, list, status, and reload functionality.
 */
import { FlagManager } from '@src/core/flags/flagManager.js';
import { AdapterFactory } from '@src/core/tools/internal/adapters/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import {
  McpDisableToolArgs,
  McpEnableToolArgs,
  McpListToolArgs,
  McpReloadToolArgs,
  McpStatusToolArgs,
} from './schemas/index.js';

/**
 * Internal tool handler for enabling MCP servers
 */
export async function handleMcpEnable(args: McpEnableToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_enable tool',
      meta: { args },
    }));

    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'management', 'enable')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Management tools are disabled',
              message: 'MCP server management is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      };
    }

    const adapter = AdapterFactory.getManagementAdapter();
    const result = await adapter.enableServer(args.name, {
      restart: args.restart,
      tags: args.tags,
      graceful: args.graceful,
      timeout: args.timeout,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: result.success,
              message: `MCP server '${result.serverName}' ${result.success ? 'enabled' : 'enable failed'}${result.success ? ' successfully' : ''}`,
              serverName: result.serverName,
              enabled: result.enabled,
              restarted: result.restarted,
              warnings: result.warnings,
              errors: result.errors,
              reloadRecommended: result.success,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_enable tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `Enable operation failed: ${errorMessage}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for disabling MCP servers
 */
export async function handleMcpDisable(args: McpDisableToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_disable tool',
      meta: { args },
    }));

    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'management', 'disable')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Management tools are disabled',
              message: 'MCP server management is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      };
    }

    const adapter = AdapterFactory.getManagementAdapter();
    const result = await adapter.disableServer(args.name, {
      graceful: args.graceful,
      timeout: args.timeout,
      tags: args.tags,
      force: args.force,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: result.success,
              message: `MCP server '${result.serverName}' ${result.success ? 'disabled' : 'disable failed'}${result.success ? ' successfully' : ''}`,
              serverName: result.serverName,
              disabled: result.disabled,
              gracefulShutdown: result.gracefulShutdown,
              warnings: result.warnings,
              errors: result.errors,
              reloadRecommended: result.success,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_disable tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `Disable operation failed: ${errorMessage}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for listing MCP servers
 */
export async function handleMcpList(args: McpListToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_list tool',
      meta: { args },
    }));

    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'management', 'list')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Management tools are disabled',
              message: 'MCP server management is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      };
    }

    const adapter = AdapterFactory.getManagementAdapter();
    const servers = await adapter.listServers({
      status: args.status as 'enabled' | 'disabled' | 'all',
      transport: args.transport as 'stdio' | 'sse' | 'http',
      detailed: args.detailed,
      tags: args.tags,
    });

    // Transform to match expected format
    const result = {
      servers: servers.map((server) => ({
        name: server.name,
        ...server.config,
        status: server.status,
        transport: server.transport,
        url: server.url,
        healthStatus: server.healthStatus,
        lastChecked: server.lastChecked,
        metadata: server.metadata,
      })),
      total: servers.length,
      count: servers.length, // Keep for backward compatibility
      timestamp: new Date().toISOString(),
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
    logger.error('Error in mcp_list tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `List operation failed: ${errorMessage}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for getting MCP server status
 */
export async function handleMcpStatus(args: McpStatusToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_status tool',
      meta: { args },
    }));

    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'management', 'status')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Management tools are disabled',
              message: 'MCP server management is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      };
    }

    const adapter = AdapterFactory.getManagementAdapter();
    const result = await adapter.getServerStatus(args.name);

    // Transform result for single server queries
    let transformedResult = result;
    if (args.name && result.servers && result.servers.length > 0) {
      const server = result.servers.find((s) => s.name === args.name);
      if (server) {
        transformedResult = {
          servers: [server],
          totalServers: 1,
          enabledServers: server.status === 'enabled' ? 1 : 0,
          disabledServers: server.status === 'disabled' ? 1 : 0,
          unhealthyServers: server.healthStatus === 'unhealthy' ? 1 : 0,
          timestamp: result.timestamp,
        };
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(transformedResult, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_status tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `Status operation failed: ${errorMessage}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for reloading MCP configuration
 */
export async function handleMcpReload(args: McpReloadToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_reload tool',
      meta: { args },
    }));

    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'management', 'reload')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Management tools are disabled',
              message: 'MCP server management is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      };
    }

    const adapter = AdapterFactory.getManagementAdapter();
    const result = await adapter.reloadConfiguration({
      server: args.server,
      configOnly: args.configOnly,
      force: args.force,
      timeout: args.timeout,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: result.success,
              message: `Reload ${result.success ? 'completed' : 'failed'} ${result.success ? 'successfully' : ''} for ${result.target}`,
              target: result.target,
              action: result.action,
              timestamp: result.timestamp,
              reloadedServers: result.reloadedServers,
              warnings: result.warnings,
              errors: result.errors,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_reload tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `Reload operation failed: ${errorMessage}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Cleanup function for management handlers
 */
export function cleanupManagementHandlers(): void {
  AdapterFactory.cleanup();
}
