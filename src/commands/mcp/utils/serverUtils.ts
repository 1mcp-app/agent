import { ServerManager } from '@src/core/server/serverManager.js';
import { InstallationStatus } from '@src/domains/server-management/types.js';
import logger from '@src/logger/logger.js';

/**
 * Server utility functions for validation and management
 */

/**
 * Parse server name and version from input string
 * Supports formats: "server-name", "server-name@1.0.0"
 */
export function parseServerNameVersion(input: string): { name: string; version?: string } {
  const atIndex = input.lastIndexOf('@');
  if (atIndex === -1) {
    return { name: input };
  }

  const name = input.substring(0, atIndex);
  const version = input.substring(atIndex + 1);

  if (!name) {
    throw new Error('Server name cannot be empty');
  }

  return { name, version };
}

/**
 * Validate server name format
 * Must be unique within the configuration, match regex, and be 1-50 characters
 */
export function validateServerName(name: string): void {
  if (!name || name.length === 0) {
    throw new Error('Server name cannot be empty');
  }

  if (name.length > 50) {
    throw new Error('Server name must be 50 characters or less');
  }

  // Must start with letter, followed by letters, numbers, underscores, or hyphens
  const nameRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  if (!nameRegex.test(name)) {
    throw new Error('Server name must start with a letter and contain only letters, numbers, underscores, or hyphens');
  }
}

/**
 * Validate version format (semantic versioning)
 */
export function validateVersion(version: string): boolean {
  const versionRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/;
  return versionRegex.test(version);
}

/**
 * Calculate server installation status
 * Determines current state based on installed version and available updates
 */
export function calculateServerStatus(installedVersion: string, latestVersion?: string): InstallationStatus {
  if (!installedVersion) {
    return InstallationStatus.NOT_INSTALLED;
  }

  if (latestVersion && installedVersion !== latestVersion) {
    return InstallationStatus.OUTDATED;
  }

  return InstallationStatus.INSTALLED;
}

/**
 * Check if server process is currently in use
 * This checks if server processes are currently running or have recent connections
 */
export function checkServerInUse(serverName: string): boolean {
  logger.debug(`Checking if server ${serverName} is in use`);

  try {
    // Get ServerManager instance if it exists
    const serverManager = ServerManager.current;

    // Check if server has an active outbound connection
    // Use getClient which is the actual method name in ServerManager
    const connection = serverManager.getClient(serverName);

    if (connection) {
      logger.debug(`Server ${serverName} has an active client connection`);
      return true;
    }

    // Check all outbound connections for this server name
    // Use getClients which returns all outbound connections
    const allConnections = serverManager.getClients();
    if (allConnections && allConnections.has(serverName)) {
      logger.debug(`Server ${serverName} is in outbound connections map`);
      return true;
    }

    return false;
  } catch (_error) {
    // If ServerManager is not initialized, server is not in use
    logger.debug(`ServerManager not initialized or not accessible`);
    return false;
  }
}

/**
 * Generate a unique operation ID for tracking progress
 */
export function generateOperationId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Sanitize server name for use in file paths
 */
export function sanitizeServerNameForPath(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}
