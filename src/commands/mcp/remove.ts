import readline from 'readline';
import type { Argv } from 'yargs';
import {
  serverExists,
  getServer,
  removeServer,
  validateConfigPath,
  backupConfig,
  reloadMcpConfig,
  initializeConfigContext,
} from './utils/configUtils.js';
import { validateServerName } from './utils/validation.js';
import { GlobalOptions } from '@src/globalOptions.js';

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

    console.log(`Removing MCP server: ${name}`);

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
    console.log(`\nServer Details:`);
    console.log(`  Name: ${name}`);
    console.log(`  Type: ${serverConfig.type}`);

    if (serverConfig.type === 'stdio') {
      console.log(`  Command: ${serverConfig.command}`);
      if (serverConfig.args) {
        console.log(`  Args: ${serverConfig.args.join(' ')}`);
      }
    } else {
      console.log(`  URL: ${serverConfig.url}`);
    }

    if (serverConfig.tags && serverConfig.tags.length > 0) {
      console.log(`  Tags: ${serverConfig.tags.join(', ')}`);
    }

    if (serverConfig.disabled) {
      console.log(`  Status: Disabled`);
    } else {
      console.log(`  Status: Enabled`);
    }

    // Confirmation prompt unless --yes flag is used
    if (!yes) {
      const confirmed = await confirmRemoval(name);
      if (!confirmed) {
        console.log('Operation cancelled.');
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
    console.log(`✅ Successfully removed server '${name}'`);
    console.log(`   Backup created: ${backupPath}`);
    console.log(
      `\n💡 Server removed from configuration. If 1mcp is running, the server will be unloaded automatically.`,
    );
  } catch (error) {
    console.error(`❌ Failed to remove server: ${error instanceof Error ? error.message : error}`);
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
