import type { Arguments } from 'yargs';
import logger from '../../logger/logger.js';
import { TokenEstimationService, type ServerTokenEstimate } from '../../services/tokenEstimationService.js';
import { TagQueryParser, type TagExpression } from '../../utils/tagQueryParser.js';
import { loadConfig, type ServerConfig } from './utils/configUtils.js';
import type { MCPServerParams } from '../../core/types/index.js';
import { McpConnectionHelper } from './utils/connectionHelper.js';

interface TokensCommandArgs {
  config?: string;
  'tag-filter'?: string;
  format?: string; // Will be validated at runtime
  model?: string;
}

/**
 * Format output in table format
 */
function formatTableOutput(estimates: ServerTokenEstimate[], stats: any): void {
  console.log(
    `MCP Server Token Estimates${
      estimates.length > 0 && estimates.some((e) => e.connected) ? ` (${stats.connectedServers} connected servers)` : ''
    }:`,
  );
  console.log();

  if (estimates.length === 0) {
    console.log('No MCP servers found in configuration.');
    return;
  }

  const connectedEstimates = estimates.filter((est) => est.connected && !est.error);

  if (connectedEstimates.length === 0) {
    console.log('No connected MCP servers found.');
    estimates.forEach((est) => {
      if (est.error) {
        console.log(`${est.serverName} (Disconnected): ${est.error}`);
      } else {
        console.log(`${est.serverName} (Disconnected)`);
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
    console.log('=== TOOLS ===');
    connectedEstimates.forEach((est) => {
      if (est.breakdown.tools.length > 0) {
        console.log(`${est.serverName} (Connected):`);
        est.breakdown.tools.forEach((tool) => {
          const desc = tool.description ? ` - ${tool.description.slice(0, 50)}...` : '';
          console.log(`├── ${tool.name}: ~${tool.tokens} tokens${desc}`);
        });
        const toolTotal = est.breakdown.tools.reduce((sum, tool) => sum + tool.tokens, 0);
        console.log(`└── Subtotal: ~${toolTotal} tokens`);
        console.log();
      }
    });

    const totalToolTokens = connectedEstimates.reduce(
      (sum, est) => sum + est.breakdown.tools.reduce((toolSum, tool) => toolSum + tool.tokens, 0),
      0,
    );
    console.log(`Tools Total: ~${totalToolTokens} tokens`);
    console.log();
  }

  // RESOURCES section
  if (hasResources) {
    console.log('=== RESOURCES ===');
    connectedEstimates.forEach((est) => {
      if (est.breakdown.resources.length > 0) {
        console.log(`${est.serverName} (Connected):`);
        est.breakdown.resources.forEach((resource) => {
          const name = resource.name || resource.uri.split('/').pop() || 'unnamed';
          const mimeType = resource.mimeType ? ` (${resource.mimeType})` : '';
          console.log(`├── ${name}: ~${resource.tokens} tokens${mimeType}`);
        });
        const resourceTotal = est.breakdown.resources.reduce((sum, resource) => sum + resource.tokens, 0);
        console.log(`└── Subtotal: ~${resourceTotal} tokens`);
        console.log();
      }
    });

    const totalResourceTokens = connectedEstimates.reduce(
      (sum, est) => sum + est.breakdown.resources.reduce((resSum, resource) => resSum + resource.tokens, 0),
      0,
    );
    console.log(`Resources Total: ~${totalResourceTokens} tokens`);
    console.log();
  }

  // PROMPTS section
  if (hasPrompts) {
    console.log('=== PROMPTS ===');
    connectedEstimates.forEach((est) => {
      if (est.breakdown.prompts.length > 0) {
        console.log(`${est.serverName} (Connected):`);
        est.breakdown.prompts.forEach((prompt) => {
          const desc = prompt.description ? ` - ${prompt.description}` : '';
          console.log(`├── ${prompt.name}: ~${prompt.tokens} tokens${desc}`);
        });
        const promptTotal = est.breakdown.prompts.reduce((sum, prompt) => sum + prompt.tokens, 0);
        console.log(`└── Subtotal: ~${promptTotal} tokens`);
        console.log();
      }
    });

    const totalPromptTokens = connectedEstimates.reduce(
      (sum, est) => sum + est.breakdown.prompts.reduce((promptSum, prompt) => promptSum + prompt.tokens, 0),
      0,
    );
    console.log(`Prompts Total: ~${totalPromptTokens} tokens`);
    console.log();
  }

  // SUMMARY section
  console.log('=== SUMMARY ===');
  const serverNames = connectedEstimates.map((est) => est.serverName).join(', ');
  console.log(`Servers: ${stats.connectedServers} connected (${serverNames})`);
  console.log(
    `Total Tools: ${stats.totalTools} (~${connectedEstimates.reduce(
      (sum, est) => sum + est.breakdown.tools.reduce((toolSum, tool) => toolSum + tool.tokens, 0),
      0,
    )} tokens)`,
  );
  console.log(
    `Total Resources: ${stats.totalResources} (~${connectedEstimates.reduce(
      (sum, est) => sum + est.breakdown.resources.reduce((resSum, resource) => resSum + resource.tokens, 0),
      0,
    )} tokens)`,
  );
  console.log(
    `Total Prompts: ${stats.totalPrompts} (~${connectedEstimates.reduce(
      (sum, est) => sum + est.breakdown.prompts.reduce((promptSum, prompt) => promptSum + prompt.tokens, 0),
      0,
    )} tokens)`,
  );

  const totalOverhead = connectedEstimates.reduce((sum, est) => sum + est.breakdown.serverOverhead, 0);
  console.log(`Server Overhead: ~${totalOverhead} tokens`);
  console.log(`Overall Total: ~${stats.overallTokens} tokens`);

  // Show disconnected servers if any
  const disconnectedServers = estimates.filter((est) => !est.connected || est.error);
  if (disconnectedServers.length > 0) {
    console.log();
    console.log('=== DISCONNECTED SERVERS ===');
    disconnectedServers.forEach((est) => {
      if (est.error) {
        console.log(`${est.serverName}: ${est.error}`);
      } else {
        console.log(`${est.serverName}: Not connected`);
      }
    });
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
  console.log(`MCP Token Usage Summary:`);
  console.log(`  Connected Servers: ${stats.connectedServers}/${stats.totalServers}`);
  console.log(`  Total Capabilities: ${stats.totalTools + stats.totalResources + stats.totalPrompts}`);
  console.log(`    - Tools: ${stats.totalTools}`);
  console.log(`    - Resources: ${stats.totalResources}`);
  console.log(`    - Prompts: ${stats.totalPrompts}`);
  console.log(`  Estimated Token Usage: ~${stats.overallTokens} tokens`);

  if (stats.connectedServers > 0) {
    console.log(`  Top Servers by Token Usage:`);
    const sortedServers = Object.entries(stats.serverBreakdown)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5);

    sortedServers.forEach(([serverName, tokens]) => {
      console.log(`    - ${serverName}: ~${tokens} tokens`);
    });
  }

  // Show disconnected servers with error details if any
  const disconnectedServers = estimates.filter((est) => !est.connected || est.error);
  if (disconnectedServers.length > 0) {
    console.log(`  Note: ${disconnectedServers.length} server(s) not connected`);
    if (disconnectedServers.some((est) => est.error)) {
      console.log(`  Errors:`);
      disconnectedServers
        .filter((est) => est.error)
        .forEach((est) => {
          console.log(`    - ${est.serverName}: ${est.error}`);
        });
    }
  }
}

/**
 * Connect to MCP servers and collect their capabilities for token estimation
 */
async function collectServerCapabilities(
  serverConfigs: Array<{ name: string } & MCPServerParams>,
  model?: string,
): Promise<ServerTokenEstimate[]> {
  const tokenService = new TokenEstimationService(model);
  const connectionHelper = new McpConnectionHelper();

  try {
    logger.debug(`Connecting to ${serverConfigs.length} MCP servers for capability discovery`);

    // Convert to server configuration format expected by connection helper
    const servers: Record<string, MCPServerParams> = {};
    for (const config of serverConfigs) {
      const { name, ...serverParams } = config;
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

    // Load MCP configuration using utility function
    const config: ServerConfig = loadConfig(argv.config);

    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
      console.log('No MCP servers configured. Use "1mcp mcp add" to add servers.');
      return;
    }

    // Parse tag filter if provided
    let tagExpression: TagExpression | undefined;
    let filteredServers = Object.entries(config.mcpServers);

    if (argv['tag-filter']) {
      try {
        tagExpression = TagQueryParser.parseAdvanced(argv['tag-filter']);
        logger.debug('Parsed tag filter expression:', tagExpression);

        // Filter servers based on tag expression
        filteredServers = filteredServers.filter(([_name, serverConfig]) => {
          const serverTags = (serverConfig as MCPServerParams).tags || [];
          return TagQueryParser.evaluate(tagExpression!, serverTags);
        });
      } catch (error) {
        console.error(`Invalid tag-filter expression: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    }

    if (filteredServers.length === 0) {
      console.log(
        argv['tag-filter']
          ? `No servers match the tag filter: ${argv['tag-filter']}`
          : 'No servers found in configuration.',
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
      console.log('No enabled servers found for token estimation.');
      return;
    }

    // Only show connecting message for non-JSON formats
    const format = argv.format || 'table';
    if (format !== 'json') {
      console.log(`Connecting to ${serverConfigs.length} MCP server(s) to analyze token usage...`);
    }

    // Collect server capabilities and estimate tokens
    const estimates = await collectServerCapabilities(serverConfigs, argv.model);

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
    console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}
