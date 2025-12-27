import { MCPServerParams } from '@src/core/types/index.js';
import { createServerInstallationService } from '@src/domains/server-management/serverInstallationService.js';
import { GlobalOptions } from '@src/globalOptions.js';
import { inferTransportType } from '@src/transport/transportFactory.js';
import printer from '@src/utils/ui/printer.js';
import {
  redactCommandArgs,
  redactSensitiveValue,
  redactUrl,
  sanitizeHeaders,
} from '@src/utils/validation/sanitization.js';

import type { Argv } from 'yargs';

import { getAllServers, initializeConfigContext, parseTags, validateConfigPath } from './utils/mcpServerConfig.js';
import { calculateServerStatus } from './utils/serverUtils.js';
import { validateTags } from './utils/validation.js';

export interface ListCommandArgs extends GlobalOptions {
  'show-disabled'?: boolean;
  'show-secrets'?: boolean;
  tags?: string;
  verbose?: boolean;
  outdated?: boolean;
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
    .option('outdated', {
      describe: 'Show only servers with available updates',
      type: 'boolean',
      default: false,
    })
    .example([
      ['$0 mcp list', 'List all enabled servers'],
      ['$0 mcp list --show-disabled', 'List all servers including disabled'],
      ['$0 mcp list --show-secrets', 'Show sensitive values in verbose output'],
      ['$0 mcp list --tags=prod,api', 'List servers with specific tags'],
      ['$0 mcp list --outdated', 'List only servers with available updates'],
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
      'config-dir': configDir,
      'show-disabled': showDisabled = false,
      'show-secrets': showSecrets = false,
      tags: tagsFilter,
      verbose = false,
      outdated = false,
    } = argv;

    // Initialize config context with CLI options
    initializeConfigContext(configPath, configDir);

    // Validate config path
    validateConfigPath();

    // Validate tags filter if provided
    if (tagsFilter) {
      validateTags(tagsFilter);
    }

    // Get all servers
    const allServers = getAllServers();

    if (Object.keys(allServers).length === 0) {
      printer.info('No MCP servers are configured.');
      printer.blank();
      printer.info('Use "server add <name>" to add your first server.');
      return;
    }

    // Filter servers (apply outdated filter if requested)
    let filteredServers = filterServers(allServers, showDisabled, tagsFilter);

    if (outdated) {
      filteredServers = await getOutdatedServers(filteredServers);
    }

    if (Object.keys(filteredServers).length === 0) {
      if (tagsFilter) {
        printer.warn(`No servers found matching the specified tags: ${tagsFilter}`);
      } else if (!showDisabled) {
        printer.warn('No enabled servers found.');
        printer.blank();
        printer.info('Use --show-disabled to include disabled servers, or "server enable <name>" to enable servers.');
      } else {
        printer.warn('No servers found.');
      }
      return;
    }

    // Display results
    const serverCount = Object.keys(filteredServers).length;
    printer
      .blank()
      .title(`MCP Servers (${serverCount} server${serverCount === 1 ? '' : 's'})`)
      .blank();

    // Sort servers by name for consistent output
    const sortedServerNames = Object.keys(filteredServers).sort();

    for (const serverName of sortedServerNames) {
      const config = filteredServers[serverName];
      displayServer(serverName, config, verbose, showSecrets);
      printer.blank();
    }

    // Summary information
    const enabledCount = sortedServerNames.filter((name) => !filteredServers[name].disabled).length;
    const disabledCount = sortedServerNames.length - enabledCount;

    printer.subtitle('Summary:');
    printer.keyValue({
      Total: `${sortedServerNames.length} server${sortedServerNames.length === 1 ? '' : 's'}`,
      Enabled: enabledCount,
    });

    if (showDisabled && disabledCount > 0) {
      printer.keyValue({ Disabled: disabledCount });
    }

    if (tagsFilter) {
      printer.keyValue({ 'Filtered by tags': tagsFilter });
    }

    if (showSecrets) {
      printer.blank();
      printer.warn('Sensitive information is being displayed. Use with caution.');
    }

    if (!showDisabled && disabledCount > 0) {
      printer.blank();
      printer.info(
        `${disabledCount} disabled server${disabledCount === 1 ? '' : 's'} hidden. Use --show-disabled to see all servers.`,
      );
    }
  } catch (error) {
    printer.error(`Failed to list servers: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Filter servers to show only those with available updates
 */
async function getOutdatedServers(servers: Record<string, MCPServerParams>): Promise<Record<string, MCPServerParams>> {
  const outdated: Record<string, MCPServerParams> = {};

  // Create service to check for updates
  const installationService = createServerInstallationService();

  // Get list of server names
  const serverNames = Object.keys(servers);

  // Check for updates for all servers
  const updateResults = await installationService.checkForUpdates(serverNames);

  // Filter to only servers with available updates
  const serversWithUpdates = updateResults
    .filter((result) => result.hasUpdate || result.updateAvailable)
    .map((result) => result.serverName);

  // Return only outdated servers
  for (const serverName of serversWithUpdates) {
    if (servers[serverName]) {
      outdated[serverName] = servers[serverName];
    }
  }

  return outdated;
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
  const enabled = !config.disabled;

  // Get installation metadata
  const version = 'unknown';

  // Calculate server status
  const serverStatus = calculateServerStatus(version);

  // Infer type if missing
  const inferredConfig = config.type ? config : inferTransportType(config, name);
  const displayType = inferredConfig.type || 'unknown';

  // Display with installation metadata
  printer.serverStatus(name, enabled);

  // Type and version info
  printer.keyValue({
    Type: displayType,
    Version: version,
  });

  // Show status if outdated
  if (serverStatus === 'outdated') {
    printer.warn('   ⚠️  Update available');
  }

  // Type-specific information
  if (inferredConfig.type === 'stdio') {
    if (inferredConfig.command) {
      printer.keyValue({ Command: inferredConfig.command });
    }
    if (inferredConfig.args && inferredConfig.args.length > 0) {
      const displayArgs = showSecrets ? inferredConfig.args : redactCommandArgs(inferredConfig.args);
      printer.keyValue({ Args: displayArgs.join(' ') });
    }
    if (inferredConfig.cwd) {
      printer.keyValue({ 'Working Directory': inferredConfig.cwd });
    }

    // Restart configuration (stdio only)
    if (inferredConfig.restartOnExit) {
      printer.keyValue({ 'Restart on Exit': 'Enabled' });
      if (inferredConfig.maxRestarts !== undefined) {
        printer.keyValue({ 'Max Restarts': inferredConfig.maxRestarts });
      } else {
        printer.keyValue({ 'Max Restarts': 'Unlimited' });
      }
      const delay = inferredConfig.restartDelay ?? 1000;
      printer.keyValue({ 'Restart Delay': `${delay}ms` });
    }
  } else if (inferredConfig.type === 'http' || inferredConfig.type === 'sse') {
    const displayUrl = showSecrets ? inferredConfig.url || '' : redactUrl(inferredConfig.url || '');
    printer.keyValue({ URL: displayUrl });
    if (inferredConfig.headers && Object.keys(inferredConfig.headers).length > 0) {
      const headerCount = Object.keys(inferredConfig.headers).length;
      printer.keyValue({ Headers: `${headerCount} header${headerCount === 1 ? '' : 's'}` });

      if (verbose) {
        const displayHeaders = showSecrets ? inferredConfig.headers : sanitizeHeaders(inferredConfig.headers);
        for (const [key, value] of Object.entries(displayHeaders)) {
          printer.raw(`     ${key}: ${value}`);
        }
      }
    }
  }

  // Common properties
  if (inferredConfig.tags && inferredConfig.tags.length > 0) {
    printer.keyValue({ Tags: inferredConfig.tags.join(', ') });
  }

  if (inferredConfig.timeout) {
    printer.keyValue({ Timeout: `${inferredConfig.timeout}ms` });
  }

  if (inferredConfig.env && Object.keys(inferredConfig.env).length > 0) {
    const envCount = Object.keys(inferredConfig.env).length;
    printer.keyValue({ Environment: `${envCount} variable${envCount === 1 ? '' : 's'}` });

    if (verbose) {
      for (const [key, value] of Object.entries(inferredConfig.env)) {
        const displayValue = showSecrets ? value : redactSensitiveValue(String(value));
        printer.raw(`     ${key}=${displayValue}`);
      }
    }
  }
}
