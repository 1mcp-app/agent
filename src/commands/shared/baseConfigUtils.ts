import fs from 'fs';
import path from 'path';

import ConfigContext from '@src/config/configContext.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { MCPServerParams } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

/**
 * Configuration file utilities for server management commands
 */

/**
 * Initialize the configuration context with CLI options
 * This should be called at the beginning of each command
 */
export function initializeConfigContext(configPath?: string, configDir?: string): void {
  const configContext = ConfigContext.getInstance();

  if (configPath) {
    configContext.setConfigPath(configPath);
  } else if (configDir) {
    configContext.setConfigDir(configDir);
  } else {
    configContext.reset(); // Use defaults
  }
}

export interface ServerConfig {
  mcpServers: Record<string, MCPServerParams>;
}

/**
 * Load the MCP configuration from a file
 * Uses ConfigContext to resolve the appropriate config file path
 */
export function loadConfig(configPath?: string): ServerConfig {
  const configContext = ConfigContext.getInstance();
  const filePath = configPath || configContext.getResolvedConfigPath();

  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Configuration file not found: ${filePath}`);
    }

    const configData = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;

    // Type guard to ensure configData has proper structure
    if (!configData || typeof configData !== 'object') {
      throw new Error(`Invalid configuration format: ${filePath}`);
    }

    const configObj = configData as Record<string, unknown>;

    // Ensure mcpServers exists and is properly typed
    if (!configObj.mcpServers || typeof configObj.mcpServers !== 'object') {
      configObj.mcpServers = {} as Record<string, MCPServerParams>;
    }

    // Validate that mcpServers is properly structured
    if (typeof configObj.mcpServers === 'object' && configObj.mcpServers !== null) {
      // Ensure mcpServers is a Record<string, MCPServerParams>
      const mcpServers = configObj.mcpServers as Record<string, unknown>;
      const validatedMcpServers: Record<string, MCPServerParams> = {};

      for (const [key, value] of Object.entries(mcpServers)) {
        if (value && typeof value === 'object') {
          // Basic validation - ensure it has at least a type property
          const serverConfig = value as MCPServerParams;
          validatedMcpServers[key] = serverConfig;
        }
      }

      configObj.mcpServers = validatedMcpServers;
    }

    return configObj as unknown as ServerConfig;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in configuration file: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Save the MCP configuration to a file
 * Uses ConfigContext to resolve the appropriate config file path
 */
export function saveConfig(config: ServerConfig): void {
  const configContext = ConfigContext.getInstance();
  const filePath = configContext.getResolvedConfigPath();

  try {
    // Ensure directory exists
    const fileDir = path.dirname(filePath);
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }

    // Write configuration with pretty formatting
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));

    logger.info(`Configuration saved to: ${filePath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to save configuration to ${filePath}: ${errorMessage}`);
  }
}

/**
 * Check if a server exists in the configuration
 */
export function serverExists(serverName: string): boolean {
  try {
    const config = loadConfig();
    return serverName in config.mcpServers;
  } catch (_error) {
    return false;
  }
}

/**
 * Get a specific server configuration
 */
export function getServer(serverName: string): MCPServerParams | null {
  try {
    const config = loadConfig();
    return config.mcpServers[serverName] || null;
  } catch (_error) {
    return null;
  }
}

/**
 * Add or update a server in the configuration
 */
export function setServer(serverName: string, serverConfig: MCPServerParams): void {
  const configContext = ConfigContext.getInstance();
  const filePath = configContext.getResolvedConfigPath();

  let config: ServerConfig;

  // Check if config file exists before trying to load it
  if (!fs.existsSync(filePath)) {
    // Create a new config if it doesn't exist
    config = { mcpServers: {} };
  } else {
    // Load existing config (will throw on invalid JSON or other errors)
    config = loadConfig();
  }

  config.mcpServers[serverName] = serverConfig;
  saveConfig(config);
}

/**
 * Remove a server from the configuration
 */
export function removeServer(serverName: string): boolean {
  try {
    const config = loadConfig();

    if (!(serverName in config.mcpServers)) {
      return false;
    }

    delete config.mcpServers[serverName];
    saveConfig(config);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to remove server ${serverName}: ${errorMessage}`);
  }
}

/**
 * Get all servers in the configuration
 */
export function getAllServers(): Record<string, MCPServerParams> {
  try {
    const config = loadConfig();
    return config.mcpServers;
  } catch (_error) {
    return {};
  }
}

/**
 * Parse environment variables from key=value format
 */
