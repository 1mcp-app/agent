import { TokenEstimationService, type ToolTokenInfo } from '@src/application/services/tokenEstimationService.js';
import { McpConnectionHelper } from '@src/commands/mcp/utils/connectionHelper.js';
import { getDisabledTools, withToolDisabledState } from '@src/core/server/disabledTools.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import { GlobalOptions, globalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';

import prompts from 'prompts';
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

interface InteractiveToolsCommandArgs extends GlobalOptions {
  server?: string;
  model?: string;
}

interface PromptChoice {
  title: string;
  value: string;
  selected?: boolean;
  description?: string;
}

interface ToolSelectionState {
  selectedServer: string;
  allToolTokens: ToolTokenInfo[];
  selectedToolNames: string[];
}

interface InteractiveCommandDependencies {
  connectionHelperFactory: () => McpConnectionHelper;
  tokenServiceFactory: (model: string) => TokenEstimationService;
  isInteractiveTerminal: () => boolean;
  prompt: typeof prompts;
}

const DEFAULT_MODEL = 'gpt-4o';

function getInteractiveCommandDependencies(): InteractiveCommandDependencies {
  return {
    connectionHelperFactory: () => new McpConnectionHelper(),
    tokenServiceFactory: (model: string) => new TokenEstimationService(model),
    isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompt: prompts,
  };
}

function validateToolName(toolName: string): void {
  if (!toolName.trim()) {
    throw new Error('Tool name cannot be empty.');
  }
}

function printVerificationStep(serverName: string): void {
  printer.info(`Next: run '1mcp mcp tools list ${serverName} --disabled' to verify the current disabled tools.`);
}

function getSortedServerEntries(server?: string): [string, MCPServerParams][] {
  const allServers = getAllServers();
  return Object.entries(allServers)
    .filter(([serverName]) => !server || serverName === server)
    .sort(([left], [right]) => left.localeCompare(right));
}

function buildServerChoices(servers: [string, MCPServerParams][]): PromptChoice[] {
  return servers.map(([serverName, serverConfig]) => {
    const disabledTools = getDisabledTools(serverConfig);
    const status = serverConfig.disabled ? 'server disabled' : 'server enabled';
    const disabledSuffix = disabledTools.length > 0 ? `, ${disabledTools.length} tools disabled` : '';

    return {
      title: serverName,
      value: serverName,
      description: `${status}${disabledSuffix}`,
    };
  });
}

function buildToolChoices(allToolTokens: ToolTokenInfo[], disabledTools: string[]): PromptChoice[] {
  const disabledSet = new Set(disabledTools);
  return allToolTokens.map((toolInfo) => ({
    title: `${toolInfo.name} (~${toolInfo.tokens} tokens)`,
    value: toolInfo.name,
    selected: !disabledSet.has(toolInfo.name),
    description: toolInfo.description,
  }));
}

function getSortedToolTokens(toolInfos: ToolTokenInfo[]): ToolTokenInfo[] {
  return [...toolInfos].sort((left, right) => {
    if (right.tokens !== left.tokens) {
      return right.tokens - left.tokens;
    }
    return left.name.localeCompare(right.name);
  });
}

function sumToolTokens(toolInfos: ToolTokenInfo[]): number {
  return toolInfos.reduce((sum, toolInfo) => sum + toolInfo.tokens, 0);
}

function formatPercent(savedTokens: number, totalTokensBefore: number): string {
  if (totalTokensBefore <= 0 || savedTokens <= 0) {
    return '0';
  }

  return ((savedTokens / totalTokensBefore) * 100).toFixed(1).replace(/\.0$/, '');
}

function applyToolSelection(
  currentConfig: MCPServerParams,
  allToolNames: string[],
  selectedToolNames: string[],
): MCPServerParams {
  const selectedSet = new Set(selectedToolNames);
  let nextConfig = currentConfig;

  for (const toolName of allToolNames) {
    nextConfig = withToolDisabledState(nextConfig, toolName, !selectedSet.has(toolName));
  }

  return nextConfig;
}

async function selectServer(prompt: typeof prompts, servers: [string, MCPServerParams][]): Promise<string | undefined> {
  const serverChoices = buildServerChoices(servers);
  const result = await prompt({
    type: 'select',
    name: 'server',
    message: 'Select an MCP server to manage tools:',
    choices: serverChoices,
    initial: 0,
  });

  return result.server as string | undefined;
}

