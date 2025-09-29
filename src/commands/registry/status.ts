import type { Arguments, Argv } from 'yargs';
import { handleGetRegistryStatus, cleanupRegistryHandler } from '../../core/tools/handlers/registryHandler.js';
import { GetRegistryStatusArgs } from '../../utils/mcpToolSchemas.js';
import { RegistryOptions } from '../../core/registry/types.js';
import logger from '../../logger/logger.js';
import { GlobalOptions } from '../../globalOptions.js';
import { formatTimestamp } from '../../utils/formatters/commonFormatters.js';
import { RegistryYargsOptions } from './options.js';

export interface RegistryStatusCommandArgs extends Arguments, GlobalOptions, RegistryYargsOptions {
  stats?: boolean;
  json?: boolean;
}

/**
 * Build status command with options
 */
export function buildStatusCommand(statusYargs: Argv): Argv {
  return statusYargs
    .options({
      stats: {
        describe: 'Include detailed server count statistics',
        type: 'boolean' as const,
        default: false,
      },
      json: {
        describe: 'Output results in JSON format',
        type: 'boolean' as const,
        default: false,
      },
    })
    .example('$0 registry status', 'Check registry availability')
    .example('$0 registry status --stats', 'Show registry status with statistics')
    .example('$0 registry status --stats --json', 'Output detailed status in JSON format');
}

/**
 * Get MCP registry status and statistics
 */
export async function registryStatusCommand(argv: RegistryStatusCommandArgs): Promise<void> {
  try {
    const statusArgs: GetRegistryStatusArgs = {
      include_stats: argv.stats || false,
    };

    // Extract registry configuration from CLI options
    const registryOptions: RegistryOptions = {
      url: argv['url'],
      timeout: argv['timeout'],
      cacheTtl: argv['cache-ttl'],
      cacheMaxSize: argv['cache-max-size'],
      cacheCleanupInterval: argv['cache-cleanup-interval'],
      proxy: argv['proxy'],
      proxyAuth: argv['proxy-auth'],
    };

    logger.info('Getting MCP registry status...');
    const result = await handleGetRegistryStatus(statusArgs, registryOptions);

    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Format status display
    console.log('\n📊 MCP Registry Status\n');

    const statusIcon = result.available ? '✅' : '❌';
    const statusText = result.available ? 'Available' : 'Unavailable';

    console.log(`Status: ${statusIcon} ${statusText}`);
    console.log(`URL: ${result.url}`);
    console.log(`Response Time: ${result.response_time_ms}ms`);
    console.log(`Last Checked: ${formatTimestamp(result.last_updated)}`);

    if (result.stats) {
      console.log('\n📈 Registry Statistics\n');

      console.log(`Total Servers: ${result.stats.total_servers}`);
      console.log(`Active Servers: ${result.stats.active_servers}`);
      console.log(`Deprecated Servers: ${result.stats.deprecated_servers}`);

      if (Object.keys(result.stats.by_registry_type).length > 0) {
        console.log('\nBy Registry Type:');
        Object.entries(result.stats.by_registry_type).forEach(([type, count]) => {
          console.log(`  ${type}: ${count}`);
        });
      }

      if (Object.keys(result.stats.by_transport).length > 0) {
        console.log('\nBy Transport:');
        Object.entries(result.stats.by_transport).forEach(([transport, count]) => {
          console.log(`  ${transport}: ${count}`);
        });
      }
    }
  } catch (error) {
    logger.error('Registry status command failed:', error);
    console.error(`Error getting registry status: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    // Cleanup resources to ensure process exits
    cleanupRegistryHandler();
  }
}
