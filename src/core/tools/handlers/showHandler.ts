import { createRegistryClient } from '../../registry/mcpRegistryClient.js';
import { withErrorHandling } from '../../../utils/errorHandling.js';
import { RegistryServer, RegistryOptions, ShowCommandArgs } from '../../registry/types.js';
import logger from '../../../logger/logger.js';

// Singleton instances
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
 * Handle show_mcp_server tool calls
 */
export async function handleShowMCPServer(
  args: ShowCommandArgs,
  registryOptions?: RegistryOptions,
): Promise<RegistryServer> {
  const handler = withErrorHandling(async () => {
    logger.debug('Processing show_mcp_server request', args);

    const client = getRegistryClient(registryOptions);

    // Get server details
    const server = await client.getServerById(args.serverId, args.version);

    logger.debug(`Successfully fetched server details for: ${args.serverId}`);
    return server;
  }, `Failed to show MCP server: ${args.serverId}`);

  return await handler();
}

/**
 * Cleanup resources
 */
export function cleanupShowHandler(): void {
  if (registryClient) {
    registryClient.destroy();
    registryClient = null;
  }
}
