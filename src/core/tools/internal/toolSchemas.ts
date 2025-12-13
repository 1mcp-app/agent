/**
 * Tool schemas for internal management tools
 *
 * This module re-exports all tool schemas from the organized structure:
 * - ./schemas/discovery.js - MCP search, registry tools
 * - ./schemas/installation.js - Install/uninstall/update tools
 * - ./schemas/management.js - Enable/disable/list/status/reload tools
 * - ./schemas/edit.js - Configuration editing tools
 * - ./schemas/index.js - Unified exports with examples
 */

// Re-export everything from the new organized structure
export * from './schemas/index.js';

// Explicit re-exports for commonly used patterns

// Discovery domain (mcp_search, mcp_registry_*, mcp_info)
export {
  McpSearchToolSchema,
  McpRegistryStatusSchema,
  McpRegistryInfoSchema,
  McpRegistryListSchema,
  McpInfoToolSchema,
  McpSearchOutputSchema,
  McpRegistryStatusOutputSchema,
  McpRegistryInfoOutputSchema,
  McpRegistryListOutputSchema,
  McpInfoOutputSchema,
  type McpSearchToolArgs,
  type McpRegistryStatusToolArgs,
  type McpRegistryInfoToolArgs,
  type McpRegistryListToolArgs,
  type McpInfoToolArgs,
} from './schemas/discovery.js';

// Installation domain (mcp_install, mcp_uninstall, mcp_update)
export {
  McpInstallToolSchema,
  McpUninstallToolSchema,
  McpUpdateToolSchema,
  McpInstallOutputSchema,
  McpUninstallOutputSchema,
  McpUpdateOutputSchema,
  type McpInstallToolArgs,
  type McpUninstallToolArgs,
  type McpUpdateToolArgs,
} from './schemas/installation.js';

// Management domain (mcp_enable, mcp_disable, mcp_list, mcp_status, mcp_reload)
export {
  McpEnableToolSchema,
  McpDisableToolSchema,
  McpListToolSchema,
  McpStatusToolSchema,
  McpReloadToolSchema,
  McpEnableOutputSchema,
  McpDisableOutputSchema,
  McpListOutputSchema,
  McpStatusOutputSchema,
  McpReloadOutputSchema,
  type McpEnableToolArgs,
  type McpDisableToolArgs,
  type McpListToolArgs,
  type McpStatusToolArgs,
  type McpReloadToolArgs,
} from './schemas/management.js';

// Edit domain (mcp_edit)
export {
  McpEditToolSchema,
  McpEditOutputSchema,
  type McpEditToolArgs,
  type McpEditOutput,
  type ConfigChange,
} from './schemas/edit.js';
