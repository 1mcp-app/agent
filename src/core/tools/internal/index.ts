/**
 * Internal MCP Tools - Main Entry Point
 *
 * This module serves as the primary entry point for all internal MCP tool functionality.
 * It provides a unified, organized interface for internal tools while maintaining
 * complete backward compatibility with existing import patterns.
 *
 * Architecture Overview:
 * ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
 * │   Handlers      │    │     Schemas      │    │    Adapters     │
 * │  (Business      │    │   (Validation    │    │   (Service      │
 * │   Logic)        │    │     & Types)     │    │  Integration)   │
 * └─────────────────┘    └──────────────────┘    └─────────────────┘
 *         │                       │                       │
 *         └───────────────────────┼───────────────────────┘
 *                                 │
 *                    ┌─────────────────┐
 *                    │     index.ts    │  ← This File
 *                    │  (Main Export   │
 *                    │   Interface)    │
 *                    └─────────────────┘
 *                                 │
 *                    ┌─────────────────┐
 *                    │ InternalCapabilities│
 *                    │    Provider      │
 *                    └─────────────────┘
 *
 * @module InternalTools
 * @version 4.0.0
 * @since 1.0.0
 */
// ==================== HANDLER EXPORTS ====================
// Import the handlers directly from their modules
import {
  cleanupDiscoveryHandlers,
  handleMcpInfo,
  handleMcpRegistryInfo,
  handleMcpRegistryList,
  handleMcpRegistryStatus,
  handleMcpSearch,
} from './discoveryHandlers.js';
import {
  cleanupInstallationHandlers,
  handleMcpInstall,
  handleMcpUninstall,
  handleMcpUpdate,
} from './installationHandlers.js';
import {
  cleanupManagementHandlers,
  handleMcpDisable,
  handleMcpEnable,
  handleMcpList,
  handleMcpReload,
  handleMcpStatus,
} from './managementHandlers.js';

/**
 * Discovery Handlers - MCP search, registry operations, and server information
 *
 * These handlers provide tools for discovering MCP servers, querying registries,
 * and getting detailed information about available servers.
 */
export {
  // Registry and search operations
  handleMcpSearch,
  handleMcpRegistryStatus,
  handleMcpRegistryInfo,
  handleMcpRegistryList,

  // Server information operations
  handleMcpInfo,

  // Cleanup function
  cleanupDiscoveryHandlers,
};

/**
 * Installation Handlers - Install, update, and uninstall MCP servers
 *
 * These handlers provide tools for managing the lifecycle of MCP servers,
 * including installation, updates, and removal.
 */
export { handleMcpInstall, handleMcpUninstall, handleMcpUpdate, cleanupInstallationHandlers };

/**
 * Management Handlers - Enable, disable, list, status, and reload operations
 *
 * These handlers provide tools for managing the operational state of MCP servers,
 * including enabling/disabling, listing, status checking, and configuration reloading.
 */
export {
  handleMcpEnable,
  handleMcpDisable,
  handleMcpList,
  handleMcpStatus,
  handleMcpReload,
  cleanupManagementHandlers,
};

// ==================== SCHEMA EXPORTS ====================

/**
 * Internal Tool Schemas - Input/output validation and type definitions
 *
 * Comprehensive schema exports for all internal tools, organized by functional domain.
 * Includes both Zod schemas for runtime validation and TypeScript types for development.
 */
export * from './schemas/index.js';

// ==================== ADAPTER EXPORTS ====================

/**
 * Service Adapters - Bridge between internal tools and domain services
 *
 * These adapters provide a clean abstraction layer between internal tools
 * and the underlying domain services, enabling better separation of concerns
 * and easier testing.
 */
export * from './adapters/index.js';

// ==================== BACKWARD COMPATIBILITY ====================

/**
 * Legacy Export Support
 *
 * Maintains full backward compatibility with existing import patterns.
 * All existing code using imports from './toolHandlers.js' will continue to work
 * without any changes required.
 *
 * Examples of supported patterns:
 * ```typescript
 * // Individual handler imports
 * import { handleMcpSearch, handleMcpInstall } from './index.js';
 *
 * // Schema type imports
 * import { McpSearchToolArgs, McpInstallToolArgs } from './index.js';
 *
 * // Adapter imports
 * import { createDiscoveryAdapter, AdapterFactory } from './index.js';
 *
 * // Wildcard imports
 * import * as InternalTools from './index.js';
 * ```
 */

// ==================== UNIFIED CLEANUP ====================

