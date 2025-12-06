/**
 * Management domain service adapter
 *
 * Thin adapter that bridges internal tools with management domain services.
 * This adapter wraps existing domain service calls and transforms data
 * between internal tool format and domain service format.
 */
import { getAllServers, getServer, reloadMcpConfig, setServer } from '@src/commands/mcp/utils/mcpServerConfig.js';
import { FlagManager } from '@src/core/flags/flagManager.js';
import { MCPServerParams } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { getServer1mcpUrl, validateServer1mcpUrl } from '@src/utils/validation/urlDetection.js';

import { type McpEditOutput, McpEditOutputSchema, McpEditToolArgs } from '../schemas/index.js';

/**
 * Management adapter interface
 */
export interface ManagementAdapter {
  listServers(options?: ManagementListOptions): Promise<ServerInfo[]>;
  getServerStatus(serverName?: string): Promise<ServerStatusInfo>;
  enableServer(serverName: string, options?: EnableServerOptions): Promise<EnableServerResult>;
  disableServer(serverName: string, options?: DisableServerOptions): Promise<DisableServerResult>;
  reloadConfiguration(options?: ReloadOptions): Promise<ReloadResult>;
  updateServerConfig(
    serverName: string,
    config: Partial<MCPServerParams & { newName?: string }>,
  ): Promise<UpdateConfigResult>;
  validateServerConfig(
    serverName: string,
    config: Partial<MCPServerParams & { newName?: string }>,
  ): Promise<ValidationResult>;
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
 * Configuration change tracking
 */
export interface ConfigChange {
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
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
  changes?: ConfigChange[];
  backupPath?: string;
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
    debugIf(() => ({
      message: 'Adapter: Validating server config',
      meta: { serverName, config },
    }));

    try {
      const errors: string[] = [];
      const warnings: string[] = [];
      const suggestions: string[] = [];

      // Get all servers for duplicate name checking
      const allServers = getAllServers();

      // Name validation (for server renaming)
      if (config.newName !== undefined) {
        const newName = config.newName;
        if (!newName || newName.trim().length === 0) {
          errors.push('Server name cannot be empty');
        } else if (newName !== serverName && allServers[newName]) {
          errors.push(`Server name '${newName}' already exists`);
        } else if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
          errors.push('Server name can only contain letters, numbers, hyphens, and underscores');
        } else if (newName.length > 100) {
          errors.push('Server name cannot exceed 100 characters');
        }
      }

      // Timeout validation
      const timeoutFields = ['timeout', 'connectionTimeout', 'requestTimeout'];
      for (const field of timeoutFields) {
        if (field in config && config[field as keyof typeof config] !== undefined) {
          const value = config[field as keyof typeof config] as number;
          if (typeof value !== 'number' || value < 0) {
            errors.push(`${field} must be a positive number`);
          } else if (value > 300000) {
            // 5 minutes
            warnings.push(`${field} value (${value}ms) is very high and may cause issues`);
          }
        }
      }

      // Basic transport validation
      if (!config.command && !config.url) {
        errors.push('Server must have either a command or URL');
      }

      if (config.url !== undefined) {
        if (!config.url) {
          errors.push('URL cannot be empty');
        } else {
          try {
            new URL(config.url); // Basic URL validation
            const urlValidation = await validateServer1mcpUrl(config.url);
            if (!urlValidation.valid) {
              errors.push(`Invalid URL: ${urlValidation.error}`);
            }
          } catch {
            errors.push('Invalid URL format');
          }
        }
      }

      // Command and arguments validation
      if (config.command !== undefined) {
        if (!config.command) {
          errors.push('Command cannot be empty');
        } else if (config.command.length > 1000) {
          errors.push('Command cannot exceed 1000 characters');
        }
      }

      if (config.args !== undefined) {
        if (!Array.isArray(config.args)) {
          errors.push('Arguments must be an array');
        } else if (config.args.some((arg) => typeof arg !== 'string')) {
          errors.push('All arguments must be strings');
        }
      }

      // Working directory validation
      if (config.cwd !== undefined) {
        if (config.cwd && !config.cwd.startsWith('/')) {
          warnings.push('Working directory should be an absolute path');
        }
      }

