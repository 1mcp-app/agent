import type { Arguments } from 'yargs';
import { handleGetRegistryStatus, cleanupRegistryHandler } from '../../core/tools/handlers/registryHandler.js';
import { GetRegistryStatusArgs } from '../../utils/mcpToolSchemas.js';
import { RegistryOptions } from '../../core/registry/types.js';
import logger from '../../logger/logger.js';
import { GlobalOptions } from '../../globalOptions.js';

export interface RegistryStatusCommandArgs extends Arguments, GlobalOptions {
  stats?: boolean;
  json?: boolean;
  // Registry options
  url?: string;
  timeout?: number;
  'cache-ttl'?: number;
  'cache-max-size'?: number;
  'cache-cleanup-interval'?: number;
  proxy?: string;
  'proxy-auth'?: string;
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

/**
 * Format ISO timestamp to readable format
 */
function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}
