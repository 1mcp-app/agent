import { createConfigChangeService } from '@src/domains/config-change/configChange.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

import { initializeConfigContext, serverTargetExists } from './utils/mcpServerConfig.js';
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
    if (!serverTargetExists(serverName)) {
      throw new Error(`Server '${serverName}' does not exist in the configuration.`);
    }

    // Check if server is in use
    const inUse = checkServerInUse(serverName);

    if (inUse && !force) {
      printer.warn(`Warning: Server '${serverName}' appears to be currently in use.`);
      printer.info('Use --force to uninstall anyway.');
      throw new Error('Server is in use. Use --force to override.');
    }

    // Remove server configuration if requested
    if (removeConfig) {
      if (verbose) {
        logger.info(`Removing server configuration for '${serverName}'...`);
      }

      const result = await createConfigChangeService().removeConfiguredServerTarget({
        targetName: serverName,
        operation: 'uninstall',
        backup: createBackup ? 'required' : 'skip',
      });
      if (!result.changed) {
        throw new Error(`Failed to remove server '${serverName}' from configuration.`);
      }

      printer.success(`Successfully uninstalled server '${serverName}'`);

      const facts: Record<string, string> = {};
      if (result.backup.path) {
        logger.info(`Backup created: ${result.backup.path}`);
        facts['Backup created'] = result.backup.path;
      }
      facts['Reload status'] = result.reload.status;
      if (Object.keys(facts).length > 0) {
        printer.keyValue(facts);
      }
      for (const warning of result.warnings) {
        printer.warn(warning);
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