async function selectToolsForServer(
  prompt: typeof prompts,
  selectedServer: string,
  serverConfig: MCPServerParams,
  allToolTokens: ToolTokenInfo[],
): Promise<string[] | undefined> {
  if (allToolTokens.length > 30) {
    printer.info(
      `Tip: use '1mcp mcp tools disable ${selectedServer} <tool>' to disable specific tools by name without scrolling.`,
    );
    printer.blank();
  }

  const result = await prompt({
    type: 'multiselect',
    name: 'selected',
    message: `Select enabled tools for '${selectedServer}' (space to toggle, enter to save):`,
    choices: buildToolChoices(allToolTokens, getDisabledTools(serverConfig)),
    hint: '- Space to toggle. Enter to save',
    instructions: false,
  });

  return result.selected as string[] | undefined;
}

async function loadSelectableTools(
  selectedServer: string,
  serverConfig: MCPServerParams,
  tokenService: TokenEstimationService,
  connectionHelperFactory: () => McpConnectionHelper,
): Promise<ToolTokenInfo[]> {
  const connectionHelper = connectionHelperFactory();

  try {
    const [capabilities] = await connectionHelper.connectToServers({ [selectedServer]: serverConfig });
    if (!capabilities?.connected) {
      throw new Error(capabilities?.error || `Failed to connect to server '${selectedServer}'.`);
    }

    const estimate = tokenService.estimateServerTokens(selectedServer, capabilities.tools, [], [], true);
    return getSortedToolTokens(estimate.breakdown.tools);
  } finally {
    await connectionHelper.cleanup();
  }
}

