import { GlobalTransportConfig, MCPServerParams } from '@src/core/types/index.js';
import { GlobalOptions } from '@src/globalOptions.js';
import { inferTransportType } from '@src/transport/transportFactory.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

import {
  getAllEffectiveServers,
  getAllServers,
  getEffectiveServerConfig,
  getGlobalConfig,
  getInheritedKeys,
  getServer,
  initializeConfigContext,
  validateConfigPath,
} from './utils/mcpServerConfig.js';
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
      describe: 'Show detailed status information with effective merged configuration',
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
  const rawServerConfig = getServer(serverName);
  const effectiveServerConfig = getEffectiveServerConfig(serverName);
  if (!rawServerConfig || !effectiveServerConfig) {
    throw new Error(`Server '${serverName}' does not exist.`);
  }

  printer.blank();
  printer.title(`Server Status: ${serverName}`);
  printer.blank();

  displayDetailedServerStatus(serverName, rawServerConfig, effectiveServerConfig, getGlobalConfig(), verbose);
}

/**
 * Show status for all servers
 */
async function showAllServersStatus(verbose: boolean = false): Promise<void> {
  const allServers = getAllServers();
  const allEffectiveServers = getAllEffectiveServers();
  const globalConfig = getGlobalConfig();

  if (Object.keys(allEffectiveServers).length === 0) {
    printer.info('No MCP servers are configured.');
    printer.info('Use "mcp add <name>" to add your first server.');
    return;
  }

  printer
    .blank()
    .title(
      `MCP Servers Status (${Object.keys(allEffectiveServers).length} server${Object.keys(allEffectiveServers).length === 1 ? '' : 's'})`,
    )
    .blank();

  if (Object.keys(globalConfig).length > 0) {
    printer.subtitle('Global Defaults:');
    printer.keyValue({
      timeout: globalConfig.timeout !== undefined ? `${globalConfig.timeout}ms` : '(none)',
      connectionTimeout:
        globalConfig.connectionTimeout !== undefined ? `${globalConfig.connectionTimeout}ms` : '(none)',
      requestTimeout: globalConfig.requestTimeout !== undefined ? `${globalConfig.requestTimeout}ms` : '(none)',
    });
    printer.blank();
  }

  // Sort servers by name for consistent output
  const sortedServerNames = Object.keys(allEffectiveServers).sort();

  for (const serverName of sortedServerNames) {
    const effectiveConfig = allEffectiveServers[serverName];
    displayServerStatusSummary(serverName, effectiveConfig);
    if (verbose && allServers[serverName]) {
      const inherited = getInheritedKeys(allServers[serverName], effectiveConfig, globalConfig);
      if (inherited.length > 0) {
        printer.keyValue({ Inherited: inherited.join(', ') });
      }
    }
    printer.blank(); // Empty line between servers
  }

  // Overall summary
  const enabledCount = sortedServerNames.filter((name) => !allEffectiveServers[name].disabled).length;
  const disabledCount = sortedServerNames.length - enabledCount;
  const stdioCount = sortedServerNames.filter((name) => allEffectiveServers[name].type === 'stdio').length;
  const httpCount = sortedServerNames.filter((name) => allEffectiveServers[name].type === 'http').length;
  const sseCount = sortedServerNames.filter((name) => allEffectiveServers[name].type === 'sse').length;

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
  for (const config of Object.values(allEffectiveServers)) {
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
}

/**
 * Display detailed status for a server (used in single server view)
 */
function displayDetailedServerStatus(
  name: string,
  rawConfig: MCPServerParams,
  effectiveConfig: MCPServerParams,
  globalConfig: GlobalTransportConfig,
  verbose: boolean,
): void {
  const statusIcon = effectiveConfig.disabled ? '🔴' : '🟢';
  const statusText = effectiveConfig.disabled ? 'Disabled' : 'Enabled';

  // Infer type if missing
  const inferredConfig = effectiveConfig.type ? effectiveConfig : inferTransportType(effectiveConfig, name);
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
  printer.keyValue({
    Timeout: inferredConfig.timeout ? `${inferredConfig.timeout}ms` : '(default)',
    'Connection Timeout': inferredConfig.connectionTimeout ? `${inferredConfig.connectionTimeout}ms` : '(default)',
    'Request Timeout': inferredConfig.requestTimeout ? `${inferredConfig.requestTimeout}ms` : '(default)',
  });
  printer.keyValue({
    Tags: inferredConfig.tags && inferredConfig.tags.length > 0 ? inferredConfig.tags.join(', ') : '(none)',
  });

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

  const inherited = getInheritedKeys(rawConfig, effectiveConfig, globalConfig);
  if (inherited.length > 0) {
    printer.keyValue({ Inherited: inherited.join(', ') });
  }

  // Runtime status (this would require integration with ServerManager to get actual runtime status)
  printer.blank();
  printer.subtitle('Runtime Information:');
  printer.keyValue({ 'Effective Configuration': JSON.stringify(effectiveConfig) });

  if (effectiveConfig.disabled) {
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
    validateServerConfiguration(effectiveConfig);
    printer.info('Configuration: Valid ✓');
  } catch (error) {
    printer.error('Configuration: Invalid ❌');
    printer.info(`Error: ${error instanceof Error ? error.message : error}`);
  }

  // Quick actions
  printer.blank();
  printer.subtitle('Quick Actions:');
  if (effectiveConfig.disabled) {
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
    case 'streamableHttp':
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