      // Environment variables validation
      if (config.env !== undefined) {
        if (typeof config.env !== 'object' || config.env === null) {
          errors.push('Environment variables must be an object');
        } else {
          const envArray = Array.isArray(config.env);
          const envObject = typeof config.env === 'object' && !envArray;

          if (envArray) {
            errors.push('Environment variables array format is not supported - use object format');
          } else if (envObject) {
            const env = config.env as Record<string, string>;
            for (const [key, value] of Object.entries(env)) {
              if (!key || typeof key !== 'string') {
                errors.push('Environment variable keys must be non-empty strings');
              } else if (typeof value !== 'string') {
                errors.push(`Environment variable ${key} must be a string`);
              }
            }
          }
        }
      }

      // Restart parameters validation
      const restartFields = ['maxRestarts', 'restartDelay'];
      for (const field of restartFields) {
        if (field in config && config[field as keyof typeof config] !== undefined) {
          const value = config[field as keyof typeof config] as number;
          if (typeof value !== 'number' || value < 0) {
            errors.push(`${field} must be a non-negative number`);
          }
        }
      }

      // Tags validation
      if (config.tags !== undefined) {
        if (!Array.isArray(config.tags)) {
          errors.push('Tags must be an array');
        } else if (config.tags.some((tag) => typeof tag !== 'string')) {
          errors.push('All tags must be strings');
        } else {
          const invalidTags = config.tags.filter((tag) => !tag || tag.length > 50 || !/^[a-zA-Z0-9_-]+$/.test(tag));
          if (invalidTags.length > 0) {
            errors.push(`Invalid tags: ${invalidTags.join(', ')}`);
          }
        }
      }

      // Headers validation
      if (config.headers !== undefined) {
        if (typeof config.headers !== 'object' || config.headers === null || Array.isArray(config.headers)) {
          errors.push('Headers must be an object');
        } else {
          for (const [key, value] of Object.entries(config.headers)) {
            if (!key || typeof key !== 'string') {
              errors.push('Header keys must be non-empty strings');
            } else if (typeof value !== 'string') {
              errors.push(`Header ${key} must be a string`);
            }
          }
        }
      }

      // OAuth validation
      if (config.oauth !== undefined) {
        if (typeof config.oauth !== 'object' || config.oauth === null || Array.isArray(config.oauth)) {
          errors.push('OAuth configuration must be an object');
        } else {
          const oauth = config.oauth;
          if (oauth.clientId !== undefined && typeof oauth.clientId !== 'string') {
            errors.push('OAuth client ID must be a string');
          }
          if (oauth.clientSecret !== undefined && typeof oauth.clientSecret !== 'string') {
            errors.push('OAuth client secret must be a string');
          }
          if (oauth.scopes !== undefined) {
            if (!Array.isArray(oauth.scopes) || oauth.scopes.some((scope) => typeof scope !== 'string')) {
              errors.push('OAuth scopes must be an array of strings');
            }
          }
        }
      }

      // Warnings and suggestions
      if (config.command && config.url) {
        warnings.push('Both command and URL specified - URL will take precedence');
      }

      if (config.command && !config.url && config.url === undefined) {
        suggestions.push('Consider using URL-based transport for better compatibility');
      }

