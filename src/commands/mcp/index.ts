import type { Argv } from 'yargs';

/**
 * MCP command group entry point.
 *
 * Manages MCP server configurations, allowing users to add, remove, update,
 * enable/disable, list, and check status of MCP servers in their 1mcp configuration.
 */

/**
 * Register MCP command group and subcommands
 */
export function setupMcpCommands(yargs: Argv): Argv {
  return yargs.command(
    'mcp',
    'Manage MCP server configurations',
    (yargs) => {
      return yargs
        .command({
          command: 'add <name>',
          describe: 'Add a new MCP server to the configuration',
          builder: (yargs) => {
            return yargs
              .positional('name', {
                describe: 'Name of the MCP server',
                type: 'string',
                demandOption: true,
              })
              .option('config', {
                describe: 'Path to the config file',
                type: 'string',
                alias: 'c',
              })
              .option('type', {
                describe: 'Transport type for the server',
                type: 'string',
                choices: ['stdio', 'http', 'sse'],
                demandOption: true,
              })
              .option('command', {
                describe: 'Command to execute (required for stdio)',
                type: 'string',
              })
              .option('args', {
                describe: 'Arguments for the command (stdio only)',
                type: 'array',
                string: true,
              })
              .option('url', {
                describe: 'URL for HTTP/SSE servers',
                type: 'string',
                alias: 'u',
              })
              .option('env', {
                describe: 'Environment variables in key=value format',
                type: 'array',
                string: true,
                alias: 'e',
              })
              .option('tags', {
                describe: 'Tags for categorization (comma-separated)',
                type: 'string',
                alias: 'g',
              })
              .option('timeout', {
                describe: 'Connection timeout in milliseconds',
                type: 'number',
              })
              .option('disabled', {
                describe: 'Add server in disabled state',
                type: 'boolean',
                default: false,
              })
              .option('cwd', {
                describe: 'Working directory for stdio servers',
                type: 'string',
              })
              .option('headers', {
                describe: 'HTTP headers in key=value format (HTTP/SSE only)',
                type: 'array',
                string: true,
              })
              .example([
                ['$0 mcp add myserver --type=stdio --command=node --args=server.js', 'Add stdio server'],
                ['$0 mcp add webserver --type=http --url=http://localhost:3000/mcp', 'Add HTTP server'],
                ['$0 mcp add tagged --type=stdio --command=echo --tags=dev,test', 'Add server with tags'],
                [
                  '$0 mcp add custom --type=stdio --command=python --env=PATH=/custom/path --disabled',
                  'Add disabled server with custom env',
                ],
              ]);
          },
          handler: async (argv) => {
            const { addCommand } = await import('./add.js');
            await addCommand(argv);
          },
        })
        .command({
          command: 'remove <name>',
          describe: 'Remove an MCP server from the configuration',
          builder: (yargs) => {
            return yargs
              .positional('name', {
                describe: 'Name of the MCP server to remove',
                type: 'string',
                demandOption: true,
              })
              .option('config', {
                describe: 'Path to the config file',
                type: 'string',
                alias: 'c',
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
          },
          handler: async (argv) => {
            const { removeCommand } = await import('./remove.js');
            await removeCommand(argv);
          },
        })
        .command({
          command: 'update <name>',
          describe: 'Update an existing MCP server configuration',
          builder: (yargs) => {
            return yargs
              .positional('name', {
                describe: 'Name of the MCP server to update',
                type: 'string',
                demandOption: true,
              })
              .option('config', {
                describe: 'Path to the config file',
                type: 'string',
                alias: 'c',
              })
              .option('type', {
                describe: 'Transport type for the server',
                type: 'string',
                choices: ['stdio', 'http', 'sse'],
              })
              .option('command', {
                describe: 'Command to execute (stdio only)',
                type: 'string',
              })
              .option('args', {
                describe: 'Arguments for the command (stdio only)',
                type: 'array',
                string: true,
              })
              .option('url', {
                describe: 'URL for HTTP/SSE servers',
                type: 'string',
                alias: 'u',
              })
              .option('env', {
                describe: 'Environment variables in key=value format',
                type: 'array',
                string: true,
                alias: 'e',
              })
              .option('tags', {
                describe: 'Tags for categorization (comma-separated)',
                type: 'string',
                alias: 'g',
              })
              .option('timeout', {
                describe: 'Connection timeout in milliseconds',
                type: 'number',
              })
              .option('cwd', {
                describe: 'Working directory for stdio servers',
                type: 'string',
              })
              .option('headers', {
                describe: 'HTTP headers in key=value format (HTTP/SSE only)',
                type: 'array',
                string: true,
              })
              .example([
                ['$0 mcp update myserver --tags=prod,api', 'Update server tags'],
                ['$0 mcp update myserver --env=NODE_ENV=production', 'Update environment'],
                ['$0 mcp update myserver --timeout=10000', 'Update timeout'],
              ]);
          },
          handler: async (argv) => {
            const { updateCommand } = await import('./update.js');
            await updateCommand(argv);
          },
        })
        .command({
          command: 'enable <name>',
          describe: 'Enable a disabled MCP server',
          builder: (yargs) => {
            return yargs
              .positional('name', {
                describe: 'Name of the MCP server to enable',
                type: 'string',
                demandOption: true,
              })
              .option('config', {
                describe: 'Path to the config file',
                type: 'string',
                alias: 'c',
              })
              .example([['$0 mcp enable myserver', 'Enable a disabled server']]);
          },
          handler: async (argv) => {
            const { enableCommand } = await import('./enable.js');
            await enableCommand(argv);
          },
        })
        .command({
          command: 'disable <name>',
          describe: 'Disable an MCP server without removing it',
          builder: (yargs) => {
            return yargs
              .positional('name', {
                describe: 'Name of the MCP server to disable',
                type: 'string',
                demandOption: true,
              })
              .option('config', {
                describe: 'Path to the config file',
                type: 'string',
                alias: 'c',
              })
              .example([['$0 mcp disable myserver', 'Disable a server temporarily']]);
          },
          handler: async (argv) => {
            const { disableCommand } = await import('./enable.js');
            await disableCommand(argv);
          },
        })
        .command({
          command: 'list',
          describe: 'List all configured MCP servers',
          builder: (yargs) => {
            return yargs
              .option('config', {
                describe: 'Path to the config file',
                type: 'string',
                alias: 'c',
              })
              .option('show-disabled', {
                describe: 'Include disabled servers in the list',
                type: 'boolean',
                default: false,
              })
              .option('tags', {
                describe: 'Filter servers by tags (comma-separated)',
                type: 'string',
                alias: 'g',
              })
              .option('verbose', {
                describe: 'Show detailed server configuration',
                type: 'boolean',
                default: false,
                alias: 'v',
              })
              .example([
                ['$0 mcp list', 'List all enabled servers'],
                ['$0 mcp list --show-disabled', 'List all servers including disabled'],
                ['$0 mcp list --tags=prod,api', 'List servers with specific tags'],
                ['$0 mcp list --verbose', 'List servers with detailed config'],
              ]);
          },
          handler: async (argv) => {
            const { listCommand } = await import('./list.js');
            await listCommand(argv);
          },
        })
        .command({
          command: 'status [name]',
          describe: 'Show status and details of MCP servers',
          builder: (yargs) => {
            return yargs
              .positional('name', {
                describe: 'Name of specific server to check (optional)',
                type: 'string',
              })
              .option('config', {
                describe: 'Path to the config file',
                type: 'string',
                alias: 'c',
              })
              .option('verbose', {
                describe: 'Show detailed status information',
                type: 'boolean',
                default: false,
                alias: 'v',
              })
              .example([
                ['$0 mcp status', 'Show status of all servers'],
                ['$0 mcp status myserver', 'Show status of specific server'],
                ['$0 mcp status --verbose', 'Show detailed status information'],
              ]);
          },
          handler: async (argv) => {
            const { statusCommand } = await import('./status.js');
            await statusCommand(argv);
          },
        })
        .demandCommand(1, 'You must specify a subcommand')
        .help().epilogue(`
MCP Command Group - MCP Server Configuration Management

The mcp command group helps you manage MCP server configurations in your 1mcp instance.

This allows you to:
• Add new MCP servers with various transport types (stdio, HTTP, SSE)
• Remove servers you no longer need
• Update server configurations including environment variables and tags
• Enable/disable servers without removing them
• List and filter servers by tags or status
• Check the status and details of configured servers

For more information about each command, use: $0 mcp <command> --help
        `);
    },
    () => {
      // This handler runs when 'mcp' is called without a subcommand
      console.log('Please specify a subcommand. Use --help for available commands.');
      process.exit(1);
    },
  );
}
