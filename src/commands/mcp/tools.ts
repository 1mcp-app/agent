import { getDisabledTools, withToolDisabledState } from '@src/core/server/disabledTools.js';
import { GlobalOptions, globalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

import {
  backupConfig,
  getAllServers,
  getServer,
  initializeConfigContext,
  reloadMcpConfig,
  serverExists,
  setServer,
  validateConfigPath,
} from './utils/mcpServerConfig.js';
import { validateServerName } from './utils/validation.js';

interface ToolCommandBaseArgs extends GlobalOptions {
  server: string;
  tool: string;
}

interface ToolListCommandArgs extends GlobalOptions {
  server?: string;
  disabled?: boolean;
}

function validateToolName(toolName: string): void {
  if (!toolName.trim()) {
    throw new Error('Tool name cannot be empty.');
  }
}

function printVerificationStep(serverName: string): void {
  printer.info(`Next: run '1mcp mcp tools list ${serverName} --disabled' to verify the current disabled tools.`);
}

async function listToolsCommand(argv: ToolListCommandArgs): Promise<void> {
  try {
    const { config: configPath, 'config-dir': configDir, server, disabled = false } = argv;

    initializeConfigContext(configPath, configDir);
    validateConfigPath();

    if (server) {
      validateServerName(server);
      if (!serverExists(server)) {
        throw new Error(`Server '${server}' does not exist. Use 'mcp add' to create it first.`);
      }
    }

    const allServers = getAllServers();
    const targetServerEntries = Object.entries(allServers)
      .filter(([serverName]) => !server || serverName === server)
      .sort(([left], [right]) => left.localeCompare(right));

    if (targetServerEntries.length === 0) {
      printer.info('No MCP servers are configured.');
      return;
    }

    printer.title('Disabled MCP Tools');
    printer.blank();
    printer.info('This command is config-only. It does not connect to live MCP servers.');
    printer.blank();

    let serversWithDisabledTools = 0;
    let totalDisabledTools = 0;

    for (const [serverName, serverConfig] of targetServerEntries) {
      const disabledTools = getDisabledTools(serverConfig);
      const status = serverConfig.disabled ? 'server disabled' : 'server enabled';

      if (disabledTools.length > 0) {
        serversWithDisabledTools += 1;
        totalDisabledTools += disabledTools.length;
      }

      printer.subtitle(serverName);
      printer.keyValue({
        Status: status,
        'Disabled tools': disabledTools.length,
      });

      if (disabled) {
        if (disabledTools.length === 0) {
          printer.info('No disabled tools configured.');
        } else {
          printer.list(disabledTools);
        }
      }

      printer.blank();
    }

    printer.subtitle('Summary');
    printer.keyValue({
      Servers: targetServerEntries.length,
      'Servers with disabled tools': serversWithDisabledTools,
      'Total disabled tools': totalDisabledTools,
    });
  } catch (error) {
    printer.error(`Failed to list disabled tools: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

async function disableToolCommand(argv: ToolCommandBaseArgs): Promise<void> {
  try {
    const { config: configPath, 'config-dir': configDir, server, tool } = argv;

    initializeConfigContext(configPath, configDir);
    validateConfigPath();
    validateServerName(server);
    validateToolName(tool);

    if (!serverExists(server)) {
      throw new Error(`Server '${server}' does not exist. Use 'mcp add' to create it first.`);
    }

    const currentConfig = getServer(server);
    if (!currentConfig) {
      throw new Error(`Failed to retrieve server '${server}' configuration.`);
    }

    const disabledTools = getDisabledTools(currentConfig);
    if (disabledTools.includes(tool.trim())) {
      printer.info(`Tool '${tool}' is already disabled on server '${server}'.`);
      printVerificationStep(server);
      return;
    }

    const backupPath = backupConfig();
    const nextConfig = withToolDisabledState(currentConfig, tool, true);
    setServer(server, nextConfig);
    reloadMcpConfig();

    printer.success(`Successfully disabled tool '${tool}' on server '${server}'`);
    printer.keyValue({
      Status: 'Enabled → Disabled',
      'Backup created': backupPath,
      Mode: 'Config-only',
    });
    printer.blank();
    printVerificationStep(server);
  } catch (error) {
    printer.error(`Failed to disable tool: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

async function enableToolCommand(argv: ToolCommandBaseArgs): Promise<void> {
  try {
    const { config: configPath, 'config-dir': configDir, server, tool } = argv;

    initializeConfigContext(configPath, configDir);
    validateConfigPath();
    validateServerName(server);
    validateToolName(tool);

    if (!serverExists(server)) {
      throw new Error(`Server '${server}' does not exist. Use 'mcp add' to create it first.`);
    }

    const currentConfig = getServer(server);
    if (!currentConfig) {
      throw new Error(`Failed to retrieve server '${server}' configuration.`);
    }

    const disabledTools = getDisabledTools(currentConfig);
    if (!disabledTools.includes(tool.trim())) {
      printer.info(`Tool '${tool}' is already enabled on server '${server}'.`);
      printVerificationStep(server);
      return;
    }

    const backupPath = backupConfig();
    const nextConfig = withToolDisabledState(currentConfig, tool, false);
    setServer(server, nextConfig);
    reloadMcpConfig();

    printer.success(`Successfully enabled tool '${tool}' on server '${server}'`);
    printer.keyValue({
      Status: 'Disabled → Enabled',
      'Backup created': backupPath,
      Mode: 'Config-only',
    });
    printer.blank();
    printVerificationStep(server);
  } catch (error) {
    printer.error(`Failed to enable tool: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

export function setupMcpToolsCommands(yargs: Argv): Argv {
  return yargs.command(
    'tools',
    'Manage per-server disabled tool lists',
    (toolsYargs) => {
      return toolsYargs
        .options(globalOptions || {})
        .command(
          'list [server]',
          'List disabled tools by server (config-only)',
          (listYargs) =>
            listYargs
              .positional('server', {
                describe: 'Optional server name to inspect',
                type: 'string',
              })
              .option('disabled', {
                describe: 'Show the full disabled tool names instead of counts only',
                type: 'boolean',
                default: false,
              })
              .example([
                ['$0 mcp tools list', 'Show disabled tool counts for all servers'],
                ['$0 mcp tools list filesystem --disabled', 'Show disabled tool names for one server'],
              ]),
          async (argv) => {
            await listToolsCommand(argv as ToolListCommandArgs);
          },
        )
        .command(
          'disable <server> <tool>',
          'Disable one tool for a configured MCP server (config-only)',
          (disableYargs) =>
            disableYargs
              .positional('server', {
                describe: 'Name of the MCP server to update',
                type: 'string',
                demandOption: true,
              })
              .positional('tool', {
                describe: 'Exact tool name to disable',
                type: 'string',
                demandOption: true,
              })
              .example([['$0 mcp tools disable filesystem write_file', 'Disable one noisy tool in config']]),
          async (argv) => {
            await disableToolCommand(argv as ToolCommandBaseArgs);
          },
        )
        .command(
          'enable <server> <tool>',
          'Enable one previously disabled tool for a configured MCP server (config-only)',
          (enableYargs) =>
            enableYargs
              .positional('server', {
                describe: 'Name of the MCP server to update',
                type: 'string',
                demandOption: true,
              })
              .positional('tool', {
                describe: 'Exact tool name to enable',
                type: 'string',
                demandOption: true,
              })
              .example([['$0 mcp tools enable filesystem write_file', 'Re-enable one disabled tool in config']]),
          async (argv) => {
            await enableToolCommand(argv as ToolCommandBaseArgs);
          },
        )
        .demandCommand(1, 'You must specify a tools subcommand')
        .help()
        .epilogue(
          [
            'MCP Tools Commands',
            '',
            'These commands are config-only. They update disabledTools in mcp.json and do not connect to live servers.',
            "Use '1mcp mcp tools list <server> --disabled' after each mutation to verify the current state.",
          ].join('\n'),
        );
    },
    () => {
      printer.info("Use '1mcp mcp tools --help' to see available tool-management commands.");
    },
  );
}
