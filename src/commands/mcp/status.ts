import { MCPServerParams } from '../../core/types/index.js';
import { GlobalOptions } from '../../globalOptions.js';
import { getAllServers, getServer, validateConfigPath } from './utils/configUtils.js';
import { validateServerName } from './utils/validation.js';
import { inferTransportType } from '../../transport/transportFactory.js';

export interface StatusCommandArgs extends GlobalOptions {
  name?: string;
  verbose?: boolean;
}

/**
 * Show status and details of MCP servers
 */
export async function statusCommand(argv: StatusCommandArgs): Promise<void> {
  try {
    const { name, config: configPath, verbose = false } = argv;

    // Validate config path
    validateConfigPath(configPath);

    if (name) {
      // Show status for specific server
      await showServerStatus(name, configPath, verbose);
    } else {
      // Show status for all servers
      await showAllServersStatus(configPath, verbose);
    }
  } catch (error) {
    console.error(`❌ Failed to get server status: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Show status for a specific server
 */
async function showServerStatus(serverName: string, configPath?: string, verbose: boolean = false): Promise<void> {
  // Validate server name
  validateServerName(serverName);

  // Get server configuration
  const serverConfig = getServer(serverName, configPath);
  if (!serverConfig) {
    throw new Error(`Server '${serverName}' does not exist.`);
  }

  console.log(`\n🔍 Server Status: ${serverName}\n`);

  displayDetailedServerStatus(serverName, serverConfig, verbose);
}

/**
 * Show status for all servers
 */
async function showAllServersStatus(configPath?: string, verbose: boolean = false): Promise<void> {
  const allServers = getAllServers(configPath);

  if (Object.keys(allServers).length === 0) {
    console.log('No MCP servers are configured.');
    console.log('\n💡 Use "mcp add <name>" to add your first server.');
    return;
  }

  console.log(
    `\n📊 MCP Servers Status (${Object.keys(allServers).length} server${Object.keys(allServers).length === 1 ? '' : 's'}):\n`,
  );

  // Sort servers by name for consistent output
  const sortedServerNames = Object.keys(allServers).sort();

  for (const serverName of sortedServerNames) {
    const config = allServers[serverName];
    displayServerStatusSummary(serverName, config);
    console.log(); // Empty line between servers
  }

  // Overall summary
  const enabledCount = sortedServerNames.filter((name) => !allServers[name].disabled).length;
  const disabledCount = sortedServerNames.length - enabledCount;
  const stdioCount = sortedServerNames.filter((name) => allServers[name].type === 'stdio').length;
  const httpCount = sortedServerNames.filter((name) => allServers[name].type === 'http').length;
  const sseCount = sortedServerNames.filter((name) => allServers[name].type === 'sse').length;

  console.log(`📈 Overall Summary:`);
  console.log(`   Total Servers: ${sortedServerNames.length}`);
  console.log(`   Enabled: ${enabledCount} | Disabled: ${disabledCount}`);
  console.log(`   Transport Types:`);
  console.log(`     • stdio: ${stdioCount}`);
  console.log(`     • http: ${httpCount}`);
  console.log(`     • sse: ${sseCount}`);

  // Get unique tags
  const allTags = new Set<string>();
  for (const config of Object.values(allServers)) {
    if (config.tags) {
      config.tags.forEach((tag) => allTags.add(tag));
    }
  }

  if (allTags.size > 0) {
    console.log(`   Available Tags: ${Array.from(allTags).sort().join(', ')}`);
  }

  if (verbose) {
    console.log(`\n💡 Use "mcp status <name>" to see detailed information for a specific server.`);
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

  console.log(`${statusIcon} ${name}`);
  console.log(`   Status: ${statusText}`);
  console.log(`   Type: ${displayType}`);

  // Brief description of endpoint/command
  if (inferredConfig.type === 'stdio') {
    console.log(`   Command: ${inferredConfig.command}`);
  } else {
    console.log(`   URL: ${inferredConfig.url}`);
  }

  if (config.tags && config.tags.length > 0) {
    console.log(`   Tags: ${config.tags.join(', ')}`);
  }
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

  console.log(`📋 Configuration:`);
  console.log(`   Name: ${name}`);
  console.log(`   Status: ${statusIcon} ${statusText}`);
  console.log(`   Type: ${displayType}`);

  // Type-specific configuration
  if (inferredConfig.type === 'stdio') {
    console.log(`   Command: ${inferredConfig.command}`);

    if (inferredConfig.args && inferredConfig.args.length > 0) {
      console.log(`   Arguments:`);
      inferredConfig.args.forEach((arg, index) => {
        console.log(`     [${index}]: ${arg}`);
      });
    } else {
      console.log(`   Arguments: (none)`);
    }

    if (inferredConfig.cwd) {
      console.log(`   Working Directory: ${inferredConfig.cwd}`);
    } else {
      console.log(`   Working Directory: (current directory)`);
    }
  } else if (inferredConfig.type === 'http' || inferredConfig.type === 'sse') {
    console.log(`   URL: ${inferredConfig.url}`);

    if (inferredConfig.headers && Object.keys(inferredConfig.headers).length > 0) {
      console.log(`   Headers:`);
      for (const [key, value] of Object.entries(inferredConfig.headers)) {
        console.log(`     ${key}: ${value}`);
      }
    } else {
      console.log(`   Headers: (none)`);
    }
  }

  // Common configuration
  if (inferredConfig.timeout) {
    console.log(`   Timeout: ${inferredConfig.timeout}ms`);
  } else {
    console.log(`   Timeout: (default)`);
  }

  if (inferredConfig.tags && inferredConfig.tags.length > 0) {
    console.log(`   Tags: ${inferredConfig.tags.join(', ')}`);
  } else {
    console.log(`   Tags: (none)`);
  }

  // Environment variables
  if (inferredConfig.env && Object.keys(inferredConfig.env).length > 0) {
    console.log(`   Environment Variables:`);
    for (const [key, value] of Object.entries(inferredConfig.env)) {
      // Show first few characters for security, unless verbose mode
      if (verbose) {
        console.log(`     ${key}=${value}`);
      } else {
        const displayValue = value.length > 20 ? `${value.substring(0, 20)}...` : value;
        console.log(`     ${key}=${displayValue}`);
      }
    }
  } else {
    console.log(`   Environment Variables: (none)`);
  }

  // Runtime status (this would require integration with ServerManager to get actual runtime status)
  console.log(`\n🔧 Runtime Information:`);
  console.log(`   Configuration File: ${config}`);

  if (config.disabled) {
    console.log(`   Runtime Status: ⏹️  Not running (disabled)`);
    console.log(`   Note: Use 'mcp enable ${name}' to enable this server.`);
  } else {
    console.log(`   Runtime Status: ❓ Unknown (requires 1mcp to be running)`);
    console.log(`   Note: Start 1mcp to see actual runtime status.`);
  }

  // Validation status
  console.log(`\n✅ Validation:`);
  try {
    validateServerConfiguration(config);
    console.log(`   Configuration: Valid ✓`);
  } catch (error) {
    console.log(`   Configuration: Invalid ❌`);
    console.log(`   Error: ${error instanceof Error ? error.message : error}`);
  }

  // Quick actions
  console.log(`\n🚀 Quick Actions:`);
  if (config.disabled) {
    console.log(`   • Enable: mcp enable ${name}`);
  } else {
    console.log(`   • Disable: mcp disable ${name}`);
  }
  console.log(`   • Update: mcp update ${name} [options]`);
  console.log(`   • Remove: server remove ${name}`);
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
