/**
 * Helper functions to get mock instances for adapter tests
 */
import type { MCPRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import type { ServerInstallationService } from '@src/domains/server-management/serverInstallationService.js';

export function getMockRegistryClient(): MCPRegistryClient {
  const { createRegistryClient } = require('@src/domains/registry/mcpRegistryClient.js');
  return createRegistryClient() as MCPRegistryClient;
}

export function getMockInstallationService(): ServerInstallationService {
  const { createServerInstallationService } = require('@src/domains/server-management/serverInstallationService.js');
  return createServerInstallationService() as ServerInstallationService;
}

export function getMockDiscoveryFunctions() {
  return require('@src/domains/discovery/appDiscovery.js');
}

export function getMockConfigUtils() {
  return require('@src/commands/mcp/utils/mcpServerConfig.js');
}

export function getMockTagsConfigurator() {
  return require('@src/domains/installation/configurators/tagsConfigurator.js');
}

export function getMockUrlDetection() {
  return require('@src/utils/validation/urlDetection.js');
}
