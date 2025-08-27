import type { Arguments } from 'yargs';
import logger from '../../logger/logger.js';
import { TokenEstimationService, type ServerTokenEstimate } from '../../services/tokenEstimationService.js';
import { TagQueryParser, type TagExpression } from '../../utils/tagQueryParser.js';
import { loadConfig, type ServerConfig } from './utils/configUtils.js';
import type { MCPServerParams } from '../../core/types/index.js';

interface TokensCommandArgs {
  config?: string;
  'tag-filter'?: string;
  format?: string; // Will be validated at runtime
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
          const desc = tool.description ? ` - ${tool.description}` : '';
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

  const disconnectedCount = stats.totalServers - stats.connectedServers;
  if (disconnectedCount > 0) {
    console.log(`  Note: ${disconnectedCount} server(s) not connected`);
  }
}

/**
 * Mock server capabilities collection for token estimation
 * In a real implementation, this would connect to servers and query their capabilities
 */
async function collectServerCapabilities(
  serverConfigs: Array<{ name: string } & MCPServerParams>,
  _tagExpression?: TagExpression,
): Promise<ServerTokenEstimate[]> {
  const tokenService = new TokenEstimationService();
  const estimates: ServerTokenEstimate[] = [];

  try {
    for (const config of serverConfigs) {
      logger.debug(`Collecting capabilities for server: ${config.name}`);

      try {
        // For now, we'll simulate the capability discovery since we can't easily connect to servers
        // In a full implementation, this would establish temporary connections to query capabilities

        // Mock capabilities based on server configuration hints
        const mockTools: any[] = [];
        const mockResources: any[] = [];
        const mockPrompts: any[] = [];

        // Add some mock capabilities for demonstration
        if (config.tags?.includes('ai') || config.tags?.includes('context7')) {
          mockTools.push({
            name: 'get-library-docs',
            description: 'Get documentation for a library',
            inputSchema: {
              type: 'object' as const,
              properties: {
                library: { type: 'string' as const, description: 'Library name' },
              },
            },
          });
          mockTools.push({
            name: 'resolve-library-id',
            description: 'Resolve library ID',
            inputSchema: {
              type: 'object' as const,
              properties: {
                name: { type: 'string' as const, description: 'Library name' },
              },
            },
          });
        }

        if (config.tags?.includes('playwright') || config.tags?.includes('automation')) {
          mockTools.push({
            name: 'navigate',
            description: 'Navigate to a URL',
            inputSchema: {
              type: 'object' as const,
              properties: {
                url: { type: 'string' as const, description: 'URL to navigate to' },
              },
            },
          });
          mockTools.push({
            name: 'click',
            description: 'Click an element',
            inputSchema: {
              type: 'object' as const,
              properties: {
                selector: { type: 'string' as const, description: 'CSS selector' },
              },
            },
          });
        }

        // Estimate tokens for this server
        const estimate = tokenService.estimateServerTokens(
          config.name,
          mockTools,
          mockResources,
          mockPrompts,
          true, // Assume connected for demonstration
        );

        estimates.push(estimate);
      } catch (error) {
        logger.warn(`Error collecting capabilities for server ${config.name}:`, error);
        estimates.push({
          serverName: config.name,
          connected: false,
          breakdown: {
            tools: [],
            resources: [],
            prompts: [],
            serverOverhead: 75,
            totalTokens: 75,
          },
          error: error instanceof Error ? error.message : 'Connection failed',
        });
      }
    }
  } finally {
    tokenService.dispose();
  }

  return estimates;
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

    // Only show analyzing message for non-JSON formats
    const format = argv.format || 'table';
    if (format !== 'json') {
      console.log(`Analyzing ${serverConfigs.length} MCP server(s) for token estimation...`);
    }

    // Collect server capabilities and estimate tokens
    const estimates = await collectServerCapabilities(serverConfigs, tagExpression);

    // Calculate aggregate statistics
    const tokenService = new TokenEstimationService();
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
