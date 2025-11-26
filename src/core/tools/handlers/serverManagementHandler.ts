/**
 * Server management tool handlers
 *
 * This module implements handlers for MCP server management operations
 * including install, uninstall, update, enable, disable, list, status, and reload.
 */
import {
  initializeConfigContext,
  loadConfig,
  removeServer,
  saveConfig,
  setServer,
} from '@src/commands/mcp/utils/configUtils.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { ClientManager } from '@src/core/client/clientManager.js';
import { SelectiveReloadManager } from '@src/core/reload/selectiveReloadManager.js';
import {
  McpDisableToolArgs,
  McpEnableToolArgs,
  McpInstallToolArgs,
  McpListToolArgs,
  McpReloadToolArgs,
  McpStatusToolArgs,
  McpUninstallToolArgs,
  McpUpdateToolArgs,
} from '@src/core/tools/internal/toolSchemas.js';
import { MCPServerParams } from '@src/core/types/transport.js';
import { debugIf } from '@src/logger/logger.js';
import logger from '@src/logger/logger.js';
import { createTransports } from '@src/transport/transportFactory.js';

/**
 * Helper function to initialize config context
 */
function initializeConfig() {
  // Use default config context
  initializeConfigContext();
}

/**
 * Handler for installing MCP servers
 */
export async function handleInstallMCPServer(args: McpInstallToolArgs) {
  initializeConfig();

  // Build server configuration
  const serverConfig: MCPServerParams = {
    type: args.transport || 'stdio',
    disabled: !args.enabled,
  };

  if (args.transport === 'stdio' && args.command) {
    serverConfig.command = args.command;
    if (args.args) {
      serverConfig.args = args.args;
    }
  } else if ((args.transport === 'sse' || args.transport === 'http') && args.url) {
    serverConfig.url = args.url;
  }

  if (args.tags) {
    serverConfig.tags = args.tags;
  }

  if (args.autoRestart) {
    serverConfig.restartOnExit = args.autoRestart;
  }

  // Add server to configuration
  setServer(args.name, serverConfig);

  debugIf(() => ({
    message: 'MCP server added to configuration',
    meta: { serverName: args.name, config: serverConfig },
  }));

  return {
    serverName: args.name,
    serverConfig,
    success: true,
  };
}

/**
 * Handler for uninstalling MCP servers
 */
export async function handleUninstallMCPServer(args: McpUninstallToolArgs) {
  initializeConfig();

  // Load current configuration
  const config = loadConfig();

  if (!(args.name in config.mcpServers)) {
    throw new Error(`Server '${args.name}' not found`);
  }

  // Remove server from configuration
  removeServer(args.name);

  debugIf(() => ({
    message: 'MCP server removed from configuration',
    meta: { serverName: args.name },
  }));

  return {
    serverName: args.name,
    removed: true,
    success: true,
  };
}

/**
 * Handler for updating MCP servers
 */
export async function handleUpdateMCPServer(args: McpUpdateToolArgs) {
  initializeConfig();

  // Load current configuration
  const config = loadConfig();

  if (!(args.name in config.mcpServers)) {
    throw new Error(`Server '${args.name}' not found`);
  }

  const currentConfig = config.mcpServers[args.name];

  // Update server configuration (for now, just handle restartOnExit)
  if (args.autoRestart !== undefined) {
    config.mcpServers[args.name].restartOnExit = args.autoRestart;
    saveConfig(config);
  }

  debugIf(() => ({
    message: 'MCP server configuration updated',
    meta: { serverName: args.name, updates: args },
  }));

  return {
    serverName: args.name,
    previousConfig: currentConfig,
    newConfig: config.mcpServers[args.name],
    success: true,
  };
}

/**
 * Handler for enabling MCP servers
 */
export async function handleEnableMCPServer(args: McpEnableToolArgs) {
  initializeConfig();

  // Load current configuration
  const config = loadConfig();

  if (!(args.name in config.mcpServers)) {
    throw new Error(`Server '${args.name}' not found`);
  }

  // Enable server
  config.mcpServers[args.name].disabled = false;
  saveConfig(config);

  debugIf(() => ({
    message: 'MCP server enabled',
    meta: { serverName: args.name, restart: args.restart },
  }));

  return {
    serverName: args.name,
    enabled: true,
    restarted: args.restart,
    success: true,
  };
}

/**
 * Handler for disabling MCP servers
 */
export async function handleDisableMCPServer(args: McpDisableToolArgs) {
  initializeConfig();

  // Load current configuration
  const config = loadConfig();

  if (!(args.name in config.mcpServers)) {
    throw new Error(`Server '${args.name}' not found`);
  }

  // Disable server
  config.mcpServers[args.name].disabled = true;
  saveConfig(config);

  debugIf(() => ({
    message: 'MCP server disabled',
    meta: { serverName: args.name, graceful: args.graceful },
  }));

  return {
    serverName: args.name,
    disabled: true,
    gracefulShutdown: args.graceful,
    success: true,
  };
}

