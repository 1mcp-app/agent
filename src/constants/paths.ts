/**
 * Path and configuration directory constants
 */
import os from 'os';

import { MCP_CONFIG_FILE, MCP_INSTRUCTIONS_TEMPLATE_FILE } from './mcp.js';

// Global config paths
export const CONFIG_DIR_NAME = '1mcp';
export const BACKUP_DIR_NAME = 'backups';
export const DEFAULT_CONFIG = {
  mcpServers: {},
};

/**
 * Get the global config directory path based on OS
 */
export function getGlobalConfigDir(): string {
  const homeDir = os.homedir();

  const configDir =
    process.platform === 'darwin' || process.platform === 'linux'
      ? `${homeDir}/.config/${CONFIG_DIR_NAME}`
      : `${homeDir}/AppData/Roaming/${CONFIG_DIR_NAME}`;

  return configDir;
}

/**
 * Get the config directory path with CLI option override support
 * Priority: CLI option (includes env var via yargs ONE_MCP prefix) -> Default global config dir
 */
export function getConfigDir(configDirOption?: string): string {
  if (configDirOption !== undefined && configDirOption !== '') {
    return configDirOption;
  }

  return getGlobalConfigDir();
}

/**
 * Get the global config file path
 */
export function getGlobalConfigPath(): string {
  return `${getGlobalConfigDir()}/${MCP_CONFIG_FILE}`;
}

/**
 * Get config file path from directory or global default
 */
export function getConfigPath(configDir?: string): string {
  if (configDir) {
    return `${configDir}/${MCP_CONFIG_FILE}`;
  }
  return getGlobalConfigPath();
}

/**
 * Get the global backup directory path
 */
export function getGlobalBackupDir(): string {
  return `${getGlobalConfigDir()}/${BACKUP_DIR_NAME}`;
}

/**
 * Get app-specific backup directory path
 */
export function getAppBackupDir(appName: string): string {
  return `${getGlobalBackupDir()}/${appName}`;
}

/**
 * Get the default instructions template file path
 */
export function getDefaultInstructionsTemplatePath(configDir?: string): string {
  const dir = configDir ? configDir : getGlobalConfigDir();
  return `${dir}/${MCP_INSTRUCTIONS_TEMPLATE_FILE}`;
}
