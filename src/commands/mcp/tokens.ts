import type { Arguments, Argv } from 'yargs';
import chalk from 'chalk';
import boxen from 'boxen';
import logger from '../../logger/logger.js';
import { TokenEstimationService, type ServerTokenEstimate } from '../../services/tokenEstimationService.js';
import { TagQueryParser, type TagExpression } from '../../utils/tagQueryParser.js';
import { loadConfig, type ServerConfig, initializeConfigContext } from './utils/configUtils.js';
import type { MCPServerParams } from '../../core/types/index.js';
import { GlobalOptions } from '../../globalOptions.js';
import { McpConnectionHelper } from './utils/connectionHelper.js';
import { PresetManager } from '../../utils/presetManager.js';
import { TagQueryEvaluator } from '../../utils/tagQueryEvaluator.js';

interface TokensCommandArgs extends GlobalOptions {
  'tag-filter'?: string;
  preset?: string;
  format?: string; // Will be validated at runtime
  model?: string;
  verbose?: boolean;
}

/**
 * Build the tokens command configuration
 */
export function buildTokensCommand(yargs: Argv) {
  return yargs
    .option('preset', {
      describe: 'Use preset filter instead of manual tag expression',
      type: 'string',
      alias: 'p',
    })
    .option('tag-filter', {
      describe: 'Filter servers by advanced tag expression (and/or/not logic)',
      type: 'string',
      alias: 'f',
    })
    .option('format', {
      describe: 'Output format',
      type: 'string',
      choices: ['table', 'json', 'summary'],
      default: 'table',
    })
    .option('model', {
      describe: 'Model to use for token estimation',
      type: 'string',
      alias: 'm',
      default: 'gpt-4o',
    })
    .option('verbose', {
      describe: 'Show server logs and connection details',
      type: 'boolean',
      alias: 'v',
      default: false,
    })
    .conflicts('preset', 'tag-filter')
    .example([
      ['$0 mcp tokens', 'Estimate tokens for all MCP servers by connecting to them'],
      ['$0 mcp tokens --preset development', 'Use development preset for token estimation'],
      ['$0 mcp tokens --preset prod --format=json', 'Production preset with JSON output'],
      ['$0 mcp tokens --tag-filter="context7 or playwright"', 'Estimate tokens for servers with specific tags'],
      ['$0 mcp tokens --format=json', 'Output in JSON format for programmatic use'],
      ['$0 mcp tokens --format=summary', 'Show concise summary'],
      ['$0 mcp tokens --model=gpt-3.5-turbo', 'Use gpt-3.5-turbo for token estimation'],
      ['$0 mcp tokens --tag-filter="ai and not experimental" --format=table', 'Filter and format output'],
      ['$0 mcp tokens --verbose', 'Show server logs and connection details'],
    ]);
}

/**
 * Format output in table format
 */