export function parseEnvVars(envArray?: string[]): Record<string, string> {
  if (!envArray || envArray.length === 0) {
    return {};
  }

  const env: Record<string, string> = {};

  for (const envVar of envArray) {
    const equalIndex = envVar.indexOf('=');
    if (equalIndex === -1) {
      throw new Error(`Invalid environment variable format: ${envVar}. Expected key=value`);
    }

    const key = envVar.substring(0, equalIndex).trim();
    const value = envVar.substring(equalIndex + 1);

    if (!key) {
      throw new Error(`Invalid environment variable format: ${envVar}. Key cannot be empty`);
    }

    env[key] = value;
  }

  return env;
}

/**
 * Parse headers from key=value format
 */
export function parseHeaders(headersArray?: string[]): Record<string, string> {
  if (!headersArray || headersArray.length === 0) {
    return {};
  }

  const headers: Record<string, string> = {};

  for (const header of headersArray) {
    const colonIndex = header.indexOf('=');
    if (colonIndex === -1) {
      throw new Error(`Invalid header format: ${header}. Expected key=value`);
    }

    const key = header.substring(0, colonIndex).trim();
    const value = header.substring(colonIndex + 1);

    if (!key) {
      throw new Error(`Invalid header format: ${header}. Key cannot be empty`);
    }

    headers[key] = value;
  }

  return headers;
}

/**
 * Parse tags from comma-separated string
 */
export function parseTags(tagsString?: string): string[] {
  if (!tagsString) {
    return [];
  }

  return tagsString
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Validate configuration file path
 */
export function validateConfigPath(configPath?: string): string {
  const configContext = ConfigContext.getInstance();
  const filePath = configPath || configContext.getResolvedConfigPath();

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`Configuration file not found: ${filePath}`);
    }

    // Check if file is readable
    fs.accessSync(filePath, fs.constants.R_OK);

    // Check if file is writable
    fs.accessSync(filePath, fs.constants.W_OK);

    return filePath;
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      throw error;
    }
    throw new Error(`Cannot access configuration file: ${filePath}. ${error}`);
  }
}

/**
 * Create a backup of the configuration file
 */
export function backupConfig(): string {
  const configContext = ConfigContext.getInstance();
  const filePath = configContext.getResolvedConfigPath();
  const timestamp = Date.now();
  const backupPath = `${filePath}.backup.${timestamp}`;

  try {
    fs.copyFileSync(filePath, backupPath);
    logger.info(`Configuration backed up to: ${backupPath}`);
    return backupPath;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create backup: ${errorMessage}`);
  }
}

/**
 * Validate server configuration against schema
 */
export function validateServerConfig(serverConfig: MCPServerParams): void {
  // Basic validation - type is required
  if (!serverConfig.type) {
    throw new Error('Server type is required');
  }

  // Validate based on type
  switch (serverConfig.type) {
    case 'stdio':
      if (!serverConfig.command) {
        throw new Error('Command is required for stdio servers');
      }
      break;

    case 'http':
    case 'sse':
      if (!serverConfig.url) {
        throw new Error(`URL is required for ${serverConfig.type} servers`);
      }

      try {
        new URL(serverConfig.url);
      } catch (_error) {
        throw new Error(`Invalid URL format: ${serverConfig.url}`);
      }
      break;

    default:
      throw new Error(`Unsupported server type: ${serverConfig.type}`);
  }

  // Validate timeout if provided
  if (serverConfig.timeout !== undefined) {
    if (typeof serverConfig.timeout !== 'number' || serverConfig.timeout < 0) {
      throw new Error('Timeout must be a positive number');
    }
  }

  // Validate tags if provided
  if (serverConfig.tags !== undefined) {
    if (!Array.isArray(serverConfig.tags)) {
      throw new Error('Tags must be an array');
    }

    for (const tag of serverConfig.tags) {
      if (typeof tag !== 'string' || tag.trim().length === 0) {
        throw new Error('All tags must be non-empty strings');
      }
    }
  }
}

/**
 * Reload MCP config manager after configuration changes
 */
export function reloadMcpConfig(): void {
  try {
    const configContext = ConfigContext.getInstance();
    const filePath = configContext.getResolvedConfigPath();

    // Get the config manager instance and reload it
    const configManager = McpConfigManager.getInstance(filePath);
    configManager.reloadConfig();
    logger.info('MCP configuration reloaded');
  } catch (error) {
    logger.warn(`Failed to reload MCP configuration: ${error}`);
  }
}
