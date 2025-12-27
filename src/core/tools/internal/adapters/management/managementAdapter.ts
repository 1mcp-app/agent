/**
 * Management domain service adapter
 *
 * Thin adapter that bridges internal tools with management domain services.
 * This adapter wraps existing domain service calls and transforms data
 * between internal tool format and domain service format.
 */
import { getAllServers, getServer, reloadMcpConfig, setServer } from '@src/commands/mcp/utils/mcpServerConfig.js';
import { MCPServerParams } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { getServer1mcpUrl } from '@src/utils/validation/urlDetection.js';

import {
  ConfigChange,
  DisableServerOptions,
  DisableServerResult,
  EnableServerOptions,
  EnableServerResult,
  ManagementAdapter,
  ManagementListOptions,
  ReloadOptions,
  ReloadResult,
  ServerInfo,
  ServerStatusInfo,
  ServerUrlOptions,
  UpdateConfigResult,
  ValidationResult,
} from './types.js';
import { validateServerConfig } from './validation.js';

/**
 * Management adapter implementation using configuration utilities
 */
export class ConfigManagementAdapter implements ManagementAdapter {
  /**
   * List all configured servers with optional filtering
   */
  async listServers(options: ManagementListOptions = {}): Promise<ServerInfo[]> {
    debugIf(() => ({
      message: 'Adapter: Listing servers',
      meta: { options },
    }));

    try {
      const allServers = getAllServers();
      let servers = Object.entries(allServers);

      // Apply filters
      if (options.status && options.status !== 'all') {
        servers = servers.filter(([_, config]) => {
          if (options.status === 'enabled') return !config.disabled;
          if (options.status === 'disabled') return config.disabled;
          return true;
        });
      }

      if (options.transport) {
        servers = servers.filter(([_, config]) => {
          if (options.transport === 'stdio') return !config.url;
          if (options.transport === 'sse') {
            return config.url && (config.url.endsWith('/sse') || config.url.includes('/sse?'));
          }
          if (options.transport === 'http') {
            return config.url && !config.url.includes('/sse');
          }
          return false;
        });
      }

      if (options.tags && options.tags.length > 0) {
        servers = servers.filter(([_, config]) => {
          if (!config.tags) return false;
          return options.tags!.some((tag) => config.tags!.includes(tag));
        });
      }

      // Transform to ServerInfo format
      const serverInfos: ServerInfo[] = servers.map(([name, config]) => ({
        name,
        config,
        status: config.disabled ? 'disabled' : 'enabled',
        transport: config.url ? (config.url.includes('/sse') ? 'sse' : 'http') : 'stdio',
        url: config.url,
        healthStatus: 'unknown', // Would require actual health checking
        metadata: {
          tags: config.tags,
          // Additional metadata could be extracted from installation records
        },
      }));

      return serverInfos;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Server listing failed', { error: errorMessage });
      throw new Error(`Server listing failed: ${errorMessage}`);
    }
  }

