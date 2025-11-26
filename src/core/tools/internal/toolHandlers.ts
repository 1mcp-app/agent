/**
 * Internal MCP tool handlers
 *
 * This module implements the actual logic for internal MCP management tools.
 * Each handler wraps existing CLI functionality to provide MCP tool access.
 */
import { FlagManager } from '@src/core/flags/flagManager.js';
import {
  cleanupSearchHandler,
  handleSearchMCPServers,
  SearchMCPServersResult,
} from '@src/core/tools/handlers/searchHandler.js';
import {
  handleDisableMCPServer,
  handleEnableMCPServer,
  handleInstallMCPServer,
  handleMcpList as handleMcpListBackend,
  handleReloadOperation,
  handleServerStatus,
  handleUninstallMCPServer,
  handleUpdateMCPServer,
} from '@src/core/tools/handlers/serverManagementHandler.js';
import logger, { debugIf } from '@src/logger/logger.js';

import {
  McpDisableToolArgs,
  McpEnableToolArgs,
  McpInstallToolArgs,
  McpListToolArgs,
  McpReloadToolArgs,
  McpSearchToolArgs,
  McpStatusToolArgs,
  McpUninstallToolArgs,
  McpUpdateToolArgs,
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

    const output = {
      servers: result.servers.map((server) => ({
        name: server.name,
        description: server.description,
        version: server.version,
        registryId: server.registryId,
        lastUpdated: server.lastUpdated,
        status: server.status,
      })),
      next_cursor: result.next_cursor,
      count: result.count,
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(output, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error('Error in mcp_search tool:', error);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: 'Search failed',
              message: error instanceof Error ? error.message : 'Unknown error',
              args,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for installing MCP servers
 */
export async function handleMcpInstall(args: McpInstallToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    // Check if installation tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('1mcpTools', 'installation', 'install')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: 'Installation tools are disabled',
                message: 'Enable installation tools with --enable-installation-tools flag',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    debugIf(() => ({
      message: 'Executing mcp_install tool',
      meta: { args },
    }));

    const result = await handleInstallMCPServer(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: true,
              message: `MCP server '${args.name}' installed successfully`,
              server: result,
              reloadRecommended: true,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Error in mcp_install tool:', error);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: 'Installation failed',
              message: error instanceof Error ? error.message : 'Unknown error',
              args,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for uninstalling MCP servers
 */
export async function handleMcpUninstall(args: McpUninstallToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    // Check if installation tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('1mcpTools', 'installation', 'uninstall')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: 'Installation tools are disabled',
                message: 'Enable installation tools with --enable-installation-tools flag',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    debugIf(() => ({
      message: 'Executing mcp_uninstall tool',
      meta: { args },
    }));

    const result = await handleUninstallMCPServer(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: true,
              message: `MCP server '${args.name}' uninstalled successfully`,
              result,
              reloadRecommended: true,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Error in mcp_uninstall tool:', error);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: 'Uninstallation failed',
              message: error instanceof Error ? error.message : 'Unknown error',
              args,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for updating MCP servers
 */
export async function handleMcpUpdate(args: McpUpdateToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    // Check if installation tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('1mcpTools', 'installation', 'update')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: 'Installation tools are disabled',
                message: 'Enable installation tools with --enable-installation-tools flag',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    debugIf(() => ({
      message: 'Executing mcp_update tool',
      meta: { args },
    }));

    const result = await handleUpdateMCPServer(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: true,
              message: `MCP server '${args.name}' updated successfully`,
              result,
              reloadRecommended: true,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Error in mcp_update tool:', error);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: 'Update failed',
              message: error instanceof Error ? error.message : 'Unknown error',
              args,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for enabling MCP servers
 */
export async function handleMcpEnable(args: McpEnableToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('1mcpTools', 'management', 'enable')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: 'Management tools are disabled',
                message: 'Enable management tools with --enable-management-tools flag',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    debugIf(() => ({
      message: 'Executing mcp_enable tool',
      meta: { args },
    }));

    const result = await handleEnableMCPServer(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: true,
              message: `MCP server '${args.name}' enabled successfully`,
              result,
              reloadRecommended: true,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Error in mcp_enable tool:', error);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: 'Enable operation failed',
              message: error instanceof Error ? error.message : 'Unknown error',
              args,
            },
            null,
            2,
          ),
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
    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('1mcpTools', 'management', 'disable')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: 'Management tools are disabled',
                message: 'Enable management tools with --enable-management-tools flag',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    debugIf(() => ({
      message: 'Executing mcp_disable tool',
      meta: { args },
    }));

    const result = await handleDisableMCPServer(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: true,
              message: `MCP server '${args.name}' disabled successfully`,
              result,
              reloadRecommended: true,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Error in mcp_disable tool:', error);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: 'Disable operation failed',
              message: error instanceof Error ? error.message : 'Unknown error',
              args,
            },
            null,
            2,
          ),
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
    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('1mcpTools', 'management', 'list')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: 'Management tools are disabled',
                message: 'Enable management tools with --enable-management-tools flag',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    debugIf(() => ({
      message: 'Executing mcp_list tool',
      meta: { args },
    }));

    const result = await handleMcpListBackend(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              servers: (result as { servers: unknown[] }).servers,
              count: (result as { servers: unknown[] }).servers?.length || 0,
              filters: args,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Error in mcp_list tool:', error);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: 'List operation failed',
              message: error instanceof Error ? error.message : 'Unknown error',
              args,
            },
            null,
            2,
          ),
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
    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('1mcpTools', 'management', 'status')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: 'Management tools are disabled',
                message: 'Enable management tools with --enable-management-tools flag',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    debugIf(() => ({
      message: 'Executing mcp_status tool',
      meta: { args },
    }));

    const result = await handleServerStatus(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              timestamp: new Date().toISOString(),
              ...result,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Error in mcp_status tool:', error);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: 'Status operation failed',
              message: error instanceof Error ? error.message : 'Unknown error',
              args,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Internal tool handler for reloading MCP servers or configuration
 */
export async function handleMcpReload(args: McpReloadToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('1mcpTools', 'management', 'reload')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: 'Management tools are disabled',
                message: 'Enable management tools with --enable-management-tools flag',
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    debugIf(() => ({
      message: 'Executing mcp_reload tool',
      meta: { args },
    }));

    const result = await handleReloadOperation(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: true,
              message: `Reload operation completed successfully`,
              result,
              timestamp: new Date().toISOString(),
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Error in mcp_reload tool:', error);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: 'Reload operation failed',
              message: error instanceof Error ? error.message : 'Unknown error',
              args,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Cleanup function for internal tool handlers
 */
export function cleanupInternalToolHandlers(): void {
  cleanupSearchHandler();
}
