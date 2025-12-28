import { MCPServerParams } from '@src/core/types/index.js';
import { GlobalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

import {
  backupConfig,
  getServer,
  initializeConfigContext,
  reloadMcpConfig,
  serverExists,
  setServer,
  validateConfigPath,
} from './utils/mcpServerConfig.js';
import { validateServerName } from './utils/validation.js';

export interface EnableDisableCommandArgs extends GlobalOptions {
  name: string;
}

/**
 * Build the enable command configuration
 */
export function buildEnableCommand(yargs: Argv) {
  return yargs
    .positional('name', {
      describe: 'Name of the MCP server to enable',
      type: 'string',
      demandOption: true,
    })
    .example([['$0 mcp enable myserver', 'Enable a disabled server']]);
}

/**
 * Build the disable command configuration
 */
export function buildDisableCommand(yargs: Argv) {
  return yargs
    .positional('name', {
      describe: 'Name of the MCP server to disable',
      type: 'string',
      demandOption: true,
    })
    .example([['$0 mcp disable myserver', 'Disable a server temporarily']]);
}

/**
 * Enable a disabled MCP server
 */
export async function enableCommand(argv: EnableDisableCommandArgs): Promise<void> {
  try {
    const { name, config: configPath, 'config-dir': configDir } = argv;

    // Initialize config context with CLI options
    initializeConfigContext(configPath, configDir);

    printer.info(`Enabling MCP server: ${name}`);

    // Validate inputs
    validateServerName(name);

    // Validate config path
    validateConfigPath();

    // Check if server exists
    if (!serverExists(name)) {
      throw new Error(`Server '${name}' does not exist. Use 'mcp add' to create it first.`);
    }

    // Get current server configuration
    const currentConfig = getServer(name);
    if (!currentConfig) {
      throw new Error(`Failed to retrieve server '${name}' configuration.`);
    }

    // Check if server is already enabled
    if (!currentConfig.disabled) {
      printer.info(`Server '${name}' is already enabled.`);
      return;
    }

    // Create backup
    const backupPath = backupConfig();

    // Update configuration to enable the server
    const updatedConfig: MCPServerParams = {
      ...currentConfig,
      disabled: false,
    };

    // Remove the disabled property entirely if it's false (cleaner config)
    delete updatedConfig.disabled;

    // Save the updated configuration
    setServer(name, updatedConfig);

    // Reload MCP configuration
    reloadMcpConfig();

    // Success message
    printer.success(`Successfully enabled server '${name}'`);
    printer.keyValue({ Status: 'Disabled → Enabled', 'Backup created': backupPath });
    printer.blank();
    printer.info('Server enabled. If 1mcp is running, the server will be started automatically.');
  } catch (error) {
    printer.error(`Failed to enable server: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Disable an MCP server without removing it
 */
export async function disableCommand(argv: EnableDisableCommandArgs): Promise<void> {
  try {
    const { name, config: configPath, 'config-dir': configDir } = argv;

    // Initialize config context with CLI options
    initializeConfigContext(configPath, configDir);

    printer.info(`Disabling MCP server: ${name}`);

    // Validate inputs
    validateServerName(name);

    // Validate config path
    validateConfigPath();

    // Check if server exists
    if (!serverExists(name)) {
      throw new Error(`Server '${name}' does not exist. Use 'mcp add' to create it first.`);
    }

    // Get current server configuration
    const currentConfig = getServer(name);
    if (!currentConfig) {
      throw new Error(`Failed to retrieve server '${name}' configuration.`);
    }

    // Check if server is already disabled
    if (currentConfig.disabled) {
      printer.info(`Server '${name}' is already disabled.`);
      return;
    }

    // Create backup
    const backupPath = backupConfig();

    // Update configuration to disable the server
    const updatedConfig: MCPServerParams = {
      ...currentConfig,
      disabled: true,
    };

    // Save the updated configuration
    setServer(name, updatedConfig);

    // Reload MCP configuration
    reloadMcpConfig();

    // Success message
    printer.success(`Successfully disabled server '${name}'`);
    printer.keyValue({ Status: 'Enabled → Disabled', 'Backup created': backupPath });
    printer.blank();
    printer.info('Server disabled. If 1mcp is running, the server will be stopped automatically.');
    printer.info(`Use 'mcp enable ${name}' to re-enable it later.`);
  } catch (error) {
    printer.error(`Failed to disable server: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
