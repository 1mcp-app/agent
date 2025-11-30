/**
 * Internal MCP tool handlers - Main Module
 *
 * This module re-exports all internal tool handlers from specialized modules.
 * The handlers are organized into logical categories for better maintainability.
 */

// Discovery handlers - for searching and getting information about MCP servers
export {
  handleMcpSearch,
  handleMcpRegistryStatus,
  handleMcpRegistryInfo,
  handleMcpRegistryList,
  handleMcpInfo,
  cleanupDiscoveryHandlers,
} from './discoveryHandlers.js';

// Installation handlers - for installing, updating, and uninstalling MCP servers
export {
  handleMcpInstall,
  handleMcpUninstall,
  handleMcpUpdate,
  cleanupInstallationHandlers,
} from './installationHandlers.js';

// Management handlers - for enabling, disabling, listing, status, and reloading MCP servers
export {
  handleMcpEnable,
  handleMcpDisable,
  handleMcpList,
  handleMcpStatus,
  handleMcpReload,
  cleanupManagementHandlers,
} from './managementHandlers.js';

/**
 * Cleanup function for all internal tool handlers
 */
export function cleanupInternalToolHandlers(): void {
  // Dynamically import and cleanup all handler modules
  import('./discoveryHandlers.js').then(({ cleanupDiscoveryHandlers }) => {
    cleanupDiscoveryHandlers();
  });

  import('./installationHandlers.js').then(({ cleanupInstallationHandlers }) => {
    cleanupInstallationHandlers();
  });

  import('./managementHandlers.js').then(({ cleanupManagementHandlers }) => {
    cleanupManagementHandlers();
  });
}
