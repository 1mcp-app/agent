import type { Argv } from 'yargs';
import { MCPServerParams } from '../../core/types/index.js';
import { GlobalOptions } from '../../globalOptions.js';
import { getAllServers, validateConfigPath, parseTags } from './utils/configUtils.js';
import { validateTags } from './utils/validation.js';
import { inferTransportType } from '../../transport/transportFactory.js';
import { redactCommandArgs, redactUrl, redactSensitiveValue, sanitizeHeaders } from '../../utils/sanitization.js';

export interface ListCommandArgs extends GlobalOptions {
  'show-disabled'?: boolean;
  'show-secrets'?: boolean;
  tags?: string;
  verbose?: boolean;
}

/**
 * Build the list command configuration
 */
export function buildListCommand(yargs: Argv) {
  return yargs
    .option('show-disabled', {
      describe: 'Include disabled servers in the list',
      type: 'boolean',
      default: false,
    })
    .option('show-secrets', {
      describe: 'Show sensitive values in verbose output',
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
      ['$0 mcp list --show-secrets', 'Show sensitive values in verbose output'],
      ['$0 mcp list --tags=prod,api', 'List servers with specific tags'],
      ['$0 mcp list --verbose', 'List servers with detailed config'],
    ]);
}

/**
 * List all configured MCP servers
 */
