import readline from 'readline';

import { GlobalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

import {
  backupConfig,
  getServer,
  initializeConfigContext,
  reloadMcpConfig,
  removeServer,
  serverExists,
  validateConfigPath,
} from './utils/mcpServerConfig.js';
import { validateServerName } from './utils/validation.js';

export interface RemoveCommandArgs extends GlobalOptions {
  name: string;
  yes?: boolean;
}

/**
 * Build the remove command configuration
 */
export function buildRemoveCommand(yargs: Argv) {
  return yargs
    .positional('name', {
      describe: 'Name of the MCP server to remove',
      type: 'string',
      demandOption: true,
    })
    .option('yes', {
      describe: 'Skip confirmation prompt',
      type: 'boolean',
      default: false,
      alias: 'y',
    })
    .example([
      ['$0 mcp remove myserver', 'Remove server with confirmation'],
      ['$0 mcp remove myserver --yes', 'Remove server without confirmation'],
    ]);
}

/**
 * Remove an MCP server from the configuration
 */
export async function removeCommand(argv: RemoveCommandArgs): Promise<void> {
  try {
    const { name, config: configPath, 'config-dir': configDir, yes = false } = argv;

    // Initialize config context with CLI options
    initializeConfigContext(configPath, configDir);

    printer.info(`Removing MCP server: ${name}`);

    // Validate inputs
    validateServerName(name);

    // Validate config path
    validateConfigPath();

    // Check if server exists
    if (!serverExists(name)) {
      throw new Error(`Server '${name}' does not exist in the configuration.`);
    }

    // Get server details for confirmation
    const serverConfig = getServer(name);
    if (!serverConfig) {
      throw new Error(`Failed to retrieve server '${name}' configuration.`);
    }

    // Show server details
    printer.blank();
    printer.title('Server Details:');
    printer.keyValue({ Name: name });
    if (serverConfig.type) {
      printer.keyValue({ Type: serverConfig.type });
    }

    if (serverConfig.type === 'stdio') {
      if (serverConfig.command) {
        printer.keyValue({ Command: serverConfig.command });
      }
      if (serverConfig.args) {
        printer.keyValue({ Args: serverConfig.args.join(' ') });
      }
    } else if (serverConfig.url) {
      printer.keyValue({ URL: serverConfig.url });
    }

    if (serverConfig.tags && serverConfig.tags.length > 0) {
      printer.keyValue({ Tags: serverConfig.tags.join(', ') });
    }

    if (serverConfig.disabled) {
      printer.keyValue({ Status: 'Disabled' });
    } else {
      printer.keyValue({ Status: 'Enabled' });
    }

    // Confirmation prompt unless --yes flag is used
    if (!yes) {
      const confirmed = await confirmRemoval(name);
      if (!confirmed) {
        printer.info('Operation cancelled.');
        return;
      }
    }

    // Create backup
    const backupPath = backupConfig();

    // Remove the server
    const removed = removeServer(name);
    if (!removed) {
      throw new Error(`Failed to remove server '${name}' from configuration.`);
    }

    // Reload MCP configuration
    reloadMcpConfig();

    // Success message
    printer.success(`Successfully removed server '${name}'`);
    printer.keyValue({ 'Backup created': backupPath });
    printer.blank();
    printer.info('Server removed from configuration. If 1mcp is running, the server will be unloaded automatically.');
  } catch (error) {
    printer.error(`Failed to remove server: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Prompt user for confirmation
 */
function confirmRemoval(serverName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      `\n⚠️  Are you sure you want to remove server '${serverName}'? This action cannot be undone. (y/N): `,
      (answer) => {
        rl.close();
        const confirmed = answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes';
        resolve(confirmed);
      },
    );
  });
}
