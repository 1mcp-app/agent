import { MCPServerParams } from '../../core/types/index.js';
import { getAllServers, validateConfigPath, parseTags } from './utils/configUtils.js';
import { validateTags } from './utils/validation.js';
import { inferTransportType } from '../../transport/transportFactory.js';

export interface ListCommandArgs {
  config?: string;
  'show-disabled'?: boolean;
  tags?: string;
  verbose?: boolean;
}

/**
 * List all configured MCP servers
 */
export async function listCommand(argv: ListCommandArgs): Promise<void> {
  try {
    const { config: configPath, 'show-disabled': showDisabled = false, tags: tagsFilter, verbose = false } = argv;

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
      displayServer(serverName, config, verbose);
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
function displayServer(name: string, config: MCPServerParams, verbose: boolean): void {
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
      console.log(`   Args: ${inferredConfig.args.join(' ')}`);
    }
    if (inferredConfig.cwd) {
      console.log(`   Working Directory: ${inferredConfig.cwd}`);
    }
  } else if (inferredConfig.type === 'http' || inferredConfig.type === 'sse') {
    console.log(`   URL: ${inferredConfig.url}`);
    if (inferredConfig.headers && Object.keys(inferredConfig.headers).length > 0) {
      const headerCount = Object.keys(inferredConfig.headers).length;
      console.log(`   Headers: ${headerCount} header${headerCount === 1 ? '' : 's'}`);

      if (verbose) {
        for (const [key, value] of Object.entries(inferredConfig.headers)) {
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
        // Don't show full values of environment variables for security
        const displayValue = value.length > 20 ? `${value.substring(0, 20)}...` : value;
        console.log(`     ${key}=${displayValue}`);
      }
    }
  }
}