export async function listCommand(argv: ListCommandArgs): Promise<void> {
  try {
    const {
      config: configPath,
      'show-disabled': showDisabled = false,
      'show-secrets': showSecrets = false,
      tags: tagsFilter,
      verbose = false,
    } = argv;

    // Validate config path
    validateConfigPath(configPath);

    // Validate tags filter if provided
    if (tagsFilter) {
      validateTags(tagsFilter);
    }

    // Get all servers
    const allServers = getAllServers(configPath);

    if (Object.keys(allServers).length === 0) {
      console.log('No MCP servers are configured.');
      console.log('\n💡 Use "server add <name>" to add your first server.');
      return;
    }

    // Filter servers
    const filteredServers = filterServers(allServers, showDisabled, tagsFilter);

    if (Object.keys(filteredServers).length === 0) {
      if (tagsFilter) {
        console.log(`No servers found matching the specified tags: ${tagsFilter}`);
      } else if (!showDisabled) {
        console.log('No enabled servers found.');
        console.log(
          '\n💡 Use --show-disabled to include disabled servers, or "server enable <name>" to enable servers.',
        );
      } else {
        console.log('No servers found.');
      }
      return;
    }

    // Display results
    console.log(
      `\n📋 MCP Servers (${Object.keys(filteredServers).length} server${Object.keys(filteredServers).length === 1 ? '' : 's'}):\n`,
    );

    // Sort servers by name for consistent output
    const sortedServerNames = Object.keys(filteredServers).sort();

    for (const serverName of sortedServerNames) {
      const config = filteredServers[serverName];
      displayServer(serverName, config, verbose, showSecrets);
      console.log(); // Empty line between servers
    }

    // Summary information
    const enabledCount = sortedServerNames.filter((name) => !filteredServers[name].disabled).length;
    const disabledCount = sortedServerNames.length - enabledCount;

    console.log(`📊 Summary:`);
    console.log(`   Total: ${sortedServerNames.length} server${sortedServerNames.length === 1 ? '' : 's'}`);
    console.log(`   Enabled: ${enabledCount}`);
    if (showDisabled && disabledCount > 0) {
      console.log(`   Disabled: ${disabledCount}`);
    }

    if (tagsFilter) {
      console.log(`   Filtered by tags: ${tagsFilter}`);
    }

    if (showSecrets) {
      console.log(`\n⚠️  Sensitive information is being displayed. Use with caution.`);
    }

    if (!showDisabled && disabledCount > 0) {
      console.log(
        `\n💡 ${disabledCount} disabled server${disabledCount === 1 ? '' : 's'} hidden. Use --show-disabled to see all servers.`,
      );
    }
  } catch (error) {
    console.error(`❌ Failed to list servers: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Filter servers based on criteria
 */
function filterServers(
  servers: Record<string, MCPServerParams>,
  showDisabled: boolean,
  tagsFilter?: string,
): Record<string, MCPServerParams> {
  const filtered: Record<string, MCPServerParams> = {};

  // Parse tags filter if provided
  const filterTags = tagsFilter ? parseTags(tagsFilter) : undefined;

  for (const [name, config] of Object.entries(servers)) {
    // Skip disabled servers unless explicitly requested
    if (config.disabled && !showDisabled) {
      continue;
    }

    // Apply tags filter if provided
    if (filterTags && filterTags.length > 0) {
      const serverTags = config.tags || [];
      const hasMatchingTag = filterTags.some((filterTag) =>
        serverTags.some((serverTag) => serverTag.toLowerCase() === filterTag.toLowerCase()),
      );

      if (!hasMatchingTag) {
        continue;
      }
    }

    filtered[name] = config;
  }

  return filtered;
}

/**
 * Display a single server's information
 */
function displayServer(name: string, config: MCPServerParams, verbose: boolean, showSecrets: boolean = false): void {
  const statusIcon = config.disabled ? '🔴' : '🟢';
  const statusText = config.disabled ? 'Disabled' : 'Enabled';

  // Infer type if missing
  const inferredConfig = config.type ? config : inferTransportType(config, name);
  const displayType = inferredConfig.type || 'unknown';

  console.log(`${statusIcon} ${name} (${statusText})`);
  console.log(`   Type: ${displayType}`);

  // Type-specific information
  if (inferredConfig.type === 'stdio') {
    console.log(`   Command: ${inferredConfig.command}`);
    if (inferredConfig.args && inferredConfig.args.length > 0) {
      const displayArgs = showSecrets ? inferredConfig.args : redactCommandArgs(inferredConfig.args);
      console.log(`   Args: ${displayArgs.join(' ')}`);
    }
    if (inferredConfig.cwd) {
      console.log(`   Working Directory: ${inferredConfig.cwd}`);
    }

    // Restart configuration (stdio only)
    if (inferredConfig.restartOnExit) {
      console.log(`   Restart on Exit: Enabled`);
      if (inferredConfig.maxRestarts !== undefined) {
        console.log(`   Max Restarts: ${inferredConfig.maxRestarts}`);
      } else {
        console.log(`   Max Restarts: Unlimited`);
      }
      const delay = inferredConfig.restartDelay ?? 1000;
      console.log(`   Restart Delay: ${delay}ms`);
    }
  } else if (inferredConfig.type === 'http' || inferredConfig.type === 'sse') {
    const displayUrl = showSecrets ? inferredConfig.url || '' : redactUrl(inferredConfig.url || '');
    console.log(`   URL: ${displayUrl}`);
    if (inferredConfig.headers && Object.keys(inferredConfig.headers).length > 0) {
      const headerCount = Object.keys(inferredConfig.headers).length;
      console.log(`   Headers: ${headerCount} header${headerCount === 1 ? '' : 's'}`);

      if (verbose) {
        const displayHeaders = showSecrets ? inferredConfig.headers : sanitizeHeaders(inferredConfig.headers);
        for (const [key, value] of Object.entries(displayHeaders)) {
          console.log(`     ${key}: ${value}`);
        }
      }
    }
  }

  // Common properties
  if (inferredConfig.tags && inferredConfig.tags.length > 0) {
    console.log(`   Tags: ${inferredConfig.tags.join(', ')}`);
  }

  if (inferredConfig.timeout) {
    console.log(`   Timeout: ${inferredConfig.timeout}ms`);
  }

  if (inferredConfig.env && Object.keys(inferredConfig.env).length > 0) {
    const envCount = Object.keys(inferredConfig.env).length;
    console.log(`   Environment: ${envCount} variable${envCount === 1 ? '' : 's'}`);

    if (verbose) {
      for (const [key, value] of Object.entries(inferredConfig.env)) {
        const displayValue = showSecrets ? value : redactSensitiveValue(value);
        console.log(`     ${key}=${displayValue}`);
      }
    }
  }
}
