import type { MCPServerParams } from '@src/core/types/index.js';
import type { RegistryServer } from '@src/domains/registry/types.js';

/**
 * Type definitions for MCP server management domain
 */

/**
 * Installation status enum
 */
export enum InstallationStatus {
  NOT_INSTALLED = 'not_installed',
  INSTALLED = 'installed',
  UPDATING = 'updating',
  FAILED = 'failed',
  UNINSTALLING = 'uninstalling',
  OUTDATED = 'outdated',
  CORRUPTED = 'corrupted',
  DISABLED = 'disabled',
}

/**
 * Backup operation type
 */
export enum BackupOperation {
  INSTALL = 'install',
  UPDATE = 'update',
  UNINSTALL = 'uninstall',
  CONFIG_CHANGE = 'config_change',
}

/**
 * Dependency resolution status
 */
export interface DependencyResolution {
  status: 'resolved' | 'missing' | 'conflict' | 'warning';
  resolvedDependencies: ResolvedDependency[];
  missingDependencies: string[];
  conflicts: DependencyConflict[];
}

/**
 * Resolved dependency information
 */
export interface ResolvedDependency {
  name: string;
  version: string;
  status: 'installed' | 'available' | 'missing';
}

/**
 * Dependency conflict information
 */
export interface DependencyConflict {
  dependency: string;
  requiredVersions: string[];
  message: string;
}

/**
 * Represents an installed MCP server with metadata and lifecycle state
 */
export interface McpServerInstallation {
  // Primary identification
  id: string; // Server identifier (from registry)
  name: string; // User-defined name (unique in configuration)
  version: string; // Installed version

  // Registry information
  registryEntry: RegistryServer; // Original registry metadata

  // Installation metadata
  installedAt: Date; // Installation timestamp
  installedBy: string; // 1MCP version that performed installation
  installPath?: string; // Local installation path (if applicable)

  // Configuration
  config: MCPServerParams; // Server configuration overrides

  // Status and lifecycle
  status: InstallationStatus; // Current installation status
  lastUpdateCheck?: Date; // Last time updates were checked
  availableUpdate?: string; // Latest available version (if different)

  // Dependencies
  dependencies: string[]; // List of required dependencies
  dependencyResolution: DependencyResolution;
}

/**
 * Installation options
 */
export interface InstallOptions {
  force?: boolean; // Force installation even if already exists
  dryRun?: boolean; // Show what would be installed without installing
  verbose?: boolean; // Detailed output
  localServerName?: string; // Custom name for the local server configuration
  registryServerId?: string; // Full registry server ID for tagging purposes
  tags?: string[]; // Tags to apply to the installed server
  env?: Record<string, string>; // Environment variables for the server
  args?: string[]; // Command line arguments for the server
}

/**
 * Update options
 */
export interface UpdateOptions {
  version?: string; // Specific version to update to
  backup?: boolean; // Create backup before update (default: true)
  dryRun?: boolean; // Show what would be updated
  verbose?: boolean; // Detailed output
}

/**
 * Uninstall options
 */
export interface UninstallOptions {
  force?: boolean; // Skip confirmation prompts
  backup?: boolean; // Create backup before removal (default: true)
  removeConfig?: boolean; // Remove server configuration (default: true)
  verbose?: boolean; // Detailed output
}

/**
 * Installation result
 */
export interface InstallResult {
  success: boolean;
  serverName: string;
  version: string;
  installedAt: Date;
  configPath: string;
  config?: MCPServerParams; // Generated configuration
  backupPath?: string; // Created if replacing existing server
  warnings: string[];
  errors: string[];
  operationId: string; // For tracking progress
}

/**
 * Update result
 */
export interface UpdateResult {
  success: boolean;
  serverName?: string; // Single server update (for backward compatibility)
  previousVersion?: string; // Previous version
  newVersion?: string; // New version
  updatedAt?: Date; // Update timestamp
  updatedServers?: UpdatedServer[]; // Batch update servers
  skippedServers?: SkippedServer[];
  failedServers?: FailedServer[];
  backupPath?: string; // Created if backup made
  operationId: string; // For tracking progress
  warnings: string[]; // Warnings
  errors: string[]; // Errors
}

/**
 * Updated server information
 */
export interface UpdatedServer {
  serverName: string;
  previousVersion: string;
  newVersion: string;
  updatedAt: Date;
  warnings: string[];
}

/**
 * Skipped server information
 */
export interface SkippedServer {
  serverName: string;
  reason: 'uptodate' | 'excluded' | 'notfound';
}

/**
 * Failed server information
 */
export interface FailedServer {
  serverName: string;
  error: string;
  restored?: boolean; // If backup was restored
}

/**
 * Uninstall result
 */
export interface UninstallResult {
  success: boolean;
  serverName: string;
  removedAt: Date;
  backupPath?: string; // Created if backup made
  configRemoved: boolean;
  warnings: string[];
  errors: string[];
  operationId: string; // For tracking progress
}

/**
 * Update check result
 */
export interface UpdateCheckResult {
  serverName: string;
  currentVersion?: string;
  latestVersion: string;
  hasUpdate?: boolean; // Alias for backward compatibility
  updateAvailable: boolean;
  updateType?: 'major' | 'minor' | 'patch';
  compatibility?: {
    nodeVersion: string;
    platformCompatibility: string[];
    mcpVersion: string;
  };
}

/**
 * List options for installed servers
 */
export interface ListOptions {
  includeDisabled?: boolean;
  includeOutdated?: boolean;
  filterActive?: boolean; // Filter to only active servers
  filters?: {
    tags?: string[];
    status?: InstallationStatus[];
  };
}

/**
 * Installed server information
 */
export interface InstalledServer {
  name: string;
  version: string;
  status: InstallationStatus;
  installedAt: Date;
  lastUpdateCheck?: Date;
  availableUpdate?: string;
  registryInfo?: {
    name: string;
    description: string;
  };
}
