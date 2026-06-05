import fs from 'fs';
import path from 'path';

import ConfigContext from '@src/config/configContext.js';
import { ConfigLoader } from '@src/config/configLoader.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { mergeGlobalAndServerConfig, mergeGlobalWithServers } from '@src/config/mcpConfigMerge.js';
import { GlobalTransportConfig, MCPServerParams } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { normalizedArgv } from '@src/utils/cli/normalizedArgv.js';

export {
  backupConfig,
  getInheritedKeys,
  parseEnvVars,
  parseHeaders,
  parseTags,
  validateConfigPath,
  validateServerConfig,
} from './configParsingUtils.js';

/**
 * Configuration file utilities for server management commands
 */

/**
 * Initialize the configuration context with CLI options
 * This should be called at the beginning of each command
 */
export function initializeConfigContext(configPath?: string, configDir?: string): void {
  const configContext = ConfigContext.getInstance();
  const explicitConfigPath = getExplicitCliOptionValue(['--config', '-c']);
  const explicitConfigDir = getExplicitCliOptionValue(['--config-dir', '-d']);

  if (explicitConfigPath) {
    configContext.setConfigPath(explicitConfigPath);
  } else if (explicitConfigDir) {
    configContext.setConfigDir(explicitConfigDir);
  } else if (configDir) {
    configContext.setConfigDir(configDir);
  } else if (configPath) {
    configContext.setConfigPath(configPath);
  } else {
    configContext.reset(); // Use defaults
  }
}

function getExplicitCliOptionValue(flags: string[]): string | undefined {
  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const arg = normalizedArgv[index];
    if (!flags.includes(arg)) {
      const matchingFlag = flags.find((flag) => arg.startsWith(`${flag}=`));
      if (!matchingFlag) {
        continue;
      }

      const [, value] = arg.split(/=(.*)/su);
      return value || undefined;
    }

    const value = normalizedArgv[index + 1];
    if (value && !value.startsWith('-')) {
      return value;
    }
  }

  return undefined;
}

export interface ServerConfig {
  serverDefaults?: GlobalTransportConfig;
  mcpServers: Record<string, MCPServerParams>;
  mcpTemplates?: Record<string, MCPServerParams>;
}

export type ServerConfigSource = 'mcpServers' | 'mcpTemplates';

export interface ResolvedServerTarget {
  serverName: string;
  source: ServerConfigSource;
  serverConfig: MCPServerParams;
}

function normalizeRawServerConfigs(rawServers: unknown): Record<string, MCPServerParams> {
  if (!rawServers || typeof rawServers !== 'object') {
    return {};
  }

  const normalizedServers: Record<string, MCPServerParams> = {};

  for (const [serverName, serverConfig] of Object.entries(rawServers)) {
    if (serverConfig && typeof serverConfig === 'object') {
      normalizedServers[serverName] = serverConfig as MCPServerParams;
    }
  }

  return normalizedServers;
}

function createCommandConfigLoader(configPath: string): ConfigLoader {
  return new ConfigLoader(configPath, { ensureConfigExists: false });
}