async function resolveToolSelectionState(
  initialServer: string | undefined,
  targetServerEntries: [string, MCPServerParams][],
  dependencies: InteractiveCommandDependencies,
  tokenService: TokenEstimationService,
  enforceSingleServerSelection: boolean,
): Promise<ToolSelectionState | undefined> {
  let selectedServer = initialServer;

  while (selectedServer) {
    const serverConfig = targetServerEntries.find(([serverName]) => serverName === selectedServer)?.[1];
    if (!serverConfig) {
      throw new Error(`Server '${selectedServer}' does not exist. Use 'mcp add' to create it first.`);
    }

    try {
      const allToolTokens = await loadSelectableTools(
        selectedServer,
        serverConfig,
        tokenService,
        dependencies.connectionHelperFactory,
      );

      if (allToolTokens.length === 0) {
        printer.info(`Server '${selectedServer}' does not expose any tools.`);
        return undefined;
      }

      const selectedToolNames = await selectToolsForServer(
        dependencies.prompt,
        selectedServer,
        serverConfig,
        allToolTokens,
      );

      if (selectedToolNames === undefined) {
        printer.info('Operation cancelled.');
        return undefined;
      }

      return {
        selectedServer,
        allToolTokens,
        selectedToolNames,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (enforceSingleServerSelection) {
        throw new Error(message);
      }

      printer.error(`Unable to load tools for '${selectedServer}': ${message}`);
      printer.blank();

      selectedServer = await selectServer(dependencies.prompt, targetServerEntries);
      if (!selectedServer) {
        printer.info('Operation cancelled.');
        return undefined;
      }
    }
  }

  return undefined;
}

function printToolSaveSummary(
  serverName: string,
  allToolTokens: ToolTokenInfo[],
  selectedToolNames: string[],
  changedToolNames: string[],
): void {
  const selectedSet = new Set(selectedToolNames);
  const totalTokensBefore = sumToolTokens(allToolTokens);
  const totalTokensAfter = sumToolTokens(allToolTokens.filter((toolInfo) => selectedSet.has(toolInfo.name)));
  const savedTokens = totalTokensBefore - totalTokensAfter;

  printer.success(`Saved tool selection for server '${serverName}'`);
  printer.keyValue({
    'Changed tools': changedToolNames.length,
    'Tokens before': `~${totalTokensBefore}`,
    'Tokens after': `~${totalTokensAfter}`,
    Saved: `~${savedTokens} tokens per request (${formatPercent(savedTokens, totalTokensBefore)}%)`,
  });
  printer.blank();
  printVerificationStep(serverName);
}

export async function listToolsCommand(argv: ToolListCommandArgs): Promise<void> {
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

    const targetServerEntries = getSortedServerEntries(server);
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

export async function disableToolCommand(argv: ToolCommandBaseArgs): Promise<void> {
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

    const normalizedToolName = tool.trim();
    const disabledTools = getDisabledTools(currentConfig);
    if (disabledTools.includes(normalizedToolName)) {
      printer.info(`Tool '${tool}' is already disabled on server '${server}'.`);
      printVerificationStep(server);
      return;
    }

    const backupPath = backupConfig();
    const nextConfig = withToolDisabledState(currentConfig, normalizedToolName, true);
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

export async function enableToolCommand(argv: ToolCommandBaseArgs): Promise<void> {
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

    const normalizedToolName = tool.trim();
    const disabledTools = getDisabledTools(currentConfig);
    if (!disabledTools.includes(normalizedToolName)) {
      printer.info(`Tool '${tool}' is already enabled on server '${server}'.`);
      printVerificationStep(server);
      return;
    }

    const backupPath = backupConfig();
    const nextConfig = withToolDisabledState(currentConfig, normalizedToolName, false);
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

export async function toolsCommand(
  argv: InteractiveToolsCommandArgs,
  dependencies: InteractiveCommandDependencies = getInteractiveCommandDependencies(),
): Promise<void> {
  try {
    const { config: configPath, 'config-dir': configDir, server, model = DEFAULT_MODEL } = argv;

    initializeConfigContext(configPath, configDir);
    validateConfigPath();

    if (!dependencies.isInteractiveTerminal()) {
      throw new Error(
        'Interactive mode requires a TTY. Use "1mcp mcp tools list|enable|disable" in non-interactive environments.',
      );
    }

    if (server) {
      validateServerName(server);
      if (!serverExists(server)) {
        throw new Error(`Server '${server}' does not exist. Use 'mcp add' to create it first.`);
      }
    }

    const targetServerEntries = getSortedServerEntries(server);
    if (targetServerEntries.length === 0) {
      printer.info('No MCP servers are configured.');
      return;
    }

    const tokenService = dependencies.tokenServiceFactory(model);

    let selectedServer = server;
    if (!selectedServer) {
      selectedServer = await selectServer(dependencies.prompt, targetServerEntries);
      if (!selectedServer) {
        printer.info('Operation cancelled.');
        return;
      }
    }

    const selectionState = await resolveToolSelectionState(
      selectedServer,
      targetServerEntries,
      dependencies,
      tokenService,
      Boolean(server),
    );
    if (!selectionState) {
      return;
    }

    const currentConfig = getServer(selectionState.selectedServer);
    if (!currentConfig) {
      throw new Error(`Failed to retrieve server '${selectionState.selectedServer}' configuration.`);
    }

    const nextConfig = applyToolSelection(
      currentConfig,
      selectionState.allToolTokens.map((toolInfo) => toolInfo.name),
      selectionState.selectedToolNames,
    );

    const currentDisabledTools = getDisabledTools(currentConfig);
    const nextDisabledTools = getDisabledTools(nextConfig);

    if (currentDisabledTools.join('\n') === nextDisabledTools.join('\n')) {
      printer.info(`No tool changes to save for server '${selectionState.selectedServer}'.`);
      printer.blank();
      printVerificationStep(selectionState.selectedServer);
      return;
    }

    const changedToolNames = selectionState.allToolTokens
      .map((toolInfo) => toolInfo.name)
      .filter((toolName) => currentDisabledTools.includes(toolName) !== nextDisabledTools.includes(toolName));

    backupConfig();
    setServer(selectionState.selectedServer, nextConfig);
    reloadMcpConfig();

    printToolSaveSummary(
      selectionState.selectedServer,
      selectionState.allToolTokens,
      selectionState.selectedToolNames,
      changedToolNames,
    );
  } catch (error) {
    printer.error(`Failed to manage tools interactively: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

export function setupMcpToolsCommands(yargs: Argv): Argv {
  return yargs.command(
    'tools',
    'Interactively manage per-server disabled tool lists',
    (toolsYargs) => {
      return toolsYargs
        .options(globalOptions || {})
        .option('server', {
          describe: 'Open the interactive browser directly for one server',
          type: 'string',
        })
        .option('model', {
          describe: 'Model to use for token estimation in interactive mode',
          type: 'string',
          default: DEFAULT_MODEL,
        })
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
          async (commandArgv) => {
            await listToolsCommand(commandArgv as ToolListCommandArgs);
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
          async (commandArgv) => {
            await disableToolCommand(commandArgv as ToolCommandBaseArgs);
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
          async (commandArgv) => {
            await enableToolCommand(commandArgv as ToolCommandBaseArgs);
          },
        )
        .help()
        .epilogue(
          [
            'MCP Tools Commands',
            '',
            "Run '1mcp mcp tools' for the interactive browser with live token estimates.",
            'The list/enable/disable subcommands remain config-only. They update disabledTools in mcp.json and do not connect to live servers.',
            "Use '1mcp mcp tools list <server> --disabled' after each mutation to verify the current state.",
          ].join('\n'),
        );
    },
    async (commandArgv) => {
      await toolsCommand(commandArgv as InteractiveToolsCommandArgs);
    },
  );
}
