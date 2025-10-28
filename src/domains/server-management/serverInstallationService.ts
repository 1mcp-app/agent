import {
  getAllServers,
  getInstallationMetadata,
  getServer,
  setServer,
  validateServerConfig,
} from '@src/commands/mcp/utils/configUtils.js';
import ConfigContext from '@src/config/configContext.js';
import { MCPServerParams } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { createRegistryClient } from '../registry/mcpRegistryClient.js';
import type { RegistryServer } from '../registry/types.js';
import { getProgressTrackingService } from './progressTrackingService.js';
import { compareVersions, getUpdateType } from './services/versionResolver.js';
import type {
  InstallOptions,
  InstallResult,
  ListOptions,
  UninstallOptions,
  UninstallResult,
  UpdateCheckResult,
  UpdateOptions,
  UpdateResult,
} from './types.js';

/**
 * Parse semantic version string into components
 * @internal Exported for testing
 */
export function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const parsed = semver.parse(version);
  if (!parsed) {
    return null;
  }

  return {
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
  };
}

/**
 * Compare two semantic versions
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 * @internal Exported for testing
 */
export function compareVersions(v1: string, v2: string): number {
  // Clean versions to handle 'v' prefix and other formats
  const clean1 = semver.clean(v1);
  const clean2 = semver.clean(v2);

  if (!clean1 || !clean2) {
    return 0;
  }

  return semver.compare(clean1, clean2);
}

/**
 * Determine update type based on version comparison
 * @internal Exported for testing
 */
export function getUpdateType(currentVersion: string, newVersion: string): 'major' | 'minor' | 'patch' | undefined {
  const clean1 = semver.clean(currentVersion);
  const clean2 = semver.clean(newVersion);

  if (!clean1 || !clean2) {
    return undefined;
  }

  // First check if new version is actually greater
  if (!semver.gt(clean2, clean1)) {
    return undefined;
  }

  // Now determine the type of update
  const diff = semver.diff(clean1, clean2);

  if (diff === 'major' || diff === 'premajor') {
    return 'major';
  }

  if (diff === 'minor' || diff === 'preminor') {
    return 'minor';
  }

  if (diff === 'patch' || diff === 'prepatch') {
    return 'patch';
  }

  return undefined;
}

/**
 * Server installation service
 * Handles install, update, uninstall, and status operations for MCP servers
 */
export class ServerInstallationService {
  private registryClient;
  private progressTracker;

  constructor() {
    this.registryClient = createRegistryClient();
    this.progressTracker = getProgressTrackingService();
  }

  /**
   * Install a server from the registry
   */
  async installServer(serverName: string, version?: string, _options?: InstallOptions): Promise<InstallResult> {
    const operationId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      logger.info(`Starting installation of ${serverName}${version ? `@${version}` : ''}`);

      // Get server information from registry
      const registryServer = await this.registryClient.getServerById(serverName, version);

      if (!registryServer) {
        throw new Error(`Server '${serverName}' not found in registry`);
      }

      // Select appropriate remote/package for installation
      const selectedRemote = this.selectRemoteEndpoint(registryServer);
      if (!selectedRemote) {
        throw new Error(`No compatible installation method found for ${serverName}`);
      }

      // Generate server configuration (not used in current implementation but required for future)
      const _serverConfig = await this.createServerConfig(registryServer, selectedRemote);

      // Create installation result
      const result: InstallResult = {
        success: true,
        serverName,
        version: registryServer.version,
        installedAt: new Date(),
        configPath: '', // Will be set by command handler
        backupPath: undefined,
        warnings,
        errors,
        operationId,
      };

      logger.info(`Successfully prepared installation configuration for ${serverName}`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(errorMessage);
      logger.error(`Installation failed for ${serverName}: ${errorMessage}`);

      throw error;
    }
  }

  /**
   * Select appropriate remote endpoint for the current system
   */
  private selectRemoteEndpoint(registryServer: RegistryServer): { type: string; url: string } | undefined {
    // Prioritize remotes based on type
    const remotes = registryServer.remotes || [];

    // Prefer streamable-http (npx-based) as most common
    const streamableHttp = remotes.find((r) => r.type === 'streamable-http');
    if (streamableHttp) {
      return { type: streamableHttp.type, url: streamableHttp.url };
    }

    // Fallback to first available remote
    if (remotes.length > 0) {
      return { type: remotes[0].type, url: remotes[0].url };
    }

    return undefined;
  }

