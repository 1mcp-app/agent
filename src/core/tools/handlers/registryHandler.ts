import { createRegistryClient } from '../../registry/mcpRegistryClient.js';
import { withErrorHandling } from '../../../utils/errorHandling.js';
import { RegistryStatusResult } from '../../registry/types.js';
import { GetRegistryStatusArgs } from '../../../utils/mcpToolSchemas.js';
import logger from '../../../logger/logger.js';

// Singleton registry client
let registryClient: ReturnType<typeof createRegistryClient> | null = null;

/**
 * Get or create registry client instance
 */
function getRegistryClient() {
  if (!registryClient) {
    registryClient = createRegistryClient();
  }
  return registryClient;
}

/**
 * Handle get_registry_status tool calls
 */
export async function handleGetRegistryStatus(args: GetRegistryStatusArgs): Promise<RegistryStatusResult> {
  const handler = withErrorHandling(async () => {
    logger.debug('Processing get_registry_status request', args);

    const client = getRegistryClient();
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
