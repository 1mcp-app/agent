import type { Argv } from 'yargs';
import { generateSupportedAppsHelp } from '../../utils/appPresets.js';
import { globalOptions } from '../../globalOptions.js';

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
          builder: (yargs) => {
            return yargs
              .positional('app-name', {
                describe: 'Desktop app(s) to consolidate (claude-desktop, cursor, vscode, etc.)',
                type: 'string',
                array: true,
                default: [],
              })
              .option('url', {
                describe: 'Override auto-detected 1mcp server URL',
                type: 'string',
                alias: 'u',
              })
              .option('dry-run', {
                describe: 'Preview changes without making them',
                type: 'boolean',
                default: false,
              })
              .option('yes', {
                describe: 'Skip confirmation prompts (for automation)',
                type: 'boolean',
                default: false,
                alias: 'y',
              })
              .option('manual-only', {
                describe: 'Show manual setup instructions only',
                type: 'boolean',
                default: false,
              })
              .option('backup-only', {
                describe: 'Create backup without replacing config',
                type: 'boolean',
                default: false,
              })
              .option('force', {
                describe: 'Skip validation warnings',
                type: 'boolean',
                default: false,
                alias: 'f',
              })
              .example([
                ['$0 app consolidate claude-desktop', 'Consolidate Claude Desktop MCP servers into 1mcp'],
                ['$0 app consolidate cursor --dry-run', 'Preview consolidation for Cursor'],
                ['$0 app consolidate vscode --url=http://localhost:3051/mcp', 'Use custom 1mcp URL'],
                ['$0 app consolidate claude-desktop cursor vscode', 'Consolidate multiple apps at once'],
              ]).epilogue(`
WHAT IT DOES:
  1. Extracts MCP server configurations from app config files
  2. Imports those servers into your 1mcp configuration
  3. Replaces app config with single 1mcp connection
  4. Creates backup of original app configuration

EXAMPLE WORKFLOW:
  Before: Claude Desktop → [filesystem, postgres, sequential] servers directly
  After:  Claude Desktop → 1mcp → [filesystem, postgres, sequential] servers

${generateSupportedAppsHelp()}
              `);
          },
          handler: async (argv) => {
            const { consolidateCommand } = await import('./consolidate.js');
            await consolidateCommand(argv as any);
          },
        })
        .command({
          command: 'restore [app-name]',
          describe: 'Restore desktop applications to pre-consolidation state',
          builder: (yargs) => {
            return yargs
              .positional('app-name', {
                describe: 'Desktop app to restore (claude-desktop, cursor, vscode, etc.)',
                type: 'string',
              })
              .option('backup', {
                describe: 'Specific backup file to restore from',
                type: 'string',
                alias: 'b',
              })
              .option('list', {
                describe: 'List available backups for app',
                type: 'boolean',
                default: false,
                alias: 'l',
              })
              .option('all', {
                describe: 'Restore all apps that were consolidated',
                type: 'boolean',
                default: false,
                alias: 'a',
              })
              .option('keep-in-1mcp', {
                describe: "Don't remove servers from 1mcp config (keep both)",
                type: 'boolean',
                default: false,
              })
              .option('dry-run', {
                describe: 'Preview restore without making changes',
                type: 'boolean',
                default: false,
              })
              .option('yes', {
                describe: 'Skip confirmation prompts',
                type: 'boolean',
                default: false,
                alias: 'y',
              })
              .example([
                ['$0 app restore claude-desktop', 'Restore Claude Desktop configuration'],
                ['$0 app restore cursor --list', 'List available backups for Cursor'],
                ['$0 app restore --all --dry-run', 'Preview restoring all apps'],
                ['$0 app restore --backup=./config.backup.1640995200000.meta', 'Restore from specific backup'],
              ]).epilogue(`
WHAT IT DOES:
  1. Finds backup files created during consolidation
  2. Restores original app configuration from backup
  3. Validates restored configuration works correctly
  4. Optionally removes imported servers from 1mcp config

EXAMPLE WORKFLOW:
  Current: Claude Desktop → 1mcp → [filesystem, postgres, sequential] servers
  After:   Claude Desktop → [filesystem, postgres, sequential] servers directly
              `);
          },
          handler: async (argv) => {
            const { restoreCommand } = await import('./restore.js');
            await restoreCommand(argv as any);
          },
        })
        .command({
          command: 'list',
          describe: 'List supported desktop applications',
          builder: (yargs) => {
            return yargs
              .option('configurable-only', {
                describe: 'Show only apps that support automatic consolidation',
                type: 'boolean',
                default: false,
              })
              .option('manual-only', {
                describe: 'Show only apps that require manual setup',
                type: 'boolean',
                default: false,
              })
              .example([
                ['$0 app list', 'List all supported applications'],
                ['$0 app list --configurable-only', 'List only auto-configurable apps'],
                ['$0 app list --manual-only', 'List only manual setup apps'],
              ]);
          },
          handler: async (argv) => {
            const { listCommand } = await import('./list.js');
            await listCommand(argv as any);
          },
        })
        .command({
          command: 'discover',
          describe: 'Discover installed apps with MCP configurations',
          builder: (yargs) => {
            return yargs
              .option('show-empty', {
                describe: 'Include apps with no MCP servers configured',
                type: 'boolean',
                default: false,
              })
              .option('show-paths', {
                describe: 'Show configuration file paths',
                type: 'boolean',
                default: false,
              })
              .example([
                ['$0 app discover', 'Find installed apps with MCP configs'],
                ['$0 app discover --show-empty', 'Include apps with no servers'],
                ['$0 app discover --show-paths', 'Show config file locations'],
              ]);
          },
          handler: async (argv) => {
            const { discoverCommand } = await import('./discover.js');
            await discoverCommand(argv as any);
          },
        })
        .command({
          command: 'status [app-name]',
          describe: 'Show current status of app configurations',
          builder: (yargs) => {
            return yargs
              .positional('app-name', {
                describe: 'Desktop app to check (claude-desktop, cursor, vscode, etc.)',
                type: 'string',
              })
              .option('verbose', {
                describe: 'Show detailed configuration information',
                type: 'boolean',
                default: false,
                alias: 'v',
              })
              .example([
                ['$0 app status', 'Show status of all apps'],
                ['$0 app status claude-desktop', 'Show status of specific app'],
                ['$0 app status --verbose', 'Show detailed status information'],
              ]);
          },
          handler: async (argv) => {
            const { statusCommand } = await import('./status.js');
            await statusCommand(argv as any);
          },
        })
        .command({
          command: 'backups [app-name]',
          describe: 'List all available backups',
          builder: (yargs) => {
            return yargs
              .positional('app-name', {
                describe: 'Show backups for specific app only',
                type: 'string',
              })
              .option('cleanup', {
                describe: 'Remove backups older than specified days',
                type: 'number',
              })
              .option('verify', {
                describe: 'Verify backup file integrity',
                type: 'boolean',
                default: false,
              })
              .example([
                ['$0 app backups', 'List all available backups'],
                ['$0 app backups claude-desktop', 'List backups for specific app'],
                ['$0 app backups --cleanup=30', 'Remove backups older than 30 days'],
                ['$0 app backups --verify', 'Verify backup integrity'],
              ]);
          },
          handler: async (argv) => {
            const { backupsCommand } = await import('./backups.js');
            await backupsCommand(argv as any);
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