function loadSharedConfigState(configPath?: string): {
  config: ServerConfig & Record<string, unknown>;
  effectiveServers: Record<string, MCPServerParams>;
} {
  const configContext = ConfigContext.getInstance();
  const filePath = configPath || configContext.getResolvedConfigPath();

  if (!fs.existsSync(filePath)) {
    throw new Error(`Configuration file not found: ${filePath}`);
  }

  try {
    const loader = createCommandConfigLoader(filePath);
    const loadedConfig = loader.loadParsedConfig({ includeAppConfig: false });
    const rawTemplates = normalizeRawServerConfigs(loadedConfig.rawConfig.mcpTemplates);
    const config = {
      ...loadedConfig.processedConfig,
      serverDefaults: loadedConfig.globalConfig,
      mcpServers: loadedConfig.rawServers,
      mcpTemplates: rawTemplates,
    } as ServerConfig & Record<string, unknown>;

    if (loadedConfig.schemaInjected) {
      delete config.$schema;
    }

    return {
      config,
      effectiveServers: mergeGlobalWithServers(loadedConfig.globalConfig, loadedConfig.rawServers),
    };
  } catch (error) {
    if (error instanceof Error && error.cause instanceof SyntaxError) {
      throw new Error(`Invalid JSON in configuration file: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Load the MCP configuration from a file
 * Uses ConfigContext to resolve the appropriate config file path
 */
export function loadConfig(configPath?: string): ServerConfig {
  return loadSharedConfigState(configPath).config;
}

function resolveServerTargetFromConfig(config: ServerConfig, serverName: string): ResolvedServerTarget | null {
  const templateConfig = config.mcpTemplates?.[serverName];
  if (templateConfig) {
    return {
      serverName,
      source: 'mcpTemplates',
      serverConfig: templateConfig,
    };
  }

  const staticConfig = config.mcpServers[serverName];
  if (staticConfig) {
    return {
      serverName,
      source: 'mcpServers',
      serverConfig: staticConfig,
    };
  }

  return null;
}

function getMergedResolvedServerTargetConfig(
  config: Pick<ServerConfig, 'serverDefaults'>,
  effectiveServers: Record<string, MCPServerParams>,
  target: ResolvedServerTarget,
): MCPServerParams {
  if (target.source === 'mcpServers') {
    return (
      effectiveServers[target.serverName] || mergeGlobalAndServerConfig(config.serverDefaults, target.serverConfig)
    );
  }

  return mergeGlobalAndServerConfig(config.serverDefaults, target.serverConfig);
}

function isMissingConfigError(error: unknown): boolean {
  return (
    (error instanceof Error && error.message.includes('Configuration file not found')) ||
    (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT')
  );
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
 * Check if a server exists in either mcpTemplates or mcpServers.
 * Template entries take precedence when names collide.
 */
export function serverTargetExists(serverName: string): boolean {
  try {
    return resolveServerTargetFromConfig(loadConfig(), serverName) !== null;
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
  } catch (error) {
    logger.warn(`Failed to get server '${serverName}': ${error instanceof Error ? error.message : String(error)}`);
    if (isMissingConfigError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolve a configured server target from mcpTemplates first, then mcpServers.
 */
export function resolveServerTarget(serverName: string): ResolvedServerTarget | null {
  try {
    return resolveServerTargetFromConfig(loadConfig(), serverName);
  } catch (error) {
    logger.warn(
      `Failed to resolve server target '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
    );
    if (isMissingConfigError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Get global MCP configuration from file.
 */
export function getGlobalConfig(): GlobalTransportConfig {
  try {
    const config = loadConfig();
    return config.serverDefaults || {};
  } catch (error) {
    logger.warn(`Failed to get global config: ${error instanceof Error ? error.message : String(error)}`);
    if (isMissingConfigError(error)) {
      return {};
    }
    throw error;
  }
}

/**
 * Get effective merged configuration for a specific server.
 */
export function getEffectiveServerConfig(serverName: string): MCPServerParams | null {
  try {
    const { config, effectiveServers } = loadSharedConfigState();
    const serverConfig = config.mcpServers[serverName];
    if (!serverConfig) {
      return null;
    }

    return getMergedResolvedServerTargetConfig(config, effectiveServers, {
      serverName,
      source: 'mcpServers',
      serverConfig,
    });
  } catch (error) {
    logger.warn(
      `Failed to get effective server config for '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
    );
    if (isMissingConfigError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Get effective merged configuration for a configured target from either mcpTemplates or mcpServers.
 * Template entries still use template-first precedence, but only inherit global defaults here;
 * they are not rendered with runtime context.
 */
export function getEffectiveServerTargetConfig(serverName: string): MCPServerParams | null {
  try {
    const { config, effectiveServers } = loadSharedConfigState();
    const target = resolveServerTargetFromConfig(config, serverName);
    if (!target) {
      return null;
    }

    return getMergedResolvedServerTargetConfig(config, effectiveServers, target);
  } catch (error) {
    logger.warn(
      `Failed to get effective server target config for '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
    );
    if (isMissingConfigError(error)) {
      return null;
    }
    throw error;
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
 * Persist an updated server config back to the same section it was resolved from.
 */
export function setResolvedServerTarget(
  target: Pick<ResolvedServerTarget, 'serverName' | 'source'>,
  serverConfig: MCPServerParams,
): void {
  const configContext = ConfigContext.getInstance();
  const filePath = configContext.getResolvedConfigPath();

  let config: ServerConfig;

  if (!fs.existsSync(filePath)) {
    config = { mcpServers: {} };
  } else {
    config = loadConfig();
  }

  if (target.source === 'mcpTemplates') {
    config.mcpTemplates = config.mcpTemplates || {};
    config.mcpTemplates[target.serverName] = serverConfig;
  } else {
    config.mcpServers[target.serverName] = serverConfig;
  }

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
  } catch (error) {
    logger.warn(`Failed to get all servers: ${error instanceof Error ? error.message : String(error)}`);
    if (isMissingConfigError(error)) {
      return {};
    }
    throw error;
  }
}

/**
 * Get all configured servers with template-first precedence for duplicate names.
 */
export function getAllServerTargets(): Record<string, MCPServerParams> {
  try {
    const config = loadConfig();
    return {
      ...config.mcpServers,
      ...(config.mcpTemplates || {}),
    };
  } catch (error) {
    logger.warn(`Failed to get all server targets: ${error instanceof Error ? error.message : String(error)}`);
    if (isMissingConfigError(error)) {
      return {};
    }
    throw error;
  }
}

/**
 * Get all effective server configurations after applying global inheritance.
 */
export function getAllEffectiveServers(): Record<string, MCPServerParams> {
  try {
    return loadSharedConfigState().effectiveServers;
  } catch (error) {
    logger.warn(`Failed to get all effective servers: ${error instanceof Error ? error.message : String(error)}`);
    if (isMissingConfigError(error)) {
      return {};
    }
    throw error;
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
    logger.warn(`Failed to reload MCP configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}
