import type { Argv } from 'yargs';
import { globalOptions } from '../../globalOptions.js';
import { buildConsolidateCommand } from './consolidate.js';
import { buildRestoreCommand } from './restore.js';
import { buildListCommand } from './list.js';
import { buildDiscoverCommand } from './discover.js';
import { buildStatusCommand } from './status.js';
import { buildBackupsCommand } from './backups.js';

/**
 * App command group entry point.
 *
 * Manages desktop application MCP configurations, allowing users to
 * consolidate MCP servers from apps into 1mcp and restore them when needed.
 */

/**
 * Register app command group and subcommands
 */
export function setupAppCommands(yargs: Argv): Argv {
  return yargs.command(
    'app',
    'Manage desktop application MCP configurations',
    (yargs) => {
      return yargs
        .options(globalOptions || {})
        .command({
          command: 'consolidate [app-name..]',
          describe: 'Consolidate MCP servers from desktop applications into 1mcp',
          builder: buildConsolidateCommand,
          handler: async (argv) => {
            const { consolidateCommand } = await import('./consolidate.js');
            await consolidateCommand(argv);
          },
        })
        .command({
          command: 'restore [app-name]',
          describe: 'Restore desktop applications to pre-consolidation state',
          builder: buildRestoreCommand,
          handler: async (argv) => {
            const { restoreCommand } = await import('./restore.js');
            await restoreCommand(argv);
          },
        })
        .command({
          command: 'list',
          describe: 'List supported desktop applications',
          builder: buildListCommand,
          handler: async (argv) => {
            const { listCommand } = await import('./list.js');
            await listCommand(argv);
          },
        })
        .command({
          command: 'discover',
          describe: 'Discover installed apps with MCP configurations',
          builder: buildDiscoverCommand,
          handler: async (argv) => {
            const { discoverCommand } = await import('./discover.js');
            await discoverCommand(argv);
          },
        })
        .command({
          command: 'status [app-name]',
          describe: 'Show current status of app configurations',
          builder: buildStatusCommand,
          handler: async (argv) => {
            const { statusCommand } = await import('./status.js');
            await statusCommand(argv);
          },
        })
        .command({
          command: 'backups [app-name]',
          describe: 'List all available backups',
          builder: buildBackupsCommand,
          handler: async (argv) => {
            const { backupsCommand } = await import('./backups.js');
            await backupsCommand(argv);
          },
        })
        .demandCommand(1, 'You must specify a subcommand')
        .help().epilogue(`
App Command Group - Desktop Application MCP Configuration Management

The app command group helps you consolidate MCP servers from various desktop
applications (Claude Desktop, Cursor, VS Code, etc.) into a unified 1mcp proxy.

This simplifies configuration management by:
• Moving all MCP servers to a single 1mcp instance
• Replacing individual app configs with one 1mcp connection
• Providing safe backup and restore capabilities
• Supporting both automatic and manual setup workflows

For more information about each command, use: $0 app <command> --help
        `);
    },
    () => {
      // This handler runs when 'app' is called without a subcommand
      console.log('Please specify a subcommand. Use --help for available commands.');
      process.exit(1);
    },
  );
}
