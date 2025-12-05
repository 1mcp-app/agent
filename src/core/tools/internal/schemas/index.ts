// ==================== SCHEMA ORGANIZATION ====================
/**
 * Schema organization reference for developers:
 *
 * Discovery Tools (discovery.ts):
 * - mcp_search: Search MCP registry for servers
 * - mcp_registry_status: Check registry availability
 * - mcp_registry_info: Get detailed registry information
 * - mcp_registry_list: List available registries
 * - mcp_info: Get detailed server information
 *
 * Installation Tools (installation.ts):
 * - mcp_install: Install MCP server
 * - mcp_uninstall: Remove MCP server
 * - mcp_update: Update MCP server
 *
 * Management Tools (management.ts):
 * - mcp_enable: Enable MCP server
 * - mcp_disable: Disable MCP server
 * - mcp_list: List MCP servers
 * - mcp_status: Get server status
 * - mcp_reload: Reload server or configuration
 */
// ==================== MIGRATION STATUS ====================
/**
 * JSON Schema Migration Progress:
 *
 * Phase 1 (Current) - Organization and Examples:
 * ✅ Split monolithic schemas.ts into domain-focused modules
 * ✅ Create comprehensive index.ts for backward compatibility
 * ✅ Add JSON Schema examples for discovery domain (3 schemas)
 * ✅ Add JSON Schema examples for installation domain (2 schemas)
 * ✅ Add JSON Schema examples for management domain (3 schemas)
 *
 * Phase 2 (Future) - Complete Migration:
 * 🔄 Convert all remaining Zod schemas to JSON Schema
 * 🔄 Update handlers to use JSON Schema validation
 * 🔄 Remove Zod dependencies from schema modules
 * 🔄 Add comprehensive JSON Schema tests
 *
 * Migration Notes:
 * - JSON Schema examples use `as const` for type inference
 * - Interface types provide TypeScript support for JSON schemas
 * - All existing functionality preserved during migration
 * - Handlers can gradually adopt JSON Schema validation
 */
import {
  McpInfoOutputSchema,
  McpInfoToolSchema,
  McpRegistryInfoOutputSchema,
  McpRegistryInfoSchema,
  McpRegistryListOutputSchema,
  McpRegistryListSchema,
  McpRegistryStatusOutputSchema,
  McpRegistryStatusSchema,
  McpSearchOutputSchema,
  McpSearchToolSchema,
} from './discovery.js';
import {
  McpInstallOutputSchema,
  McpInstallToolSchema,
  McpUninstallOutputSchema,
  McpUninstallToolSchema,
  McpUpdateOutputSchema,
  McpUpdateToolSchema,
} from './installation.js';
import {
  McpDisableOutputSchema,
  McpDisableToolSchema,
  McpEnableOutputSchema,
  McpEnableToolSchema,
  McpListOutputSchema,
  McpListToolSchema,
  McpReloadOutputSchema,
  McpReloadToolSchema,
  McpStatusOutputSchema,
  McpStatusToolSchema,
} from './management.js';

/**
 * Internal tool schemas - Consolidated exports
 *
 * This module provides a unified export interface for all internal tool schemas,
 * maintaining backward compatibility while enabling the new organized structure.
 *
 * The schemas are organized by functional domain:
 * - Discovery: MCP search, registry operations, server information
 * - Installation: Install, uninstall, update operations
 * - Management: Enable/disable, listing, status, reload operations
 */

// Re-export all schemas from domain modules for backward compatibility
export * from './discovery.js';
export * from './installation.js';
export * from './management.js';

// ==================== BACKWARD COMPATIBILITY ====================

/**
 * Export mapping to maintain existing import patterns.
 *
 * Existing code using:
 * ```typescript
 * import { McpSearchToolSchema } from './toolSchemas.js';
 * ```
 *
 * Will continue to work through these re-exports.
 */

