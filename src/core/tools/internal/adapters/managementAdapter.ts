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
import { getServer1mcpUrl, validateServer1mcpUrl } from '@src/utils/validation/urlDetection.js';

/**
 * Management adapter interface
 */
export interface ManagementAdapter {
  listServers(options?: ManagementListOptions): Promise<ServerInfo[]>;
  getServerStatus(serverName?: string): Promise<ServerStatusInfo>;
  enableServer(serverName: string, options?: EnableServerOptions): Promise<EnableServerResult>;
  disableServer(serverName: string, options?: DisableServerOptions): Promise<DisableServerResult>;
  reloadConfiguration(options?: ReloadOptions): Promise<ReloadResult>;
  updateServerConfig(serverName: string, config: Partial<MCPServerParams>): Promise<UpdateConfigResult>;
  validateServerConfig(serverName: string, config: Partial<MCPServerParams>): Promise<ValidationResult>;
  getServerUrl(options?: { port?: number; host?: string }): Promise<string>;
}

/**
 * Server information structure
 */
export interface ServerInfo {
  name: string;
  config: MCPServerParams;
  status: 'enabled' | 'disabled' | 'unknown';
  transport?: 'stdio' | 'sse' | 'http';
  url?: string;
  healthStatus?: 'healthy' | 'unhealthy' | 'unknown';
  lastChecked?: Date;
  metadata?: {
    installedAt?: string;
    version?: string;
    source?: string;
    tags?: string[];
  };
}

/**
 * Server status information
 */
export interface ServerStatusInfo {
  timestamp: string;
  servers: Array<{
    name: string;
    status: 'enabled' | 'disabled' | 'unknown';
    transport?: string;
    url?: string;
    healthStatus?: string;
    lastChecked?: string;
    errors?: string[];
  }>;
  totalServers: number;
  enabledServers: number;
  disabledServers: number;
  unhealthyServers: number;
}

/**
 * Options for listing servers
 */
export interface ManagementListOptions {
  /** Filter by status */
  status?: 'enabled' | 'disabled' | 'all';
  /** Filter by transport type */
  transport?: 'stdio' | 'sse' | 'http';
  /** Include detailed information */
  detailed?: boolean;
  /** Filter by tags */
  tags?: string[];
}

/**
 * Options for enabling servers
 */
export interface EnableServerOptions {
  /** Restart server after enabling */
  restart?: boolean;
  /** Enable only for specific tags */
  tags?: string[];
  /** Enable with grace period */
  graceful?: boolean;
  /** Timeout in seconds */
  timeout?: number;
}

/**
 * Result of enabling a server
 */
export interface EnableServerResult {
  success: boolean;
  serverName: string;
  enabled: boolean;
  restarted?: boolean;
  warnings?: string[];
  errors?: string[];
}

/**
 * Options for disabling servers
 */
export interface DisableServerOptions {
  /** Gracefully shutdown server */
  graceful?: boolean;
  /** Timeout in seconds */
  timeout?: number;
  /** Disable only for specific tags */
  tags?: string[];
  /** Force disable even if in use */
  force?: boolean;
}

/**
 * Result of disabling a server
 */
export interface DisableServerResult {
  success: boolean;
  serverName: string;
  disabled: boolean;
  gracefulShutdown?: boolean;
  warnings?: string[];
  errors?: string[];
}

/**
 * Options for reloading configuration
 */
export interface ReloadOptions {
  /** Reload specific server */
  server?: string;
  /** Reload configuration only (no restart) */
  configOnly?: boolean;
  /** Force reload even if no changes */
  force?: boolean;
  /** Timeout in seconds */
  timeout?: number;
}

/**
 * Result of reload operation
 */
export interface ReloadResult {
  success: boolean;
  target: string;
  action: string;
  timestamp: string;
  reloadedServers?: string[];
  warnings?: string[];
  errors?: string[];
}

/**
 * Result of updating server configuration
 */
export interface UpdateConfigResult {
  success: boolean;
  serverName: string;
  previousConfig: MCPServerParams;
  newConfig: MCPServerParams;
  updated: boolean;
  warnings?: string[];
  errors?: string[];
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions?: string[];
}

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
        // For full reload, we trigger the ConfigReloadService
        // Note: In the current architecture, ConfigReloadService watches the config file,
        // so reloadMcpConfig() above will trigger the file watcher which triggers the service.
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
  async updateServerConfig(serverName: string, configUpdate: Partial<MCPServerParams>): Promise<UpdateConfigResult> {
    debugIf(() => ({
      message: 'Adapter: Updating server config',
      meta: { serverName, configUpdate },
    }));

    try {
      const currentConfig = getServer(serverName);
      if (!currentConfig) {
        throw new Error(`Server '${serverName}' not found`);
      }

      const newConfig = { ...currentConfig, ...configUpdate };
      setServer(serverName, newConfig);

      return {
        success: true,
        serverName,
        previousConfig: currentConfig,
        newConfig,
        updated: true,
        warnings: [],
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
  async validateServerConfig(serverName: string, config: Partial<MCPServerParams>): Promise<ValidationResult> {
    debugIf(() => ({
      message: 'Adapter: Validating server config',
      meta: { serverName, config },
    }));

    try {
      const errors: string[] = [];
      const warnings: string[] = [];
      const suggestions: string[] = [];

      // Basic validation
      if (!config.command && !config.url) {
        errors.push('Server must have either a command or URL');
      }

      if (config.url) {
        const urlValidation = await validateServer1mcpUrl(config.url);
        if (!urlValidation.valid) {
          errors.push(`Invalid URL: ${urlValidation.error}`);
        }
      }

      if (config.tags) {
        // Validate tag format (basic check)
        const invalidTags = config.tags.filter((tag) => !tag || tag.length > 50 || !/^[a-zA-Z0-9_-]+$/.test(tag));
        if (invalidTags.length > 0) {
          errors.push(`Invalid tags: ${invalidTags.join(', ')}`);
        }
      }

      // Warnings and suggestions
      if (config.command && config.url) {
        warnings.push('Both command and URL specified - URL will take precedence');
      }

      if (config.command && !config.url) {
        suggestions.push('Consider using URL-based transport for better compatibility');
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        suggestions,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Server config validation failed', { error: errorMessage, serverName });
      return {
        valid: false,
        errors: [errorMessage],
        warnings: [],
      };
    }
  }

  /**
   * Get 1mcp server URL for current configuration
   */
  async getServerUrl(options?: { port?: number; host?: string }): Promise<string> {
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
