import logger from '../../../logger/logger.js';
import { withErrorHandling } from '../../../utils/core/errorHandling.js';
import { createRegistryClient } from '../../registry/mcpRegistryClient.js';
import { RegistryOptions, ServerVersionsResponse, VersionsCommandArgs } from '../../registry/types.js';

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
 * Handle list_mcp_server_versions tool calls
 */
export async function handleListMCPServerVersions(
  args: VersionsCommandArgs,
  registryOptions?: RegistryOptions,
): Promise<ServerVersionsResponse> {
  const handler = withErrorHandling(async () => {
    logger.debug('Processing list_mcp_server_versions request', args);

    const client = getRegistryClient(registryOptions);

    // Get server versions
    const versions = await client.getServerVersions(args.serverId);

    logger.debug(`Successfully fetched ${versions.versions.length} versions for: ${args.serverId}`);
    return versions;
  }, `Failed to list versions for MCP server: ${args.serverId}`);

  return await handler();
}

/**
 * Cleanup resources
 */
export function cleanupVersionsHandler(): void {
  if (registryClient) {
    registryClient.destroy();
    registryClient = null;
  }
}
