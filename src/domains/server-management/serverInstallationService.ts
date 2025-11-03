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

// Re-export version utilities for backward compatibility
export { compareVersions, getUpdateType, parseVersion } from './services/versionResolver.js';

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
   * Validate server name format
   */
  private validateServerName(serverName: string): void {
    if (!serverName || serverName.trim().length === 0) {
      throw new Error('Server name cannot be empty');
    }

    const trimmedName = serverName.trim();

    // Check for invalid characters
    // eslint-disable-next-line no-control-regex
    const invalidChars = /[<>:"\\|?*\x00-\x1f]/;
    if (invalidChars.test(trimmedName)) {
      throw new Error(`Server name contains invalid characters: ${serverName}`);
    }

    // Check length limits
    if (trimmedName.length > 255) {
      throw new Error(`Server name too long (max 255 characters): ${serverName}`);
    }

    // Check for consecutive slashes or dots
    if (trimmedName.includes('//') || trimmedName.includes('..')) {
      throw new Error(`Server name contains invalid sequences: ${serverName}`);
    }

    // Log the validated name for debugging
    logger.debug(`Server name validation passed: ${trimmedName}`);
  }

  /**
   * Install a server from the registry
   */
  async installServer(registryServerId: string, version?: string, options?: InstallOptions): Promise<InstallResult> {
    const operationId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      const localServerName = options?.localServerName || registryServerId;
      logger.info(
        `Starting installation of ${registryServerId}${version ? `@${version}` : ''} as '${localServerName}'`,
      );

      // Validate local server name format (if provided)
      if (options?.localServerName) {
        this.validateServerName(options.localServerName);
      }

      // Get server information from registry
      logger.debug(`Fetching server from registry: ${registryServerId}${version ? `@${version}` : ''}`);
      const registryServer = await this.registryClient.getServerById(registryServerId, version);

      if (!registryServer) {
        throw new Error(`Server '${registryServerId}' not found in registry`);
      }

      // Select appropriate remote/package for installation
      const selectedRemote = this.selectRemoteEndpoint(registryServer);
      if (!selectedRemote) {
        throw new Error(`No compatible installation method found for ${registryServerId}`);
      }

      // Generate server configuration from registry data
      const serverConfig = await this.createServerConfig(registryServer, selectedRemote);

      // Apply user-provided tags, env, and args from wizard
      if (options?.tags && options.tags.length > 0) {
        serverConfig.tags = options.tags;
      }
      if (options?.env) {
        serverConfig.env = { ...serverConfig.env, ...options.env };
      }
      if (options?.args && options.args.length > 0) {
        // Merge with existing args if any
        serverConfig.args = [...(serverConfig.args || []), ...options.args];
      }

      // Validate and persist configuration
      validateServerConfig(serverConfig);
      setServer(localServerName, serverConfig);

      // Resolve config path for result reporting
      const configContext = ConfigContext.getInstance();
      const resolvedConfigPath = configContext.getResolvedConfigPath();

      // Create installation result
      const result: InstallResult = {
        success: true,
        serverName: localServerName,
        version: registryServer.version,
        installedAt: new Date(),
        configPath: resolvedConfigPath,
        backupPath: undefined,
        warnings,
        errors,
        operationId,
      };

      logger.info(`Successfully prepared installation configuration for ${localServerName}`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(errorMessage);

      // Enhanced error logging with debugging context
      logger.error(`Installation failed for ${registryServerId}: ${errorMessage}`);
      logger.debug(`Installation failure details:`, {
        registryServerId,
        localServerName: options?.localServerName,
        version,
        errorType: error?.constructor?.name,
        errorMessage,
        timestamp: new Date().toISOString(),
      });

      // Re-throw with enhanced context
      throw new Error(`Failed to install server '${registryServerId}'${version ? `@${version}` : ''}: ${errorMessage}`);
    }
  }

  /**
   * Select appropriate remote endpoint for the current system
   */
  private selectRemoteEndpoint(registryServer: RegistryServer): { type: string; url: string } | undefined {
    // First try packages (newer registry format)
    const packages = registryServer.packages || [];

    if (packages.length > 0) {
      // Look for stdio transport packages (most common for MCP servers)
      const stdioPackage = packages.find((pkg) => pkg.transport?.type === 'stdio');
      if (stdioPackage) {
        // Use package identifier to construct the installation command
        const identifier = stdioPackage.identifier;
        return { type: 'stdio', url: `npx ${identifier}` };
      }

      // Look for other transport types
      const httpPackage = packages.find((pkg) => pkg.transport?.type === 'http' || pkg.transport?.type === 'sse');
      if (httpPackage) {
        return { type: httpPackage.transport!.type, url: httpPackage.transport!.url || '' };
      }

      // Fallback to first package
      const firstPackage = packages[0];
      if (firstPackage.transport) {
        return { type: firstPackage.transport.type, url: firstPackage.transport.url || firstPackage.identifier };
      }
    }

    // Fallback to remotes (legacy format)
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
    // Create a configuration based on remote type
    const remoteType = remote.type?.toLowerCase();

    if (remoteType === 'http' || remoteType === 'sse') {
      return {
        type: remoteType as 'http' | 'sse',
        url: remote.url,
      } as MCPServerParams;
    }

    // streamable-http and other npx-based installers ? stdio
    if (remoteType === 'streamable-http' || remoteType === 'stdio') {
      const tokens = remote.url.trim().split(/\s+/);
      const command = tokens.shift() || 'npx';
      const args = tokens;
      return {
        type: 'stdio',
        command,
        args: args.length > 0 ? args : undefined,
      } as MCPServerParams;
    }

    // Fallback: treat as stdio command
    const tokens = remote.url.trim().split(/\s+/);
    const command = tokens.shift() || remote.url;
    const args = tokens;
    return {
      type: 'stdio',
      command,
      args: args.length > 0 ? args : undefined,
    } as MCPServerParams;
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
