import { MCPServerParams } from '@src/core/types/index.js';
import { GlobalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

import {
  backupConfig,
  getServer,
  initializeConfigContext,
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
    await setServerEnabledState(argv, true);
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
    await setServerEnabledState(argv, false);
  } catch (error) {
    printer.error(`Failed to disable server: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

async function setServerEnabledState(argv: EnableDisableCommandArgs, enabled: boolean): Promise<void> {
  const { name, config: configPath, 'config-dir': configDir } = argv;

  initializeConfigContext(configPath, configDir);
  printer.info(`${enabled ? 'Enabling' : 'Disabling'} MCP server: ${name}`);

  validateServerName(name);
  validateConfigPath();

  if (!serverExists(name)) {
    throw new Error(`Server '${name}' does not exist. Use 'mcp add' to create it first.`);
  }

  const currentConfig = getServer(name);
  if (!currentConfig) {
    throw new Error(`Failed to retrieve server '${name}' configuration.`);
  }

  if (Boolean(currentConfig.disabled) === !enabled) {
    printer.info(`Server '${name}' is already ${enabled ? 'enabled' : 'disabled'}.`);
    return;
  }

  const backupPath = backupConfig();
  const updatedConfig: MCPServerParams = {
    ...currentConfig,
    disabled: !enabled,
  };

  if (enabled) {
    delete updatedConfig.disabled;
  }

  setServer(name, updatedConfig);

  printer.success(`Successfully ${enabled ? 'enabled' : 'disabled'} server '${name}'`);
  printer.keyValue({ Status: enabled ? 'Disabled → Enabled' : 'Enabled → Disabled', 'Backup created': backupPath });
  printer.blank();
  printer.info(
    enabled
      ? 'Server enabled. If 1mcp is running, the server will be started automatically.'
      : 'Server disabled. If 1mcp is running, the server will be stopped automatically.',
  );
  if (!enabled) {
    printer.info(`Use 'mcp enable ${name}' to re-enable it later.`);
  }
}
