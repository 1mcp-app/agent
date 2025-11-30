/**
 * Installation tool handlers
 *
 * This module implements handlers for MCP server installation operations
 * including install, uninstall, and update functionality.
 */
import { FlagManager } from '@src/core/flags/flagManager.js';
import {
  handleInstallMCPServer,
  handleUninstallMCPServer,
  handleUpdateMCPServer,
} from '@src/core/tools/handlers/serverManagementHandler.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { McpInstallToolArgs, McpUninstallToolArgs, McpUpdateToolArgs } from './toolSchemas.js';

/**
 * Internal tool handler for installing MCP servers
 */
export async function handleMcpInstall(args: McpInstallToolArgs): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_install tool',
      meta: { args },
    }));

    // Check if installation tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('1mcpTools', 'installation', 'install')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Installation tools are disabled',
              message: 'MCP server installation is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      };
    }

    const result = await handleInstallMCPServer(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: true,
              message: `MCP server '${result.serverName}' installed successfully`,
              serverName: result.serverName,
              serverConfig: result.serverConfig,
              reloadRecommended: true,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_install tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `Installation failed: ${errorMessage}`,
          }),
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
    debugIf(() => ({
      message: 'Executing mcp_uninstall tool',
      meta: { args },
    }));

    // Check if installation tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('1mcpTools', 'installation', 'uninstall')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Installation tools are disabled',
              message: 'MCP server uninstallation is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      };
    }

    const result = await handleUninstallMCPServer(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: true,
              message: `MCP server '${result.serverName}' uninstalled successfully`,
              serverName: result.serverName,
              removed: result.removed,
              gracefulShutdown: args.graceful,
              reloadRecommended: true,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_uninstall tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `Uninstallation failed: ${errorMessage}`,
          }),
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
    debugIf(() => ({
      message: 'Executing mcp_update tool',
      meta: { args },
    }));

    // Check if installation tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('1mcpTools', 'installation', 'update')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Installation tools are disabled',
              message: 'MCP server updates are currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      };
    }

    const result = await handleUpdateMCPServer(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: true,
              message: `MCP server '${result.serverName}' updated successfully`,
              serverName: result.serverName,
              previousConfig: result.previousConfig,
              newConfig: result.newConfig,
              reloadRecommended: true,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_update tool handler', { error: errorMessage });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: errorMessage,
            message: `Update failed: ${errorMessage}`,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Cleanup function for installation handlers
 */
export function cleanupInstallationHandlers(): void {
  // No specific cleanup needed for installation handlers
  // This function exists for consistency with other handler modules
}