/**
 * Comprehensive cleanup function for all internal tool components
 *
 * This function coordinates cleanup across all handler modules, adapters,
 * and related resources. It should be called during application shutdown
 * or when reinitializing the internal tools system.
 *
 * @returns {Promise<void>} Promise that resolves when cleanup is complete
 *
 * @example
 * ```typescript
 * // During application shutdown
 * await cleanupInternalTools();
 * ```
 */
export async function cleanupInternalToolHandlers(): Promise<void> {
  // Execute cleanup for all handler modules
  // Using dynamic imports to avoid circular dependencies
  Promise.all([
    import('./discoveryHandlers.js').then(({ cleanupDiscoveryHandlers }) => {
      cleanupDiscoveryHandlers();
    }),
    import('./installationHandlers.js').then(({ cleanupInstallationHandlers }) => {
      cleanupInstallationHandlers();
    }),
    import('./managementHandlers.js').then(({ cleanupManagementHandlers }) => {
      cleanupManagementHandlers();
    }),
  ]).catch((error) => {
    // Log cleanup errors but don't throw - cleanup should be best-effort
    console.warn('Error during internal tool cleanup:', error);
  });

  // Clean up adapters using the AdapterFactory
  try {
    const { AdapterFactory } = await import('./adapters/index.js');
    AdapterFactory.cleanup();
  } catch (error) {
    // Adapters module not found or other cleanup error - continue with other cleanup
    console.debug('Adapter cleanup skipped (module not found or other error):', error);
  }

  // Call the local cleanup functions directly
  try {
    cleanupDiscoveryHandlers();
    cleanupInstallationHandlers();
    cleanupManagementHandlers();
  } catch (error) {
    console.warn('Error during local cleanup:', error);
  }
}

// ==================== CONVENIENCE EXPORTS ====================

/**
 * Handler Collections by Domain
 *
 * Organized collections of handlers for easier importing and better code organization.
 */
export const DiscoveryHandlers = {
  search: handleMcpSearch,
  registryStatus: handleMcpRegistryStatus,
  registryInfo: handleMcpRegistryInfo,
  registryList: handleMcpRegistryList,
  info: handleMcpInfo,
  cleanup: cleanupDiscoveryHandlers,
} as const;

export const InstallationHandlers = {
  install: handleMcpInstall,
  uninstall: handleMcpUninstall,
  update: handleMcpUpdate,
  cleanup: cleanupInstallationHandlers,
} as const;

export const ManagementHandlers = {
  enable: handleMcpEnable,
  disable: handleMcpDisable,
  list: handleMcpList,
  status: handleMcpStatus,
  reload: handleMcpReload,
  cleanup: cleanupManagementHandlers,
} as const;

/**
 * All Handlers Collection
 *
 * Unified collection containing all available handlers organized by domain.
 */
export const AllHandlers = {
  discovery: DiscoveryHandlers,
  installation: InstallationHandlers,
  management: ManagementHandlers,
  cleanup: cleanupInternalToolHandlers,
} as const;

// ==================== TYPE EXPORTS ====================

/**
 * Handler Function Types
 *
 * TypeScript function type definitions for all handlers, useful for
 * type annotations and generic programming patterns.
 */
export type DiscoveryHandlerType = typeof DiscoveryHandlers;
export type InstallationHandlerType = typeof InstallationHandlers;
export type ManagementHandlerType = typeof ManagementHandlers;
export type AllHandlersType = typeof AllHandlers;

// ==================== MODULE METADATA ====================

/**
 * Module information and version details
 */
export const MODULE_INFO = {
  name: '@1mcp/internal-tools',
  version: '4.0.0',
  description: 'Internal MCP tools for server management and operations',
  domains: ['discovery', 'installation', 'management'] as const,
  exportCount: {
    handlers: 12,
    schemas: 39, // Approximate count from schemas/index.ts
    adapters: 15, // Approximate count from adapters/index.ts
  },
} as const;

// ==================== DEFAULT EXPORT ====================

/**
 * Default export providing all functionality in a single object
 *
 * This enables convenient importing patterns like:
 * ```typescript
 * import InternalTools from './index.js';
 * const { handleMcpSearch, McpSearchToolArgs } = InternalTools;
 * ```
 */
export default {
  // Handlers
  ...DiscoveryHandlers,
  ...InstallationHandlers,
  ...ManagementHandlers,

  // Collections
  DiscoveryHandlers,
  InstallationHandlers,
  ManagementHandlers,
  AllHandlers,

  // Utility functions
  cleanup: cleanupInternalToolHandlers,

  // Module info
  MODULE_INFO,
};