function formatTableOutput(estimates: ServerTokenEstimate[], stats: any): void {
  const title = `MCP Server Token Estimates${
    estimates.length > 0 && estimates.some((e) => e.connected) ? ` (${stats.connectedServers} connected servers)` : ''
  }`;

  console.log(
    boxen(chalk.bold.blue(title), {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'blue',
    }),
  );

  if (estimates.length === 0) {
    console.log(chalk.yellow('⚠️  No MCP servers found in configuration.'));
    return;
  }

  const connectedEstimates = estimates.filter((est) => est.connected && !est.error);

  if (connectedEstimates.length === 0) {
    console.log(chalk.red('❌ No connected MCP servers found.'));
    estimates.forEach((est) => {
      if (est.error) {
        console.log(chalk.red(`  ${est.serverName} (Disconnected): ${est.error}`));
      } else {
        console.log(chalk.gray(`  ${est.serverName} (Disconnected)`));
      }
    });
    return;
  }

  // Group by capability type
  const hasTools = connectedEstimates.some((est) => est.breakdown.tools.length > 0);
  const hasResources = connectedEstimates.some((est) => est.breakdown.resources.length > 0);
  const hasPrompts = connectedEstimates.some((est) => est.breakdown.prompts.length > 0);

  // TOOLS section
  if (hasTools) {
    console.log(chalk.bold.green('\n🔧 TOOLS'));
    console.log(chalk.gray('─'.repeat(50)));
    connectedEstimates.forEach((est) => {
      if (est.breakdown.tools.length > 0) {
        console.log(chalk.cyan(`${est.serverName} ${chalk.green('(Connected)')}`));
        est.breakdown.tools.forEach((tool) => {
          const desc = tool.description ? chalk.gray(` - ${tool.description.slice(0, 50)}...`) : '';
          console.log(`├── ${chalk.white(tool.name)}: ${chalk.yellow(`~${tool.tokens} tokens`)}${desc}`);
        });
        const toolTotal = est.breakdown.tools.reduce((sum, tool) => sum + tool.tokens, 0);
        console.log(`└── ${chalk.bold(`Subtotal: ~${toolTotal} tokens`)}`);
        console.log();
      }
    });

    const totalToolTokens = connectedEstimates.reduce(
      (sum, est) => sum + est.breakdown.tools.reduce((toolSum, tool) => toolSum + tool.tokens, 0),
      0,
    );
    console.log(chalk.bold.green(`Tools Total: ~${totalToolTokens} tokens`));
    console.log();
  }

  // RESOURCES section
  if (hasResources) {
    console.log(chalk.bold.magenta('\n📁 RESOURCES'));
    console.log(chalk.gray('─'.repeat(50)));
    connectedEstimates.forEach((est) => {
      if (est.breakdown.resources.length > 0) {
        console.log(chalk.cyan(`${est.serverName} ${chalk.green('(Connected)')}`));
        est.breakdown.resources.forEach((resource) => {
          const name = resource.name || resource.uri.split('/').pop() || 'unnamed';
          const mimeType = resource.mimeType ? chalk.gray(` (${resource.mimeType})`) : '';
          console.log(`├── ${chalk.white(name)}: ${chalk.yellow(`~${resource.tokens} tokens`)}${mimeType}`);
        });
        const resourceTotal = est.breakdown.resources.reduce((sum, resource) => sum + resource.tokens, 0);
        console.log(`└── ${chalk.bold(`Subtotal: ~${resourceTotal} tokens`)}`);
        console.log();
      }
    });

    const totalResourceTokens = connectedEstimates.reduce(
      (sum, est) => sum + est.breakdown.resources.reduce((resSum, resource) => resSum + resource.tokens, 0),
      0,
    );
    console.log(chalk.bold.magenta(`Resources Total: ~${totalResourceTokens} tokens`));
    console.log();
  }

  // PROMPTS section
  if (hasPrompts) {
    console.log(chalk.bold.blue('\n💬 PROMPTS'));
    console.log(chalk.gray('─'.repeat(50)));
    connectedEstimates.forEach((est) => {
      if (est.breakdown.prompts.length > 0) {
        console.log(chalk.cyan(`${est.serverName} ${chalk.green('(Connected)')}`));
        est.breakdown.prompts.forEach((prompt) => {
          const desc = prompt.description ? chalk.gray(` - ${prompt.description}`) : '';
          console.log(`├── ${chalk.white(prompt.name)}: ${chalk.yellow(`~${prompt.tokens} tokens`)}${desc}`);
        });
        const promptTotal = est.breakdown.prompts.reduce((sum, prompt) => sum + prompt.tokens, 0);
        console.log(`└── ${chalk.bold(`Subtotal: ~${promptTotal} tokens`)}`);
        console.log();
      }
    });

    const totalPromptTokens = connectedEstimates.reduce(
      (sum, est) => sum + est.breakdown.prompts.reduce((promptSum, prompt) => promptSum + prompt.tokens, 0),
      0,
    );
    console.log(chalk.bold.blue(`Prompts Total: ~${totalPromptTokens} tokens`));
    console.log();
  }

  // SUMMARY section
  const serverNames = connectedEstimates.map((est) => est.serverName).join(', ');
  const summaryContent = [
    `${chalk.green('✅ Servers:')} ${stats.connectedServers} connected (${chalk.cyan(serverNames)})`,
    `${chalk.green('🔧 Total Tools:')} ${stats.totalTools} (~${connectedEstimates.reduce(
      (sum, est) => sum + est.breakdown.tools.reduce((toolSum, tool) => toolSum + tool.tokens, 0),
      0,
    )} tokens)`,
    `${chalk.magenta('📁 Total Resources:')} ${stats.totalResources} (~${connectedEstimates.reduce(
      (sum, est) => sum + est.breakdown.resources.reduce((resSum, resource) => resSum + resource.tokens, 0),
      0,
    )} tokens)`,
    `${chalk.blue('💬 Total Prompts:')} ${stats.totalPrompts} (~${connectedEstimates.reduce(
      (sum, est) => sum + est.breakdown.prompts.reduce((promptSum, prompt) => promptSum + prompt.tokens, 0),
      0,
    )} tokens)`,
    '',
    `${chalk.gray('🔄 Server Overhead:')} ~${connectedEstimates.reduce((sum, est) => sum + est.breakdown.serverOverhead, 0)} tokens`,
    `${chalk.bold.yellow('📊 Overall Total:')} ${chalk.bold.yellow(`~${stats.overallTokens} tokens`)}`,
  ].join('\n');

  console.log(
    boxen(summaryContent, {
      title: '📈 Summary',
      titleAlignment: 'center',
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'yellow',
    }),
  );

  // Show disconnected servers if any
  const disconnectedServers = estimates.filter((est) => !est.connected || est.error);
  if (disconnectedServers.length > 0) {
    const disconnectedContent = disconnectedServers
      .map((est) => {
        if (est.error) {
          return `${chalk.red('❌')} ${est.serverName}: ${chalk.red(est.error)}`;
        } else {
          return `${chalk.gray('⚪')} ${est.serverName}: ${chalk.gray('Not connected')}`;
        }
      })
      .join('\n');

    console.log(
      boxen(disconnectedContent, {
        title: '⚠️  Disconnected Servers',
        titleAlignment: 'center',
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'red',
      }),
    );
  }
}

