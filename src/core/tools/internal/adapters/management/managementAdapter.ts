/**
 * Management domain service adapter
 *
 * Thin adapter that bridges internal tools with management domain services.
 * This adapter wraps existing domain service calls and transforms data
 * between internal tool format and domain service format.
 */
import {
  getAllServers,
  getServer,
  reloadMcpConfig,
  resolveServerTarget,
  setResolvedServerTarget,
  setServer,
} from '@src/commands/mcp/utils/mcpServerConfig.js';
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
  ManagementStatusOptions,
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
    debugIf(() => ({ message: 'managementAdapter.adapter.listing.servers.edbf3728' }));

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
      logger.error('managementAdapter.server.listing.failed.0dc16e3f', { error: errorMessage });
      throw new Error(`Server listing failed: ${errorMessage}`);
    }
  }

  /**
   * Get status of servers
   */
  async getServerStatus(serverName?: string, options: ManagementStatusOptions = {}): Promise<ServerStatusInfo> {
    debugIf(() => ({
      message: 'managementAdapter.adapter.getting.server.status.716f48b0',
      meta: { serverName: serverName },
    }));

    try {
      const { handleServerStatus } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      const result = await handleServerStatus({
        name: serverName,
        details: options.details ?? false,
        health: options.health ?? true,
      });
      const serverStatuses = (result.server ? [result.server] : (result.servers ?? [])).map((server) => ({
        ...server,
        status: normalizeServerRuntimeStatus(server.status),
      }));

      const totalServers = serverStatuses.length;
      const enabledServers = serverStatuses.filter((s) => s.status !== 'disabled').length;
      const disabledServers = serverStatuses.filter((s) => s.status === 'disabled').length;
      const unhealthyServers = serverStatuses.filter(
        (server) => server.status === 'restarting' || server.status === 'crash-loop' || server.status === 'error',
      ).length;

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
      logger.error('managementAdapter.server.status.check.failed.1a469764', { error: errorMessage });
      throw new Error(`Server status check failed: ${errorMessage}`);
    }
  }

  /**
   * Enable a server
   */
  async enableServer(serverName: string, options: EnableServerOptions = {}): Promise<EnableServerResult> {
    debugIf(() => ({
      message: 'managementAdapter.adapter.enabling.server.c13276d8',
      meta: { serverName: serverName },
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
      logger.error('managementAdapter.server.enable.failed.185d648b', { error: errorMessage, serverName: serverName });
      throw new Error(`Server enable failed: ${errorMessage}`);
    }
  }

  /**
   * Disable a server
   */
  async disableServer(serverName: string, options: DisableServerOptions = {}): Promise<DisableServerResult> {
    debugIf(() => ({
      message: 'managementAdapter.adapter.disabling.server.b9bc9ead',
      meta: { serverName: serverName },
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
      logger.error('managementAdapter.server.disable.failed.ef84f36f', { error: errorMessage, serverName: serverName });
      throw new Error(`Server disable failed: ${errorMessage}`);
    }
  }

  /**
   * Reload configuration
   */
  async reloadConfiguration(options: ReloadOptions = {}): Promise<ReloadResult> {
    debugIf(() => ({ message: 'managementAdapter.adapter.reloading.configuration.a3daacfc' }));

    try {
      if (options.server) {
        const { handleReloadOperation } = await import('@src/core/tools/handlers/serverManagementHandler.js');
        const result = await handleReloadOperation({
          server: options.server,
          configOnly: options.configOnly ?? true,
          graceful: true,
          timeout: options.timeout ?? 30000,
          force: options.force ?? false,
        });
        return {
          success: result.success,
          target: result.target,
          action: result.action,
          timestamp: result.timestamp,
          reloadedServers: result.success ? [options.server] : [],
          errors: 'error' in result && result.error ? [result.error] : undefined,
          outcome: 'outcome' in result ? result.outcome : undefined,
        };
      }

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
      logger.error('managementAdapter.configuration.reload.failed.398d4189', { error: errorMessage });
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
      message: 'managementAdapter.adapter.updating.server.config.18395639',
      meta: { serverName: serverName },
    }));

    try {
      const resolvedTarget =
        'disabledTools' in configUpdate && configUpdate.newName === undefined ? resolveServerTarget(serverName) : null;
      const currentConfig = resolvedTarget?.serverConfig ?? getServer(serverName);
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
        'disabledTools',
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
      if (resolvedTarget) {
        setResolvedServerTarget(resolvedTarget, newConfig);
      } else {
        setServer(finalServerName, newConfig);
      }

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
      logger.error('managementAdapter.server.config.update.failed.ca162694', {
        error: errorMessage,
        serverName: serverName,
      });
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
  async getServerUrl(_options?: ServerUrlOptions): Promise<string> {
    debugIf(() => ({ message: 'managementAdapter.adapter.getting.server.url.129c4643' }));

    try {
      return getServer1mcpUrl();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('managementAdapter.failed.to.get.server.url.9bda30f6', { error: errorMessage });
      throw new Error(`Failed to get server URL: ${errorMessage}`);
    }
  }
}

function normalizeServerRuntimeStatus(status: string): ServerStatusInfo['servers'][number]['status'] {
  switch (status) {
    case 'enabled':
    case 'disabled':
    case 'connected':
    case 'disconnected':
    case 'restarting':
    case 'crash-loop':
    case 'error':
      return status;
    default:
      return 'unknown';
  }
}

/**
 * Factory function to create management adapter
 */
export function createManagementAdapter(): ManagementAdapter {
  return new ConfigManagementAdapter();
}