/**
 * Handler for listing MCP servers
 */
export async function handleMcpList(args: McpListToolArgs) {
  initializeConfig();

  // Load configuration
  const config = loadConfig();
  const servers = Object.entries(config.mcpServers);

  // Apply filters
  let filteredServers = servers.filter(([_, server]) => {
    if (args.status !== 'all') {
      const isDisabled = server.disabled;
      switch (args.status) {
        case 'enabled':
          return !isDisabled;
        case 'disabled':
          return isDisabled;
        default:
          return true;
      }
    }
    return true;
  });

  // Add status information
  const serversWithStatus = filteredServers.map(([name, server]: [string, MCPServerParams]) => ({
    name,
    ...server,
    status: server.disabled ? 'disabled' : 'enabled',
    configured: true,
  }));

  return {
    servers: serversWithStatus,
    total: servers.length,
    filtered: serversWithStatus.length,
    filters: args,
  };
}

/**
 * Handler for getting MCP server status
 */
export async function handleServerStatus(args: McpStatusToolArgs) {
  initializeConfig();

  // Load configuration
  const config = loadConfig();

  if (args.name) {
    // Get status for specific server
    if (!(args.name in config.mcpServers)) {
      throw new Error(`Server '${args.name}' not found`);
    }

    const server = config.mcpServers[args.name];

    return {
      server: {
        name: args.name,
        ...server,
        status: server.disabled ? 'disabled' : 'enabled',
        configured: true,
      },
    };
  } else {
    // Get status for all servers
    const servers = Object.entries(config.mcpServers);
    const serversWithStatus = servers.map(([name, server]: [string, MCPServerParams]) => ({
      name,
      ...server,
      status: server.disabled ? 'disabled' : 'enabled',
      configured: true,
    }));

    return {
      servers: serversWithStatus,
      summary: {
        total: servers.length,
        enabled: servers.filter(([_, server]) => !server.disabled).length,
        disabled: servers.filter(([_, server]) => server.disabled).length,
      },
    };
  }
}

/**
 * Handler for reload operations
 */
export async function handleReloadOperation(args: McpReloadToolArgs) {
  debugIf(() => ({
    message: 'Reload operation requested',
    meta: { args },
  }));

  const reloadManager = SelectiveReloadManager.getInstance();
  const configManager = McpConfigManager.getInstance();

  switch (args.target) {
    case 'config': {
      // Get current config (before reload)
      const oldConfig = configManager.getTransportConfig();

      // Force reload from disk
      configManager.reloadConfig();

      // Get new config
      const newConfig = configManager.getTransportConfig();

      // Execute selective reload
      const operation = await reloadManager.executeReload(oldConfig, newConfig);

      return {
        target: 'config',
        action: 'reloaded',
        timestamp: new Date().toISOString(),
        success: operation.status === 'completed',
        details: {
          operationId: operation.id,
          changes: operation.impact.summary.totalChanges,
          affectedServers: operation.affectedServers,
          status: operation.status,
          error: operation.error,
        },
      };
    }

    case 'server': {
      if (!args.name) {
        throw new Error('Server name is required when target is "server"');
      }

      logger.info(`Restarting server: ${args.name}`);
      const clientManager = ClientManager.current;

      try {
        // 1. Remove existing client
        await clientManager.removeClient(args.name);

        // 2. Re-create client from current config
        const config = configManager.getTransportConfig();
        const serverConfig = config[args.name];

        if (!serverConfig) {
          throw new Error(`Server ${args.name} not found in configuration`);
        }

        const transportMap = createTransports({ [args.name]: serverConfig });
        const transport = transportMap[args.name];

        if (transport) {
          await clientManager.createSingleClient(args.name, transport);
        } else {
          throw new Error(`Failed to create transport for ${args.name}`);
        }

        return {
          target: 'server',
          serverName: args.name,
          action: 'reloaded',
          timestamp: new Date().toISOString(),
          success: true,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to restart server ${args.name}: ${errorMessage}`);
        return {
          target: 'server',
          serverName: args.name,
          action: 'failed',
          timestamp: new Date().toISOString(),
          success: false,
          error: errorMessage,
        };
      }
    }

    case 'all': {
      // Get current config
      const oldConfig = configManager.getTransportConfig();

      // Force reload from disk
      configManager.reloadConfig();

      // Get new config
      const newConfig = configManager.getTransportConfig();

      // Force full reload
      const operation = await reloadManager.executeReload(oldConfig, newConfig, { forceFullReload: true });

      return {
        target: 'all',
        action: 'reloaded',
        timestamp: new Date().toISOString(),
        success: operation.status === 'completed',
        details: {
          operationId: operation.id,
          status: operation.status,
          error: operation.error,
        },
      };
    }

    default:
      throw new Error(`Invalid reload target: ${args.target}`);
  }
}