/**
 * Format output in JSON format
 */
function formatJsonOutput(estimates: ServerTokenEstimate[], stats: any): void {
  const output = {
    summary: stats,
    servers: estimates,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Format output in summary format
 */
function formatSummaryOutput(estimates: ServerTokenEstimate[], stats: any): void {
  const summaryContent = [
    `${chalk.green('✅ Connected Servers:')} ${chalk.bold(`${stats.connectedServers}/${stats.totalServers}`)}`,
    `${chalk.blue('📊 Total Capabilities:')} ${chalk.bold(stats.totalTools + stats.totalResources + stats.totalPrompts)}`,
    `   ${chalk.green('🔧 Tools:')} ${stats.totalTools}`,
    `   ${chalk.magenta('📁 Resources:')} ${stats.totalResources}`,
    `   ${chalk.blue('💬 Prompts:')} ${stats.totalPrompts}`,
    `${chalk.yellow('🏷️  Estimated Token Usage:')} ${chalk.bold.yellow(`~${stats.overallTokens} tokens`)}`,
  ].join('\n');

  console.log(
    boxen(summaryContent, {
      title: '📈 MCP Token Usage Summary',
      titleAlignment: 'center',
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
    }),
  );

  if (stats.connectedServers > 0) {
    const sortedServers = Object.entries(stats.serverBreakdown)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5);

    const topServersContent = sortedServers
      .map(
        ([serverName, tokens]) => `${chalk.cyan('•')} ${chalk.white(serverName)}: ${chalk.yellow(`~${tokens} tokens`)}`,
      )
      .join('\n');

    console.log(
      boxen(topServersContent, {
        title: '🏆 Top Servers by Token Usage',
        titleAlignment: 'center',
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'green',
      }),
    );
  }

  // Show disconnected servers with error details if any
  const disconnectedServers = estimates.filter((est) => !est.connected || est.error);
  if (disconnectedServers.length > 0) {
    let disconnectedContent = `${chalk.yellow('⚠️')} ${chalk.bold(`${disconnectedServers.length} server(s) not connected`)}`;

    if (disconnectedServers.some((est) => est.error)) {
      disconnectedContent += '\n\n' + chalk.red('❌ Errors:');
      disconnectedServers
        .filter((est) => est.error)
        .forEach((est) => {
          disconnectedContent += `\n${chalk.red('  •')} ${chalk.white(est.serverName)}: ${chalk.red(est.error)}`;
        });
    }

    console.log(
      boxen(disconnectedContent, {
        title: '⚠️  Connection Issues',
        titleAlignment: 'center',
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'yellow',
      }),
    );
  }
}

/**
 * Connect to MCP servers and collect their capabilities for token estimation
 */
async function collectServerCapabilities(
  serverConfigs: Array<{ name: string } & MCPServerParams>,
  model?: string,
  suppressLogs?: boolean,
): Promise<ServerTokenEstimate[]> {
  const tokenService = new TokenEstimationService(model);
  const connectionHelper = new McpConnectionHelper();

  try {
    logger.debug(`Connecting to ${serverConfigs.length} MCP servers for capability discovery`);

    // Convert to server configuration format expected by connection helper
    const servers: Record<string, MCPServerParams> = {};
    for (const config of serverConfigs) {
      const { name, ...serverParams } = config;
      // Apply quiet mode to stdio servers by redirecting stderr and stdout
      if (suppressLogs && serverParams.type === 'stdio') {
        serverParams.stderr = 'ignore';
        // Some servers output logs to stdout, so we need to handle that too
        // but we can't completely ignore stdout as we need it for MCP communication
        // Instead, we'll modify the environment to suppress verbose logging
        if (!serverParams.env || Array.isArray(serverParams.env)) {
          serverParams.env = {};
        }
        // Set common environment variables that suppress verbose logging
        const envRecord = serverParams.env as Record<string, string>;
        envRecord.QUIET = '1';
        envRecord.SILENT = '1';
        envRecord.LOG_LEVEL = 'error';
        envRecord.NODE_ENV = 'production';
      }
      servers[name] = serverParams;
    }

    // Connect to all servers and get their capabilities
    // Use shorter timeout for tests to improve performance
    const timeout = process.env.NODE_ENV === 'test' ? 500 : 15000; // 0.5s for tests, 15s for normal use
    const serverCapabilities = await connectionHelper.connectToServers(servers, timeout);

    // Convert server capabilities to token estimates
    const estimates: ServerTokenEstimate[] = serverCapabilities.map((capability) => {
      return tokenService.estimateServerTokens(
        capability.serverName,
        capability.tools,
        capability.resources,
        capability.prompts,
        capability.connected,
      );
    });

    return estimates;
  } catch (error) {
    logger.error('Error collecting server capabilities:', error);
    throw error;
  } finally {
    // Clean up connections
    await connectionHelper.cleanup();
    tokenService.dispose();
  }
}

/**
 * Tokens command handler
 */
export async function tokensCommand(argv: Arguments<TokensCommandArgs>): Promise<void> {
  try {
    logger.debug('Starting tokens command with args:', argv);

    // Initialize config context with CLI options
    initializeConfigContext(argv.config, argv['config-dir']);

    // Load MCP configuration using utility function
    const config: ServerConfig = loadConfig();

    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
      console.log(chalk.yellow('⚠️  No MCP servers configured.'));
      console.log(chalk.gray('💡 Use "1mcp mcp add" to add servers.'));
      return;
    }

    // Parse tag filter or preset if provided
    let tagExpression: TagExpression | undefined;
    let filteredServers = Object.entries(config.mcpServers);
    let filterDescription = '';

    if (argv.preset) {
      try {
        // Load preset using PresetManager
        const presetManager = PresetManager.getInstance(argv['config-dir']);
        await presetManager.initialize();

        const preset = presetManager.getPreset(argv.preset);
        if (!preset) {
          console.error(chalk.red(`❌ Preset not found: ${argv.preset}`));
          console.error(
            chalk.gray('Available presets:'),
            chalk.cyan(presetManager.getPresetNames().join(', ') || 'none'),
          );
          process.exit(1);
        }

        logger.debug('Using preset for token estimation:', preset.name);
        filterDescription = `preset "${argv.preset}"`;

        // Filter servers based on preset's TagQuery
        filteredServers = filteredServers.filter(([_name, serverConfig]) => {
          const serverTags = (serverConfig as MCPServerParams).tags || [];
          return TagQueryEvaluator.evaluate(preset.tagQuery, serverTags);
        });
      } catch (error) {
        console.error(
          chalk.red(
            `❌ Error loading preset "${argv.preset}": ${error instanceof Error ? error.message : 'Unknown error'}`,
          ),
        );
        process.exit(1);
      }
    } else if (argv['tag-filter']) {
      try {
        tagExpression = TagQueryParser.parseAdvanced(argv['tag-filter']);
        logger.debug('Parsed tag filter expression:', tagExpression);
        filterDescription = `tag filter "${argv['tag-filter']}"`;

        // Filter servers based on tag expression
        filteredServers = filteredServers.filter(([_name, serverConfig]) => {
          const serverTags = (serverConfig as MCPServerParams).tags || [];
          return TagQueryParser.evaluate(tagExpression!, serverTags);
        });
      } catch (error) {
        console.error(
          chalk.red(`❌ Invalid tag-filter expression: ${error instanceof Error ? error.message : 'Unknown error'}`),
        );
        process.exit(1);
      }
    }

    if (filteredServers.length === 0) {
      console.log(
        filterDescription
          ? chalk.yellow(`⚠️  No servers match the ${filterDescription}`)
          : chalk.yellow('⚠️  No servers found in configuration.'),
      );
      return;
    }

    // Convert to config objects for processing, excluding disabled servers
    const serverConfigs = filteredServers
      .filter(([_name, serverConfig]) => !(serverConfig as MCPServerParams).disabled)
      .map(([name, serverConfig]) => ({
        name,
        ...(serverConfig as MCPServerParams),
      }));

    if (serverConfigs.length === 0) {
      console.log(chalk.yellow('⚠️  No enabled servers found for token estimation.'));
      return;
    }

    // Suppress logs by default, unless verbose is explicitly requested
    const suppressLogs = !argv.verbose;

    // Only show connecting message for non-JSON formats and when not suppressing logs
    const format = argv.format || 'table';
    if (format !== 'json' && !suppressLogs) {
      console.log(chalk.blue(`🔄 Connecting to ${serverConfigs.length} MCP server(s) to analyze token usage...`));
    }

    // Collect server capabilities and estimate tokens
    const estimates = await collectServerCapabilities(serverConfigs, argv.model, suppressLogs);

    // Calculate aggregate statistics
    const tokenService = new TokenEstimationService(argv.model);
    const stats = tokenService.calculateAggregateStats(estimates);
    tokenService.dispose();

    // Format and display output
    switch (format) {
      case 'json':
        formatJsonOutput(estimates, stats);
        break;
      case 'summary':
        formatSummaryOutput(estimates, stats);
        break;
      case 'table':
      default:
        formatTableOutput(estimates, stats);
        break;
    }
  } catch (error) {
    logger.error('Error in tokens command:', error);
    console.error(chalk.red(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
    process.exit(1);
  }
}
