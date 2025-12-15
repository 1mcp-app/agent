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
} from '@src/commands/mcp/utils/mcpServerConfig.js';
import { ConfigManager } from '@src/config/configManager.js';
import { ClientManager } from '@src/core/client/clientManager.js';
import {
  McpDisableToolArgs,
  McpEnableToolArgs,
  McpInstallToolArgs,
  McpListToolArgs,
  McpReloadToolArgs,
  McpStatusToolArgs,
  McpUninstallToolArgs,
  McpUpdateToolArgs,
} from '@src/core/tools/internal/schemas/index.js';
import { MCPServerParams } from '@src/core/types/transport.js';
import { debugIf } from '@src/logger/logger.js';
import logger from '@src/logger/logger.js';
import { TemplateDetector } from '@src/template/templateDetector.js';
import { createTransports } from '@src/transport/transportFactory.js';

/**
 * Enhanced server information interface for mcp_list
 */
interface EnhancedServerInfo extends Omit<MCPServerParams, 'env'> {
  name: string;
  status: 'enabled' | 'disabled' | 'running' | 'stopped';
  configured: boolean;
  env?: Record<string, string>;
  capabilities?: {
    tools: string;
    resources: string;
    prompts: string;
  };
  health?: {
    connected: boolean;
    lastConnected: string | null;
    responseTime: number | null;
  };
}

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

  // Validate that no templates are used in static server configuration
  const templateValidation = TemplateDetector.validateTemplateFree(serverConfig);
  if (!templateValidation.valid) {
    const errorMessage =
      `Template syntax detected in server configuration. Templates are not allowed in mcpServers section. ` +
      `Found templates: ${templateValidation.templates.join(', ')}. ` +
      `Locations: ${templateValidation.locations.join(', ')}. ` +
      `Please move template-based servers to the mcpTemplates section in your configuration.`;

    logger.error(errorMessage);
    throw new Error(errorMessage);
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
  let filteredServers = servers.filter(([, server]) => {
    // Status filter
    if (args.status !== 'all') {
      const isDisabled = server.disabled;
      switch (args.status) {
        case 'enabled':
          return !isDisabled;
        case 'disabled':
          return isDisabled;
        case 'running':
        case 'stopped':
          // For now, base on disabled status - could be enhanced with actual runtime status
          return args.status === 'running' ? !isDisabled : isDisabled;
        default:
          return true;
      }
    }

    // Transport filter
    if (args.transport && server.type !== args.transport) {
      return false;
    }

    // Tags filter
    if (args.tags && args.tags.length > 0) {
      const serverTags = server.tags || [];
      const hasMatchingTag = args.tags.some((tag) => serverTags.includes(tag));
      if (!hasMatchingTag) {
        return false;
      }
    }

    return true;
  });

  // Enhanced server information
  const serversWithEnhancedInfo: EnhancedServerInfo[] = await Promise.all(
    filteredServers.map(async ([name, server]: [string, MCPServerParams]) => {
      // Create base info by spreading all properties except env, then handle env separately
      const { env: serverEnv, ...serverProps } = server;

      const baseInfo: EnhancedServerInfo = {
        name,
        ...serverProps,
        status: server.disabled ? 'disabled' : 'enabled',
        configured: true,
      };

      // Handle env property - only include record format, not array format
      if (serverEnv && !Array.isArray(serverEnv)) {
        baseInfo.env = serverEnv;
      }

      // Verbose mode - add more details (these are already included via spread operator)
      // No need to set them again as they're already in baseInfo

      // Include capabilities - get from client manager if available
      if (args.includeCapabilities) {
        try {
          const clientManager = ClientManager.getOrCreateInstance();
          const connection = clientManager.getClient(name);
          if (connection && connection.capabilities) {
            baseInfo.capabilities = {
              tools: connection.capabilities.tools ? 'enabled' : 'not supported',
              resources: connection.capabilities.resources ? 'enabled' : 'not supported',
              prompts: connection.capabilities.prompts ? 'enabled' : 'not supported',
            };
          } else {
            baseInfo.capabilities = { tools: 'N/A', resources: 'N/A', prompts: 'N/A' };
          }
        } catch {
          // Client not available or not connected
          baseInfo.capabilities = { tools: 'N/A', resources: 'N/A', prompts: 'N/A' };
        }
      }

      // Include health information
      if (args.includeHealth) {
        try {
          const clientManager = ClientManager.getOrCreateInstance();
          const connection = clientManager.getClient(name);
          baseInfo.health = {
            connected: !!connection,
            lastConnected: connection?.lastConnected?.toISOString() || null,
            responseTime: null, // We don't track response time in OutboundConnection
          };
        } catch {
          baseInfo.health = {
            connected: false,
            lastConnected: null,
            responseTime: null,
          };
        }
      }

      return baseInfo;
    }),
  );

  // Apply sorting
  const sortedServers = serversWithEnhancedInfo.sort((a, b) => {
    switch (args.sortBy) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'status':
        return a.status.localeCompare(b.status);
      case 'transport':
        return (a.type || '').localeCompare(b.type || '');
      case 'lastConnected': {
        const aTime = a.health?.lastConnected || '';
        const bTime = b.health?.lastConnected || '';
        return bTime.localeCompare(aTime); // Most recent first
      }
      default:
        return a.name.localeCompare(b.name);
    }
  });

  return {
    servers: sortedServers,
    total: servers.length,
    filtered: sortedServers.length,
    filters: args,
    format: args.format || 'table',
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
 * Extended reload arguments type for internal tool compatibility
 */
interface ExtendedMcpReloadToolArgs extends McpReloadToolArgs {
  target?: 'server' | 'config' | 'all' | string;
  name?: string;
}

/**
 * Handler for reload operations
 */
export async function handleReloadOperation(args: McpReloadToolArgs) {
  debugIf(() => ({
    message: 'Reload operation requested',
    meta: { args },
  }));

  const configManager = ConfigManager.getInstance();

  // Determine reload target based on input parameters
  let reloadTarget: 'server' | 'config' | 'all';

  // Type guard to check if args has extended properties
  const hasExtendedProps = (arg: McpReloadToolArgs): arg is ExtendedMcpReloadToolArgs => {
    return 'target' in arg || 'name' in arg;
  };

  // Check if this is an invalid reload target (for test compatibility)
  if (hasExtendedProps(args) && args.target && !['server', 'config', 'all'].includes(args.target)) {
    throw new Error(`Invalid reload target: ${args.target}`);
  }

  // Determine target based on parameters
  if (hasExtendedProps(args) && args.target) {
    // If target is explicitly specified
    reloadTarget = args.target as 'server' | 'config' | 'all';
  } else if (args.server || (hasExtendedProps(args) && args.name)) {
    // If server is specified, target is server
    reloadTarget = 'server';
  } else if (args.configOnly === false) {
    // If configOnly is explicitly false, treat as full reload
    reloadTarget = 'all';
  } else {
    // Default is config reload
    reloadTarget = 'config';
  }

  // Validation: server name is required when target is 'server'
  if (reloadTarget === 'server' && !args.server && !(hasExtendedProps(args) && args.name)) {
    throw new Error('Server name is required when target is "server"');
  }

  // Get server name from either 'server' or 'name' field
  const serverName: string = args.server || (hasExtendedProps(args) ? args.name || '' : '');

  // If a specific server is requested, reload it
  if (reloadTarget === 'server' && serverName) {
    logger.info(`Restarting server: ${serverName}`);
    const clientManager = ClientManager.current;

    try {
      // 1. Remove existing client
      await clientManager.removeClient(serverName);

      // 2. Re-create client from current config
      const config = configManager.getTransportConfig();
      const serverConfig = config[serverName];

      if (!serverConfig) {
        throw new Error(`Server ${serverName} not found in configuration`);
      }

      const transportMap = createTransports({ [serverName]: serverConfig });
      const transport = transportMap[serverName];

      if (transport) {
        await clientManager.createSingleClient(serverName, transport);
      } else {
        throw new Error(`Failed to create transport for ${serverName}`);
      }

      return {
        target: 'server',
        serverName: serverName,
        action: 'reloaded',
        timestamp: new Date().toISOString(),
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to restart server ${serverName}: ${errorMessage}`);
      return {
        target: 'server',
        serverName: serverName,
        action: 'failed',
        timestamp: new Date().toISOString(),
        success: false,
        error: errorMessage,
      };
    }
  }

  // If target is config, just reload configuration
  if (reloadTarget === 'config') {
    // Force reload from disk
    await configManager.reloadConfig();

    return {
      target: 'config',
      action: 'reloaded',
      timestamp: new Date().toISOString(),
      success: true,
      details: {
        message: 'Configuration reloaded successfully',
      },
    };
  }

  // Default: full reload (when reloadTarget is 'all')
  // Force reload from disk
  await configManager.reloadConfig();

  return {
    target: reloadTarget,
    action: 'reloaded',
    timestamp: new Date().toISOString(),
    success: true,
    details: {
      message: 'Configuration reloaded successfully',
    },
  };
}
