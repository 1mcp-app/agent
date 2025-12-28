import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

import {
  backupConfig,
  initializeConfigContext,
  reloadMcpConfig,
  removeServer,
  serverExists,
} from './utils/mcpServerConfig.js';
import { checkServerInUse, validateServerName } from './utils/serverUtils.js';

export interface UninstallCommandArgs extends GlobalOptions {
  serverName: string;
  force?: boolean;
  backup?: boolean;
  'remove-config'?: boolean;
  verbose?: boolean;
}

/**
 * Build the uninstall command configuration
 */
export function buildUninstallCommand(yargs: Argv) {
  return yargs
    .positional('serverName', {
      describe: 'Server name to uninstall',
      type: 'string',
      demandOption: true,
    })
    .option('force', {
      describe: 'Skip confirmation prompts',
      type: 'boolean',
      default: false,
    })
    .option('backup', {
      describe: 'Create backup before removal (default: true)',
      type: 'boolean',
      default: true,
    })
    .option('remove-config', {
      describe: 'Remove server configuration (default: true)',
      type: 'boolean',
      default: true,
    })
    .option('verbose', {
      describe: 'Detailed output',
      type: 'boolean',
      default: false,
      alias: 'v',
    })
    .example([
      ['$0 mcp uninstall filesystem', 'Uninstall filesystem server'],
      ['$0 mcp uninstall filesystem --force', 'Uninstall without confirmation'],
      ['$0 mcp uninstall filesystem --no-backup', 'Uninstall without creating backup'],
    ]);
}

/**
 * Uninstall command handler
 */
export async function uninstallCommand(argv: UninstallCommandArgs): Promise<void> {
  try {
    const {
      serverName,
      config: configPath,
      'config-dir': configDir,
      force = false,
      backup: createBackup = true,
      'remove-config': removeConfig = true,
      verbose = false,
    } = argv;

    // Initialize configuration context
    initializeConfigContext(configPath, configDir);

    if (verbose) {
      logger.info('Starting uninstall process...');
    }

    // Validate server name
    validateServerName(serverName);

    // Check if server exists
    if (!serverExists(serverName)) {
      throw new Error(`Server '${serverName}' does not exist in the configuration.`);
    }

    // Check if server is in use
    const inUse = checkServerInUse(serverName);

    if (inUse && !force) {
      printer.warn(`Warning: Server '${serverName}' appears to be currently in use.`);
      printer.info('Use --force to uninstall anyway.');
      throw new Error('Server is in use. Use --force to override.');
    }

    // Create backup if requested
    let backupPath: string | undefined;
    if (createBackup) {
      if (verbose) {
        logger.info('Creating backup before uninstall...');
      }
      backupPath = backupConfig();
      logger.info(`Backup created: ${backupPath}`);
    }

    // Remove server configuration if requested
    if (removeConfig) {
      if (verbose) {
        logger.info(`Removing server configuration for '${serverName}'...`);
      }

      const removed = removeServer(serverName);
      if (!removed) {
        throw new Error(`Failed to remove server '${serverName}' from configuration.`);
      }

      // Reload MCP configuration
      reloadMcpConfig();

      printer.success(`Successfully uninstalled server '${serverName}'`);

      if (backupPath) {
        printer.keyValue({ 'Backup created': backupPath });
      }
    } else {
      printer.blank();
      printer.warn('Server configuration not removed (--no-remove-config specified)');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    printer.error(`Uninstall failed: ${errorMessage}`);
    if (error instanceof Error && error.stack) {
      logger.error('Uninstall error stack:', error.stack);
    }
    throw error;
  }
}