// Discovery schemas
export {
  // Input schemas
  McpSearchToolSchema,
  McpRegistryStatusSchema,
  McpRegistryInfoSchema,
  McpRegistryListSchema,
  McpInfoToolSchema,
  // JSON Schema examples
  McpSearchToolJsonSchema,
  McpRegistryStatusJsonSchema,
  McpInfoToolJsonSchema,
  // Output schemas
  McpSearchOutputSchema,
  McpRegistryStatusOutputSchema,
  McpRegistryInfoOutputSchema,
  McpRegistryListOutputSchema,
  McpInfoOutputSchema,
  // Types
  type McpSearchToolArgs,
  type McpRegistryStatusToolArgs,
  type McpRegistryInfoToolArgs,
  type McpRegistryListToolArgs,
  type McpInfoToolArgs,
  type McpSearchToolJsonArgs,
  type McpRegistryStatusJsonArgs,
  type McpInfoToolJsonArgs,
  type McpSearchOutput,
  type McpRegistryStatusOutput,
  type McpRegistryInfoOutput,
  type McpRegistryListOutput,
  type McpInfoOutput,
} from './discovery.js';

// Installation schemas
export {
  // Input schemas
  McpInstallToolSchema,
  McpUninstallToolSchema,
  McpUpdateToolSchema,
  // JSON Schema examples
  McpInstallToolJsonSchema,
  McpUninstallToolJsonSchema,
  // Output schemas
  McpInstallOutputSchema,
  McpUninstallOutputSchema,
  McpUpdateOutputSchema,
  // Types
  type McpInstallToolArgs,
  type McpUninstallToolArgs,
  type McpUpdateToolArgs,
  type McpInstallToolJsonArgs,
  type McpUninstallToolJsonArgs,
  type McpUpdateToolJsonArgs,
  type McpInstallOutput,
  type McpUninstallOutput,
  type McpUpdateOutput,
} from './installation.js';

// Management schemas
export {
  // Input schemas
  McpEnableToolSchema,
  McpDisableToolSchema,
  McpListToolSchema,
  McpStatusToolSchema,
  McpReloadToolSchema,
  // JSON Schema examples
  McpEnableToolJsonSchema,
  McpListToolJsonSchema,
  McpReloadToolJsonSchema,
  // Output schemas
  McpEnableOutputSchema,
  McpDisableOutputSchema,
  McpListOutputSchema,
  McpStatusOutputSchema,
  McpReloadOutputSchema,
  // Types
  type McpEnableToolArgs,
  type McpDisableToolArgs,
  type McpListToolArgs,
  type McpStatusToolArgs,
  type McpReloadToolArgs,
  type McpEnableToolJsonArgs,
  type McpListToolJsonArgs,
  type McpStatusToolJsonArgs,
  type McpReloadToolJsonArgs,
  type McpEnableOutput,
  type McpDisableOutput,
  type McpListOutput,
  type McpStatusOutput,
  type McpReloadOutput,
} from './management.js';

export default {
  // Provide a default export that contains all schemas for convenience
  discovery: {
    input: {
      McpSearchToolSchema,
      McpRegistryStatusSchema,
      McpRegistryInfoSchema,
      McpRegistryListSchema,
      McpInfoToolSchema,
    },
    output: {
      McpSearchOutputSchema,
      McpRegistryStatusOutputSchema,
      McpRegistryInfoOutputSchema,
      McpRegistryListOutputSchema,
      McpInfoOutputSchema,
    },
  },
  installation: {
    input: {
      McpInstallToolSchema,
      McpUninstallToolSchema,
      McpUpdateToolSchema,
    },
    output: {
      McpInstallOutputSchema,
      McpUninstallOutputSchema,
      McpUpdateOutputSchema,
    },
  },
  management: {
    input: {
      McpEnableToolSchema,
      McpDisableToolSchema,
      McpListToolSchema,
      McpStatusToolSchema,
      McpReloadToolSchema,
    },
    output: {
      McpEnableOutputSchema,
      McpDisableOutputSchema,
      McpListOutputSchema,
      McpStatusOutputSchema,
      McpReloadOutputSchema,
    },
  },
};
