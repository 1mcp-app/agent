import { createRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import { GetRegistryStatusArgs } from '@src/domains/registry/mcpToolSchemas.js';
import { RegistryOptions, RegistryStatusResult } from '@src/domains/registry/types.js';
import logger from '@src/logger/logger.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';

// Singleton registry client
let registryClient: ReturnType<typeof createRegistryClient> | null = null;
let currentRegistryConfig: RegistryOptions | undefined = undefined;

/**
 * Get or create registry client instance
 */
function getRegistryClient(registryOptions?: RegistryOptions) {
  // Recreate client if config changed
  if (!registryClient || JSON.stringify(currentRegistryConfig) !== JSON.stringify(registryOptions)) {
    if (registryClient) {
      registryClient.destroy();
    }
    registryClient = createRegistryClient(registryOptions);
    currentRegistryConfig = registryOptions;
  }
  return registryClient;
}

/**
 * Handle get_registry_status tool calls
 */
export async function handleGetRegistryStatus(
  args: GetRegistryStatusArgs,
  registryOptions?: RegistryOptions,
): Promise<RegistryStatusResult> {
  const handler = withErrorHandling(async () => {
    logger.debug('Processing get_registry_status request', args);

    const client = getRegistryClient(registryOptions);
    const includeStats = args.include_stats || false;

    // Get registry status
    const status = await client.getRegistryStatus(includeStats);

    logger.debug('Registry status retrieved successfully', {
      available: status.available,
      response_time: status.response_time_ms,
      has_stats: !!status.stats,
    });

    return status;
  }, 'Failed to get registry status');

  return await handler();
}

/**
 * Cleanup resources
 */
export function cleanupRegistryHandler(): void {
  if (registryClient) {
    registryClient.destroy();
    registryClient = null;
  }
}