  /**
   * Get status of servers
   */
  async getServerStatus(serverName?: string): Promise<ServerStatusInfo> {
    debugIf(() => ({
      message: 'Adapter: Getting server status',
      meta: { serverName },
    }));

    try {
      const allServers = getAllServers();
      let targetServers = serverName ? { [serverName]: allServers[serverName] } : allServers;

      // Filter out undefined entries if serverName was provided but not found
      if (serverName && !targetServers[serverName]) {
        return {
          timestamp: new Date().toISOString(),
          servers: [],
          totalServers: 0,
          enabledServers: 0,
          disabledServers: 0,
          unhealthyServers: 0,
        };
      }

      const serverStatuses = Object.entries(targetServers)
        .filter(([_, config]) => config !== undefined)
        .map(([name, config]) => ({
          name,
          status: config!.disabled ? 'disabled' : ('enabled' as 'enabled' | 'disabled' | 'unknown'),
          transport: config!.url ? (config!.url.includes('/sse') ? 'sse' : 'http') : 'stdio',
          url: config!.url,
          healthStatus: 'unknown', // Would require actual health checking
          lastChecked: new Date().toISOString(),
          errors: config!.disabled ? [] : [], // Would require actual error checking
        }));

      const totalServers = serverStatuses.length;
      const enabledServers = serverStatuses.filter((s) => s.status === 'enabled').length;
      const disabledServers = serverStatuses.filter((s) => s.status === 'disabled').length;
      const unhealthyServers = 0; // Would require actual health checking

      return {
        timestamp: new Date().toISOString(),
        servers: serverStatuses,
        totalServers,
        enabledServers,
        disabledServers,
        unhealthyServers,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Server status check failed', { error: errorMessage });
      throw new Error(`Server status check failed: ${errorMessage}`);
    }
  }

  /**
   * Enable a server
   */
  async enableServer(serverName: string, options: EnableServerOptions = {}): Promise<EnableServerResult> {
    debugIf(() => ({
      message: 'Adapter: Enabling server',
      meta: { serverName, options },
    }));

    try {
      const config = getServer(serverName);
      if (!config) {
        throw new Error(`Server '${serverName}' not found`);
      }

      if (!config.disabled) {
        return {
          success: true,
          serverName,
          enabled: true,
          warnings: ['Server was already enabled'],
        };
      }

      // Enable the server
      const updatedConfig = { ...config, disabled: false };
      setServer(serverName, updatedConfig);

      // Handle tag-based enabling if specified
      if (options.tags && options.tags.length > 0) {
        const currentTags = updatedConfig.tags || [];
        const newTags = [...new Set([...currentTags, ...options.tags])];
        updatedConfig.tags = newTags;
        setServer(serverName, updatedConfig);
      }

      return {
        success: true,
        serverName,
        enabled: true,
        restarted: options.restart || false,
        warnings: [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Server enable failed', { error: errorMessage, serverName });
      throw new Error(`Server enable failed: ${errorMessage}`);
    }
  }

  /**
   * Disable a server
   */
  async disableServer(serverName: string, options: DisableServerOptions = {}): Promise<DisableServerResult> {
    debugIf(() => ({
      message: 'Adapter: Disabling server',
      meta: { serverName, options },
    }));

    try {
      const config = getServer(serverName);
      if (!config) {
        throw new Error(`Server '${serverName}' not found`);
      }

      if (config.disabled) {
        return {
          success: true,
          serverName,
          disabled: true,
          warnings: ['Server was already disabled'],
        };
      }

      // Disable the server
      const updatedConfig = { ...config, disabled: true };
      setServer(serverName, updatedConfig);

      // Handle tag-based disabling if specified
      if (options.tags && options.tags.length > 0) {
        const currentTags = updatedConfig.tags || [];
        const newTags = currentTags.filter((tag) => !options.tags!.includes(tag));
        updatedConfig.tags = newTags;
        setServer(serverName, updatedConfig);
      }

      return {
        success: true,
        serverName,
        disabled: true,
        gracefulShutdown: options.graceful || false,
        warnings: [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Server disable failed', { error: errorMessage, serverName });
      throw new Error(`Server disable failed: ${errorMessage}`);
    }
  }

  /**
   * Reload configuration
   */
  async reloadConfiguration(options: ReloadOptions = {}): Promise<ReloadResult> {
    debugIf(() => ({
      message: 'Adapter: Reloading configuration',
      meta: { options },
    }));

    try {
      const target = options.server || 'all-servers';
      const action = options.configOnly ? 'config-reload' : 'full-reload';
      const timestamp = new Date().toISOString();

      // Use reloadMcpConfig for config-only reload or as part of full reload
      reloadMcpConfig();

      let reloadedServers: string[] = [];

      if (options.configOnly) {
        // For config-only reload, we just reload the config file
        if (options.server) {
          reloadedServers = [options.server];
        } else {
          const allServers = getAllServers();
          reloadedServers = Object.keys(allServers);
        }
      } else {
        // For full reload, we trigger the ConfigManager
        // Note: In the current architecture, ConfigManager watches the config file,
        // so reloadMcpConfig() above will trigger the file watcher which triggers ConfigChangeHandler.
        // However, if we want to be explicit or wait for completion, we might need direct access.
        // For now, we rely on the file watcher mechanism which is robust.

        if (options.server) {
          reloadedServers = [options.server];
        } else {
          const allServers = getAllServers();
          reloadedServers = Object.keys(allServers);
        }
      }

      return {
        success: true,
        target,
        action,
        timestamp,
        reloadedServers,
        warnings: [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Configuration reload failed', { error: errorMessage });
      throw new Error(`Configuration reload failed: ${errorMessage}`);
    }
  }

  /**
   * Update server configuration
   */
  async updateServerConfig(
    serverName: string,
    configUpdate: Partial<MCPServerParams & { newName?: string }>,
  ): Promise<UpdateConfigResult> {
    debugIf(() => ({
      message: 'Adapter: Updating server config',
      meta: { serverName, configUpdate },
    }));

    try {
      const currentConfig = getServer(serverName);
      if (!currentConfig) {
        throw new Error(`Server '${serverName}' not found`);
      }

      const previousConfig = { ...currentConfig };

      // Handle server renaming
      let finalServerName = serverName;
      const { newName, ...configChanges } = configUpdate;

      if (newName && newName !== serverName) {
        const allServers = getAllServers();
        if (allServers[newName]) {
          throw new Error(`Server name '${newName}' already exists`);
        }

        // Remove old server and create new one with updated config
        delete allServers[serverName];
        finalServerName = newName;
        serverName = newName; // Update for the return value
      }

      // Track changes for all fields
      const changes: ConfigChange[] = [];

      // Handle renaming as a change
      if (newName && newName !== finalServerName) {
        changes.push({
          field: 'name',
          oldValue: finalServerName,
          newValue: newName,
        });
      }

      // Check all other fields for changes
      const checkableFields = [
        'disabled',
        'timeout',
        'connectionTimeout',
        'requestTimeout',
        'tags',
        'command',
        'args',
        'cwd',
        'env',
        'inheritParentEnv',
        'envFilter',
        'restartOnExit',
        'maxRestarts',
        'restartDelay',
        'url',
        'headers',
        'oauth',
      ] as const;

      for (const field of checkableFields) {
        if (field in configChanges) {
          const oldValue = currentConfig[field];
          const newValue = configChanges[field];

          // Only add change if value is actually different
          if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            changes.push({
              field,
              oldValue,
              newValue,
            });
          }
        }
      }

      // Apply configuration changes
      const newConfig = { ...currentConfig, ...configChanges };
      setServer(finalServerName, newConfig);

      // Generate warnings based on changes
      const warnings: string[] = [];
      if (changes.some((change) => change.field === 'command' || change.field === 'url')) {
        warnings.push('Transport configuration changed - server restart required');
      }
      if (changes.some((change) => change.field === 'oauth')) {
        warnings.push('OAuth configuration changed - re-authentication may be required');
      }

      return {
        success: true,
        serverName: finalServerName,
        previousConfig,
        newConfig,
        updated: changes.length > 0,
        changes,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Server config update failed', { error: errorMessage, serverName });
      throw new Error(`Server config update failed: ${errorMessage}`);
    }
  }

  /**
   * Validate server configuration
   */
  async validateServerConfig(
    serverName: string,
    config: Partial<MCPServerParams & { newName?: string }>,
  ): Promise<ValidationResult> {
    return validateServerConfig(serverName, config);
  }

  /**
   * Get 1mcp server URL for current configuration
   */
  async getServerUrl(options?: ServerUrlOptions): Promise<string> {
    debugIf(() => ({
      message: 'Adapter: Getting server URL',
      meta: { options },
    }));

    try {
      return getServer1mcpUrl();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to get server URL', { error: errorMessage });
      throw new Error(`Failed to get server URL: ${errorMessage}`);
    }
  }
}

/**
 * Factory function to create management adapter
 */
export function createManagementAdapter(): ManagementAdapter {
  return new ConfigManagementAdapter();
}