      if (config.timeout !== undefined) {
        warnings.push('Using deprecated timeout field - consider using connectionTimeout and requestTimeout instead');
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
 * Internal tool handler for editing MCP server configurations
 */
export async function handleMcpEdit(args: McpEditToolArgs): Promise<McpEditOutput> {
  // Apply default values for optional operation control fields
  const normalizedArgs = {
    preview: args.preview ?? false,
    backup: args.backup ?? true,
    interactive: args.interactive ?? false,
    ...args,
  };

  try {
    debugIf(() => ({
      message: 'Executing mcp_edit tool',
      meta: { args: normalizedArgs },
    }));

    // Check if edit tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'edit', 'modify')) {
      const result = {
        success: false,
        message: 'MCP server editing is currently disabled by configuration',
        serverName: normalizedArgs.name,
        error: 'Edit tools are disabled',
      };
      return McpEditOutputSchema.parse(result);
    }

    const adapter = createManagementAdapter();

    // Validate configuration before making changes
    const validationResult = await adapter.validateServerConfig(normalizedArgs.name, normalizedArgs);
    if (!validationResult.valid) {
      const result = {
        success: false,
        message: `Configuration validation failed: ${validationResult.errors?.join(', ') || 'Unknown validation error'}`,
        serverName: normalizedArgs.name,
        error: validationResult.errors?.join(', ') || 'Validation failed',
      };
      return McpEditOutputSchema.parse(result);
    }

    // Handle preview mode
    if (normalizedArgs.preview) {
      const changes = await previewChanges(normalizedArgs.name, normalizedArgs, adapter);
      const result = {
        success: true,
        message: `Preview of changes for server '${normalizedArgs.name}' configuration`,
        serverName: normalizedArgs.name,
        preview: true,
        changes,
      };
      return McpEditOutputSchema.parse(result);
    }

    // Apply changes with backup if requested
    let backupPath: string | undefined;
    if (normalizedArgs.backup) {
      // Backup would be handled by the adapter
      debugIf(() => ({
        message: 'Creating backup before editing server configuration',
        meta: { serverName: normalizedArgs.name, backup: normalizedArgs.backup },
      }));
    }

    // Execute the configuration update
    const updateResult = await adapter.updateServerConfig(normalizedArgs.name, normalizedArgs);

    // Transform to match expected output schema
    const structuredResult = {
      success: updateResult.success,
      message: updateResult.success
        ? `MCP server '${updateResult.serverName}' configuration updated successfully`
        : `Failed to update server configuration: ${updateResult.errors?.join(', ') || 'Unknown error'}`,
      serverName: updateResult.serverName,
      changes: updateResult.changes,
      preview: false,
      backupPath: updateResult.backupPath || backupPath,
      warnings: updateResult.warnings,
      reloadRecommended: updateResult.success,
      error: updateResult.success ? undefined : updateResult.errors?.join(', '),
    };

    return McpEditOutputSchema.parse(structuredResult);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_edit tool handler', { error: errorMessage, serverName: normalizedArgs.name });

    const result = {
      success: false,
      message: `Edit operation failed: ${errorMessage}`,
      serverName: normalizedArgs.name,
      error: errorMessage,
    };

    return McpEditOutputSchema.parse(result);
  }
}

/**
 * Preview changes that would be made to the server configuration
 */
async function previewChanges(
  serverName: string,
  editArgs: McpEditToolArgs,
  adapter: ManagementAdapter,
): Promise<Array<{ field: string; oldValue?: unknown; newValue?: unknown }>> {
  try {
    const changes: Array<{ field: string; oldValue?: unknown; newValue?: unknown }> = [];

    // Get current server configuration
    const serverList: ServerInfo[] = await adapter.listServers();
    const currentServer = serverList.find((server: ServerInfo) => server.name === serverName);

    if (!currentServer) {
      throw new Error(`Server '${serverName}' not found`);
    }

    const currentConfig = currentServer.config;

    // Check each editable field for changes
    const editableFields = [
      'newName',
      'tags',
      'disabled',
      'timeout',
      'connectionTimeout',
      'requestTimeout',
      'env',
      'command',
      'args',
      'cwd',
      'inheritParentEnv',
      'envFilter',
      'restartOnExit',
      'maxRestarts',
      'restartDelay',
      'url',
      'headers',
      'oauth',
    ];

    for (const field of editableFields) {
      if (field in editArgs) {
        const fieldName = field === 'newName' ? 'name' : field;
        const newValue = editArgs[field as keyof McpEditToolArgs];
        const oldValue = currentConfig[fieldName as keyof typeof currentConfig];

        // Only add change if the value is different
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          changes.push({
            field: fieldName,
            oldValue,
            newValue,
          });
        }
      }
    }

    return changes;
  } catch (error) {
    logger.error('Error previewing configuration changes', {
      error: error instanceof Error ? error.message : 'Unknown error',
      serverName,
    });
    throw error;
  }
}

/**
 * Factory function to create management adapter
 */
export function createManagementAdapter(): ManagementAdapter {
  return new ConfigManagementAdapter();
}
