import { getAllServers, getInstallationMetadata, getServer, setServer } from '@src/commands/mcp/utils/configUtils.js';
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
  async installServer(serverName: string, version?: string, options?: InstallOptions): Promise<InstallResult> {
    const operationId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      logger.info(`Starting installation of ${serverName}${version ? `@${version}` : ''}`);

      // Get server information from registry with ID resolution fallback
      const registryServer = await this.resolveServerById(serverName, version);

      if (!registryServer) {
        throw new Error(`Server '${serverName}' not found in registry`);
      }

      // Select appropriate installation method (package first, remote fallback)
      const selectedEndpoint = this.selectInstallationEndpoint(registryServer);
      if (!selectedEndpoint) {
        // Provide comprehensive error message showing what's available
        const packages = registryServer.packages?.map((p) => `${p.registryType}:${p.identifier}`) || [];
        const remotes = registryServer.remotes?.map((r) => r.type) || [];

        const packageList = packages.length > 0 ? `Available packages: ${packages.join(', ')}` : '';
        const remoteList = remotes.length > 0 ? `Available remote types: ${remotes.join(', ')}` : '';
        const combinedList = [packageList, remoteList].filter(Boolean).join(' | ');

        throw new Error(
          `No compatible installation method found for ${serverName}. ${combinedList || 'No installation methods available'}. This server may not be compatible with your system or installation method.`,
        );
      }

      // Determine the local server name and registry server ID for tagging
      const localServerName = options?.localServerName || serverName;
      const registryServerId = options?.registryServerId || registryServer.name;

      // Generate server configuration with tags
      const _serverConfig = await this.createServerConfig(
        registryServer,
        selectedEndpoint,
        registryServerId,
        localServerName,
        options?.tags,
      );

      // Create installation result
      const result: InstallResult = {
        success: true,
        serverName: localServerName,
        version: registryServer.version,
        installedAt: new Date(),
        configPath: '', // Will be set by command handler
        config: _serverConfig,
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
      logger.error(`Installation failed for ${serverName}: ${errorMessage}`);

      throw error;
    }
  }

  /**
   * Select appropriate installation endpoint (packages first, remotes fallback)
   */
  private selectInstallationEndpoint(
    registryServer: RegistryServer,
  ): { type: string; url: string; isPackage: boolean } | undefined {
    // PRIORITY 1: Check for packages first (primary installation method)
    const packages = registryServer.packages || [];
    if (packages.length > 0) {
      // Prefer npm packages for broad compatibility
      const npmPackage = packages.find((p) => p.registryType === 'npm');
      if (npmPackage) {
        return { type: 'npm', url: npmPackage.identifier, isPackage: true };
      }

      // Fallback to first available package type (pypi, docker, etc.)
      const firstPackage = packages[0];
      return { type: firstPackage.registryType, url: firstPackage.identifier, isPackage: true };
    }

    // PRIORITY 2: Fallback to remotes if no packages available
    const remotes = registryServer.remotes || [];
    if (remotes.length > 0) {
      // Prefer streamable-http (npx-based) as most common
      const streamableHttp = remotes.find((r) => r.type === 'streamable-http');
      if (streamableHttp) {
        return { type: streamableHttp.type, url: streamableHttp.url, isPackage: false };
      }

      // Fallback to first available remote
      return { type: remotes[0].type, url: remotes[0].url, isPackage: false };
    }

    return undefined;
  }

  /**
   * Resolve server ID with fallback mechanism
   * Tries direct lookup first, then search-based resolution if that fails
   */
  private async resolveServerById(serverName: string, version?: string): Promise<RegistryServer> {
    try {
      // Try direct lookup first (for exact registry ID matches)
      return await this.registryClient.getServerById(serverName, version);
    } catch (_error) {
      // If direct lookup fails, try search-based resolution
      logger.debug(`Direct lookup failed for ${serverName}, trying search-based resolution`);

      try {
        // Search for servers matching this name
        const searchResults = await this.registryClient.searchServers({
          query: serverName,
          limit: 10,
        });

        // Find exact or partial matches with priority order
        const matchedServer = searchResults.find(
          (server) =>
            // Exact match first
            server.name === serverName ||
            // Then match if it ends with the server name (e.g., "io.github/user/mysql-read-only-server" matches "mysql-read-only-server")
            server.name.endsWith(`/${serverName}`) ||
            // Then match if it contains the server name
            server.name.includes(serverName),
        );

        if (matchedServer) {
          logger.info(`Found server "${serverName}" as "${matchedServer.name}" in registry`);
          return await this.registryClient.getServerById(matchedServer.name, version);
        }

        // If no matches found, provide helpful error message
        throw new Error(
          `Server '${serverName}' not found in registry. Try searching with '1mcp registry search ${serverName}' to find available servers.`,
        );
      } catch (_searchError) {
        // If search also fails, provide more comprehensive error
        throw new Error(`Server '${serverName}' not found in registry. Suggestions:
1. Check spelling: ${serverName}
2. Search for available servers: 1mcp registry search ${serverName}
3. Use interactive mode: 1mcp mcp install --interactive
4. Use full registry ID (e.g., 'io.github.username/server-name')`);
      }
    }
  }

  /**
   * Create server configuration from registry data
   */
  private async createServerConfig(
    _registryServer: RegistryServer,
    endpoint: { type: string; url: string; isPackage: boolean },
    registryServerId: string,
    localServerName: string,
    existingTags?: string[],
  ): Promise<MCPServerParams> {
    // Add both local server name and registry ID as default tags
    const defaultTags = [localServerName, registryServerId];
    const tags = existingTags ? [...existingTags, ...defaultTags] : defaultTags;

    // Remove duplicates while preserving order
    const uniqueTags = Array.from(new Set(tags));

    // Handle package-based installation
    if (endpoint.isPackage) {
      const config: MCPServerParams = {
        type: 'stdio',
        command: 'npx',
        args: [endpoint.url],
        tags: uniqueTags,
      };

      return config;
    }

    // Handle remote-based installation
    const config: MCPServerParams = {
      type: 'stdio',
      command: endpoint.url,
      tags: uniqueTags,
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
      // Import config utilities to update configuration
      // Get current configuration first - if server isn't installed, we can't update it
      const currentConfig = getServer(serverName);
      if (!currentConfig) {
        throw new Error(`Server '${serverName}' not found in configuration`);
      }

      // Get latest version from registry if not specified
      const targetVersion = version || 'latest';
      const registryServer = await this.registryClient.getServerById(serverName, targetVersion);

      if (!registryServer) {
        throw new Error(`Server '${serverName}' not found in registry`);
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
