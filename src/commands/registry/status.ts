import { cleanupRegistryHandler, handleGetRegistryStatus } from '@src/core/tools/handlers/registryHandler.js';
import { formatTimestamp } from '@src/domains/registry/formatters/commonFormatters.js';
import { GetRegistryStatusArgs } from '@src/domains/registry/mcpToolSchemas.js';
import { RegistryOptions } from '@src/domains/registry/types.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import printer from '@src/utils/ui/printer.js';

import type { Arguments, Argv } from 'yargs';

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
      printer.raw(JSON.stringify(result, null, 2));
      return;
    }

    // Format status display
    printer.blank();
    printer.title('MCP Registry Status');
    printer.blank();

    const statusText = result.available ? 'Available' : 'Unavailable';
    printer.keyValue({
      Status: `${result.available ? '✅' : '❌'} ${statusText}`,
      URL: result.url,
      'Response Time': `${result.response_time_ms}ms`,
      'Last Checked': formatTimestamp(result.last_updated),
    });

    if (result.stats) {
      printer.blank();
      printer.title('Registry Statistics');
      printer.blank();

      printer.keyValue({
        'Total Servers': result.stats.total_servers,
        'Active Servers': result.stats.active_servers,
        'Deprecated Servers': result.stats.deprecated_servers,
      });

      if (Object.keys(result.stats.by_registry_type).length > 0) {
        printer.blank();
        printer.subtitle('By Registry Type:');
        Object.entries(result.stats.by_registry_type).forEach(([type, count]) => {
          printer.info(`  ${type}: ${count}`);
        });
      }

      if (Object.keys(result.stats.by_transport).length > 0) {
        printer.blank();
        printer.subtitle('By Transport:');
        Object.entries(result.stats.by_transport).forEach(([transport, count]) => {
          printer.info(`  ${transport}: ${count}`);
        });
      }
    }
  } catch (error) {
    logger.error('Registry status command failed:', error);
    printer.error(`Error getting registry status: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    // Cleanup resources to ensure process exits
    cleanupRegistryHandler();
  }
}
