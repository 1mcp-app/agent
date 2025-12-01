/**
 * Installation tool handlers
 *
 * This module implements handlers for MCP server installation operations
 * including install, uninstall, and update functionality.
 */
import { FlagManager } from '@src/core/flags/flagManager.js';
import { AdapterFactory } from '@src/core/tools/internal/adapters/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { McpInstallToolArgs, McpUninstallToolArgs, McpUpdateToolArgs } from './schemas/index.js';

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
    if (!flagManager.isToolEnabled('internalTools', 'installation', 'install')) {
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

    const adapter = AdapterFactory.getInstallationAdapter();
    const result = await adapter.installServer(args.name, args.version, {
      force: args.force,
      backup: args.backup,
      tags: args.tags,
      env: args.env,
      args: args.args,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: result.success,
              message: `MCP server '${result.serverName}' ${result.success ? 'installed' : 'installation failed'}${result.success ? ' successfully' : ''}`,
              serverName: result.serverName,
              version: result.version,
              installedAt: result.installedAt,
              configPath: result.configPath,
              backupPath: result.backupPath,
              warnings: result.warnings,
              errors: result.errors,
              operationId: result.operationId,
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
    if (!flagManager.isToolEnabled('internalTools', 'installation', 'uninstall')) {
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

    const adapter = AdapterFactory.getInstallationAdapter();
    const result = await adapter.uninstallServer(args.name, {
      force: args.force,
      backup: args.backup,
      removeAll: args.removeAll,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: result.success,
              message: `MCP server '${result.serverName}' ${result.success ? 'uninstalled' : 'uninstallation failed'}${result.success ? ' successfully' : ''}`,
              serverName: result.serverName,
              removed: result.success,
              removedAt: result.removedAt,
              configRemoved: result.configRemoved,
              gracefulShutdown: args.graceful,
              warnings: result.warnings,
              errors: result.errors,
              operationId: result.operationId,
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
    if (!flagManager.isToolEnabled('internalTools', 'installation', 'update')) {
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

    const adapter = AdapterFactory.getInstallationAdapter();
    const result = await adapter.updateServer(args.name, args.version, {
      force: args.force,
      backup: args.backup,
      dryRun: args.dryRun,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              success: result.success,
              message: `MCP server '${result.serverName}' ${result.success ? 'updated' : 'update failed'}${result.success ? ' successfully' : ''}`,
              serverName: result.serverName,
              previousVersion: result.previousVersion,
              newVersion: result.newVersion,
              updatedAt: result.updatedAt,
              warnings: result.warnings,
              errors: result.errors,
              operationId: result.operationId,
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
  AdapterFactory.cleanup();
}
