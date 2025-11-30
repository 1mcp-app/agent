/**
 * Management tool handlers
 *
 * This module implements handlers for MCP server management operations
 * including enable/disable, list, status, and reload functionality.
 */
import { FlagManager } from '@src/core/flags/flagManager.js';
import {
  handleDisableMCPServer,
  handleEnableMCPServer,
  handleMcpList as handleMcpListBackend,
  handleReloadOperation,
  handleServerStatus,
} from '@src/core/tools/handlers/serverManagementHandler.js';
import logger, { debugIf } from '@src/logger/logger.js';

import {
  McpDisableToolArgs,
  McpEnableToolArgs,
  McpListToolArgs,
  McpReloadToolArgs,
  McpStatusToolArgs,
} from './toolSchemas.js';

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
    if (!flagManager.isToolEnabled('1mcpTools', 'management', 'enable')) {
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

    const result = await handleEnableMCPServer(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: true,
              message: `MCP server '${result.serverName}' enabled successfully`,
              serverName: result.serverName,
              enabled: result.enabled,
              restarted: result.restarted,
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
    if (!flagManager.isToolEnabled('1mcpTools', 'management', 'disable')) {
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

    const result = await handleDisableMCPServer(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: true,
              message: `MCP server '${result.serverName}' disabled successfully`,
              serverName: result.serverName,
              disabled: result.disabled,
              gracefulShutdown: result.gracefulShutdown,
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
    if (!flagManager.isToolEnabled('1mcpTools', 'management', 'list')) {
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

    const result = await handleMcpListBackend(args);

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
    if (!flagManager.isToolEnabled('1mcpTools', 'management', 'status')) {
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
    if (!flagManager.isToolEnabled('1mcpTools', 'management', 'reload')) {
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

    const result = await handleReloadOperation(args);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: true,
              message: `Reload completed successfully for ${result.target}`,
              target: result.target,
              action: result.action,
              timestamp: result.timestamp,
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
  // No specific cleanup needed for management handlers
  // This function exists for consistency with other handler modules
}
