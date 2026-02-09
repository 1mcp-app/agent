import { MCPServerParams } from '@src/core/types/index.js';
import { GlobalOptions } from '@src/globalOptions.js';
import { inferTransportType } from '@src/transport/transportFactory.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

import { getAllServers, getServer, initializeConfigContext, validateConfigPath } from './utils/mcpServerConfig.js';
import { validateServerName } from './utils/validation.js';

export interface StatusCommandArgs extends GlobalOptions {
  name?: string;
  verbose?: boolean;
}

/**
 * Build the status command configuration
 */
export function buildStatusCommand(yargs: Argv) {
  return yargs
    .positional('name', {
      describe: 'Name of specific server to check (optional)',
      type: 'string',
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
}

/**
 * Show status and details of MCP servers
 */
export async function statusCommand(argv: StatusCommandArgs): Promise<void> {
  try {
    const { name, config: configPath, 'config-dir': configDir, verbose = false } = argv;

    // Initialize ConfigContext with CLI options
    initializeConfigContext(configPath, configDir);

    // Validate config path
    validateConfigPath();

    if (name) {
      // Show status for specific server
      await showServerStatus(name, verbose);
    } else {
      // Show status for all servers
      await showAllServersStatus(verbose);
    }
  } catch (error) {
    printer.error(`Failed to get server status: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Show status for a specific server
 */
async function showServerStatus(serverName: string, verbose: boolean = false): Promise<void> {
  // Validate server name
  validateServerName(serverName);

  // Get server configuration
  const serverConfig = getServer(serverName);
  if (!serverConfig) {
    throw new Error(`Server '${serverName}' does not exist.`);
  }

  printer.blank();
  printer.title(`Server Status: ${serverName}`);
  printer.blank();

  displayDetailedServerStatus(serverName, serverConfig, verbose);
}

/**
 * Show status for all servers
 */
async function showAllServersStatus(verbose: boolean = false): Promise<void> {
  const allServers = getAllServers();

  if (Object.keys(allServers).length === 0) {
    printer.info('No MCP servers are configured.');
    printer.info('Use "mcp add <name>" to add your first server.');
    return;
  }

  printer
    .blank()
    .title(
      `MCP Servers Status (${Object.keys(allServers).length} server${Object.keys(allServers).length === 1 ? '' : 's'})`,
    )
    .blank();

  // Sort servers by name for consistent output
  const sortedServerNames = Object.keys(allServers).sort();

  for (const serverName of sortedServerNames) {
    const config = allServers[serverName];
    displayServerStatusSummary(serverName, config);
    printer.blank(); // Empty line between servers
  }

  // Overall summary
  const enabledCount = sortedServerNames.filter((name) => !allServers[name].disabled).length;
  const disabledCount = sortedServerNames.length - enabledCount;
  const stdioCount = sortedServerNames.filter((name) => allServers[name].type === 'stdio').length;
  const httpCount = sortedServerNames.filter((name) => allServers[name].type === 'http').length;
  const sseCount = sortedServerNames.filter((name) => allServers[name].type === 'sse').length;

  printer.subtitle('Overall Summary:');
  printer.keyValue({
    'Total Servers': sortedServerNames.length,
    'Enabled | Disabled': `${enabledCount} | ${disabledCount}`,
  });
  printer.subtitle('Transport Types:');
  printer.keyValue({
    stdio: stdioCount,
    http: httpCount,
    sse: sseCount,
  });

  // Get unique tags
  const allTags = new Set<string>();
  for (const config of Object.values(allServers)) {
    if (config.tags) {
      config.tags.forEach((tag) => allTags.add(tag));
    }
  }

  if (allTags.size > 0) {
    printer.keyValue({ 'Available Tags': Array.from(allTags).sort().join(', ') });
  }

  if (verbose) {
    printer.blank();
    printer.info('Use "mcp status <name>" to see detailed information for a specific server.');
  }
}

/**
 * Display summary status for a server (used in list view)
 */
function displayServerStatusSummary(name: string, config: MCPServerParams): void {
  const statusIcon = config.disabled ? '🔴' : '🟢';
  const statusText = config.disabled ? 'Disabled' : 'Enabled';

  // Infer type if missing
  const inferredConfig = config.type ? config : inferTransportType(config, name);
  const displayType = inferredConfig.type || 'unknown';

  printer.raw(`${statusIcon} ${name}`);
  printer.keyValue({
    Status: statusText,
    Type: displayType,
  });

  if (inferredConfig.type === 'stdio' && inferredConfig.command) {
    printer.keyValue({ Command: inferredConfig.command });
  } else if ((inferredConfig.type === 'http' || inferredConfig.type === 'sse') && inferredConfig.url) {
    printer.keyValue({ URL: inferredConfig.url });
  }

  if (config.tags && config.tags.length > 0) {
    printer.keyValue({ Tags: config.tags.join(', ') });
  }

  // Show capability filtering indicator
  const filteringInfo = getFilteringSummary(config);
  if (filteringInfo) {
    printer.keyValue({ Filtering: filteringInfo });
  }
}

/**
 * Get a summary string describing the filtering configuration for a server
 */
export function getFilteringSummary(config: MCPServerParams): string | null {
  const parts: string[] = [];

  const disabledToolsCount = config.disabledTools?.length || 0;
  const enabledToolsCount = config.enabledTools?.length || 0;
  const disabledResourcesCount = config.disabledResources?.length || 0;
  const enabledResourcesCount = config.enabledResources?.length || 0;
  const disabledPromptsCount = config.disabledPrompts?.length || 0;
  const enabledPromptsCount = config.enabledPrompts?.length || 0;

  const pluralize = (count: number, singular: string) => `${count} ${count === 1 ? singular : `${singular}s`}`;

  if (enabledToolsCount > 0) {
    parts.push(`${pluralize(enabledToolsCount, 'tool')} (enabled)`);
  } else if (disabledToolsCount > 0) {
    parts.push(`${pluralize(disabledToolsCount, 'tool')}`);
  }

  if (enabledResourcesCount > 0) {
    parts.push(`${pluralize(enabledResourcesCount, 'resource')} (enabled)`);
  } else if (disabledResourcesCount > 0) {
    parts.push(`${pluralize(disabledResourcesCount, 'resource')}`);
  }

  if (enabledPromptsCount > 0) {
    parts.push(`${pluralize(enabledPromptsCount, 'prompt')} (enabled)`);
  } else if (disabledPromptsCount > 0) {
    parts.push(`${pluralize(disabledPromptsCount, 'prompt')}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(', ');
}

/**
 * Display detailed status for a server (used in single server view)
 */
function displayDetailedServerStatus(name: string, config: MCPServerParams, verbose: boolean): void {
  const statusIcon = config.disabled ? '🔴' : '🟢';
  const statusText = config.disabled ? 'Disabled' : 'Enabled';

  // Infer type if missing
  const inferredConfig = config.type ? config : inferTransportType(config, name);
  const displayType = inferredConfig.type || 'unknown';

  printer.subtitle('Configuration:');
  printer.keyValue({
    Name: name,
    Status: `${statusIcon} ${statusText}`,
    Type: displayType,
  });

  // Type-specific configuration
  if (inferredConfig.type === 'stdio') {
    if (inferredConfig.command) {
      printer.keyValue({ Command: inferredConfig.command });
    }

    if (inferredConfig.args && inferredConfig.args.length > 0) {
      printer.keyValue({ Arguments: '(see below)' });
      inferredConfig.args.forEach((arg, index) => {
        printer.raw(`     [${index}]: ${arg}`);
      });
    } else {
      printer.keyValue({ Arguments: '(none)' });
    }

    printer.keyValue({ 'Working Directory': inferredConfig.cwd || '(current directory)' });
  } else if (inferredConfig.type === 'http' || inferredConfig.type === 'sse') {
    if (inferredConfig.url) {
      printer.keyValue({ URL: inferredConfig.url });
    }

    if (inferredConfig.headers && Object.keys(inferredConfig.headers).length > 0) {
      printer.keyValue({ Headers: '(see below)' });
      for (const [key, value] of Object.entries(inferredConfig.headers)) {
        printer.raw(`     ${key}: ${value}`);
      }
    } else {
      printer.keyValue({ Headers: '(none)' });
    }
  }

  // Common configuration
  printer.keyValue({ Timeout: inferredConfig.timeout ? `${inferredConfig.timeout}ms` : '(default)' });
  printer.keyValue({
    Tags: inferredConfig.tags && inferredConfig.tags.length > 0 ? inferredConfig.tags.join(', ') : '(none)',
  });

  // Capability filtering configuration
  printer.blank();
  printer.subtitle('Capability Filtering:');

  const hasFilters =
    (inferredConfig.disabledTools && inferredConfig.disabledTools.length > 0) ||
    (inferredConfig.enabledTools && inferredConfig.enabledTools.length > 0) ||
    (inferredConfig.disabledResources && inferredConfig.disabledResources.length > 0) ||
    (inferredConfig.enabledResources && inferredConfig.enabledResources.length > 0) ||
    (inferredConfig.disabledPrompts && inferredConfig.disabledPrompts.length > 0) ||
    (inferredConfig.enabledPrompts && inferredConfig.enabledPrompts.length > 0);

  if (!hasFilters) {
    printer.info('No capability filtering configured (all tools, resources, and prompts are exposed)');
  } else {
    // Tools
    if (inferredConfig.enabledTools && inferredConfig.enabledTools.length > 0) {
      printer.keyValue({ 'Enabled Tools': inferredConfig.enabledTools.join(', ') });
    }
    if (inferredConfig.disabledTools && inferredConfig.disabledTools.length > 0) {
      printer.keyValue({ 'Disabled Tools': inferredConfig.disabledTools.join(', ') });
    }

    // Resources
    if (inferredConfig.enabledResources && inferredConfig.enabledResources.length > 0) {
      printer.keyValue({ 'Enabled Resources': inferredConfig.enabledResources.join(', ') });
    }
    if (inferredConfig.disabledResources && inferredConfig.disabledResources.length > 0) {
      printer.keyValue({ 'Disabled Resources': inferredConfig.disabledResources.join(', ') });
    }

    // Prompts
    if (inferredConfig.enabledPrompts && inferredConfig.enabledPrompts.length > 0) {
      printer.keyValue({ 'Enabled Prompts': inferredConfig.enabledPrompts.join(', ') });
    }
    if (inferredConfig.disabledPrompts && inferredConfig.disabledPrompts.length > 0) {
      printer.keyValue({ 'Disabled Prompts': inferredConfig.disabledPrompts.join(', ') });
    }
  }

  // Environment variables
  if (inferredConfig.env && Object.keys(inferredConfig.env).length > 0) {
    printer.keyValue({ 'Environment Variables': '(see below)' });
    for (const [key, value] of Object.entries(inferredConfig.env)) {
      // Show first few characters for security, unless verbose mode
      if (verbose) {
        printer.raw(`     ${key}=${value}`);
      } else {
        const strValue = String(value);
        const displayValue = strValue.length > 20 ? `${strValue.substring(0, 20)}...` : strValue;
        printer.raw(`     ${key}=${displayValue}`);
      }
    }
  } else {
    printer.keyValue({ 'Environment Variables': '(none)' });
  }

  // Runtime status (this would require integration with ServerManager to get actual runtime status)
  printer.blank();
  printer.subtitle('Runtime Information:');
  printer.keyValue({ 'Configuration File': JSON.stringify(config) });

  if (config.disabled) {
    printer.keyValue({ 'Runtime Status': '⏹️  Not running (disabled)' });
    printer.info(`Use 'mcp enable ${name}' to enable this server.`);
  } else {
    printer.keyValue({ 'Runtime Status': '❓ Unknown (requires 1mcp to be running)' });
    printer.info('Start 1mcp to see actual runtime status.');
  }

  // Validation status
  printer.blank();
  printer.subtitle('Validation:');
  try {
    validateServerConfiguration(config);
    printer.info('Configuration: Valid ✓');
  } catch (error) {
    printer.error('Configuration: Invalid ❌');
    printer.info(`Error: ${error instanceof Error ? error.message : error}`);
  }

  // Quick actions
  printer.blank();
  printer.subtitle('Quick Actions:');
  if (config.disabled) {
    printer.info(`   • Enable: mcp enable ${name}`);
  } else {
    printer.info(`   • Disable: mcp disable ${name}`);
  }
  printer.info(`   • Update: mcp update ${name} [options]`);
  printer.info(`   • Remove: server remove ${name}`);
}

/**
 * Validate server configuration
 */
function validateServerConfiguration(config: MCPServerParams): void {
  if (!config.type) {
    throw new Error('Server type is required');
  }

  switch (config.type) {
    case 'stdio':
      if (!config.command) {
        throw new Error('Command is required for stdio servers');
      }
      break;
    case 'http':
    case 'sse':
      if (!config.url) {
        throw new Error(`URL is required for ${config.type} servers`);
      }
      try {
        new URL(config.url);
      } catch {
        throw new Error('Invalid URL format');
      }
      break;
    default:
      throw new Error(`Unsupported server type: ${config.type}`);
  }
}