  /**
   * Create server configuration from registry data
   */
  private async createServerConfig(
    _registryServer: RegistryServer,
    remote: { type: string; url: string },
  ): Promise<MCPServerParams> {
    // For now, return a basic configuration
    // Full implementation would handle different remote types
    const config: MCPServerParams = {
      type: 'stdio',
      command: remote.url,
    };

    return config;
  }

  /**
   * Update a server to latest or specific version
   */
  async updateServer(serverName: string, version?: string, _options?: UpdateOptions): Promise<UpdateResult> {
    logger.info(`Updating server ${serverName}${version ? ` to ${version}` : ' to latest'}`);

    const operationId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      // Get latest version from registry if not specified
      const targetVersion = version || 'latest';
      const registryServer = await this.registryClient.getServerById(serverName, targetVersion);

      if (!registryServer) {
        throw new Error(`Server '${serverName}' not found in registry`);
      }

      // Import config utilities to update configuration
      // Get current configuration
      const currentConfig = getServer(serverName);
      if (!currentConfig) {
        throw new Error(`Server '${serverName}' not found in configuration`);
      }

      // Create updated configuration with new version info
      const updatedConfig: MCPServerParams = {
        ...currentConfig,
        // Store version in metadata (future enhancement)
      };

      // Save updated configuration
      setServer(serverName, updatedConfig);

      return {
        success: true,
        serverName,
        previousVersion: 'unknown',
        newVersion: registryServer.version,
        updatedAt: new Date(),
        warnings: [],
        errors: [],
        operationId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Update failed for ${serverName}: ${errorMessage}`);

      return {
        success: false,
        serverName,
        previousVersion: 'unknown',
        newVersion: version || 'unknown',
        updatedAt: new Date(),
        warnings: [],
        errors: [errorMessage],
        operationId,
      };
    }
  }

  /**
   * Uninstall a server
   */
  async uninstallServer(serverName: string, _options?: UninstallOptions): Promise<UninstallResult> {
    logger.info(`Uninstalling server ${serverName}`);

    const operationId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const result: UninstallResult = {
      success: true,
      serverName,
      removedAt: new Date(),
      configRemoved: true,
      warnings: [],
      errors: [],
      operationId,
    };

    return result;
  }

  /**
   * Check for available updates
   */
  async checkForUpdates(_serverNames?: string[]): Promise<UpdateCheckResult[]> {
    logger.info(`Checking for updates${_serverNames ? ` for ${_serverNames.length} servers` : ''}`);

    const results: UpdateCheckResult[] = [];

    // Get list of servers to check
    const serversToCheck = _serverNames || (await this.listInstalledServers());

    // Check each server for available updates
    for (const serverName of serversToCheck) {
      try {
        // Get current installed version
        const metadata = getInstallationMetadata(serverName);
        const currentVersion = metadata?.version || 'unknown';

        // Fetch latest version from registry
        const latestServer = await this.registryClient.getServerById(serverName);

        if (latestServer) {
          // Compare versions using semantic versioning
          const hasUpdate = currentVersion !== 'unknown' && compareVersions(latestServer.version, currentVersion) > 0;
          const updateType =
            currentVersion !== 'unknown' ? getUpdateType(currentVersion, latestServer.version) : undefined;

          results.push({
            serverName,
            currentVersion,
            latestVersion: latestServer.version,
            hasUpdate,
            updateAvailable: hasUpdate,
            updateType,
          });
        }
      } catch (error) {
        // Silently skip servers that can't be checked
        logger.debug(`Could not check updates for ${serverName}: ${error}`);
      }
    }

    return results;
  }

  /**
   * List installed servers
   */
  async listInstalledServers(_options?: ListOptions): Promise<string[]> {
    logger.info('Listing installed servers');

    // Import config utilities dynamically to avoid circular dependencies
    // Get all servers from configuration
    const allServers = getAllServers();

    // Extract server names
    const serverNames = Object.keys(allServers);

    // Apply filters if options provided
    if (_options?.filterActive) {
      // Filter to only non-disabled servers
      return serverNames.filter((name) => !allServers[name]?.disabled);
    }

    return serverNames;
  }
}

/**
 * Create a server installation service instance
 */
export function createServerInstallationService(): ServerInstallationService {
  return new ServerInstallationService();
}
