import { getServer, setServer } from '@src/commands/shared/baseConfigUtils.js';
import { MCPServerParams } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

// Import all core configuration utilities from baseConfigUtils
export * from '@src/commands/shared/baseConfigUtils.js';

/**
 * Extended server params with metadata
 */
interface MCPServerParamsWithMetadata extends MCPServerParams {
  _metadata?: {
    installedAt: string; // ISO date string
    installedBy?: string;
    version: string;
    registryId?: string; // Original registry ID
    lastUpdated?: string; // ISO date string
  };
}

/**
 * Set installation metadata for a server
 */
export function setInstallationMetadata(
  serverName: string,
  metadata: {
    version: string;
    registryId?: string;
    installedBy?: string;
  },
): void {
  const server = getServer(serverName);
  if (!server) {
    logger.warn('mcpServerConfig.cannot.set.metadata.for.non.existent.server.6b7bd7a4');
    return;
  }

  const serverWithMetadata = server as MCPServerParamsWithMetadata;
  serverWithMetadata._metadata = {
    installedAt: new Date().toISOString(),
    version: metadata.version,
    registryId: metadata.registryId,
    installedBy: metadata.installedBy,
    lastUpdated: new Date().toISOString(),
  };

  setServer(serverName, serverWithMetadata);
}

/**
 * Update installation metadata for a server
 */
export function updateInstallationMetadata(
  serverName: string,
  updates: {
    version?: string;
  },
): void {
  const server = getServer(serverName) as MCPServerParamsWithMetadata;
  if (!server) {
    logger.warn('mcpServerConfig.cannot.update.metadata.for.non.existent.server.baf4ecbd');
    return;
  }

  if (!server._metadata) {
    logger.warn('mcpServerConfig.no.metadata.found.for.server.f6c7e306');
    return;
  }

  server._metadata = {
    ...server._metadata,
    ...updates,
    lastUpdated: new Date().toISOString(),
  };

  setServer(serverName, server);
}

/**
 * Get installation metadata for a server
 * Returns metadata about when and how the server was installed
 */
export function getInstallationMetadata(serverName: string): {
  installedAt?: Date;
  installedBy?: string;
  version?: string;
  registryId?: string;
  lastUpdated?: Date;
} | null {
  try {
    const server = getServer(serverName) as MCPServerParamsWithMetadata;
    if (!server || !server._metadata) {
      return null;
    }

    const metadata = server._metadata;
    return {
      installedAt: new Date(metadata.installedAt),
      installedBy: metadata.installedBy,
      version: metadata.version,
      registryId: metadata.registryId,
      lastUpdated: metadata.lastUpdated ? new Date(metadata.lastUpdated) : undefined,
    };
  } catch (_error) {
    logger.error('mcpServerConfig.failed.to.get.installation.metadata.for.509a9169', { error: _error });
    return null;
  }
}

/**
 * Remove installation metadata for a server
 */
export function removeInstallationMetadata(serverName: string): void {
  const server = getServer(serverName) as MCPServerParamsWithMetadata;
  if (!server) {
    return;
  }

  delete server._metadata;
  setServer(serverName, server);
}
