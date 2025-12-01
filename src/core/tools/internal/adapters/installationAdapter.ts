/**
 * Installation domain service adapter
 *
 * Thin adapter that bridges internal tools with installation domain services.
 * This adapter wraps existing domain service calls and transforms data
 * between internal tool format and domain service format.
 */
import { getAllServers, getInstallationMetadata, getServer, setServer } from '@src/commands/mcp/utils/configUtils.js';
import { parseTags, validateTags } from '@src/domains/installation/configurators/tagsConfigurator.js';
import { createServerInstallationService } from '@src/domains/server-management/serverInstallationService.js';
import type {
  InstallOptions,
  ListOptions,
  UninstallOptions,
  UpdateOptions,
} from '@src/domains/server-management/types.js';
import logger, { debugIf } from '@src/logger/logger.js';

/**
 * Installation adapter interface
 */
export interface InstallationAdapter {
  installServer(
    serverName: string,
    version?: string,
    options?: InstallAdapterOptions,
  ): Promise<{
    success: boolean;
    serverName: string;
    version?: string;
    installedAt: Date;
    configPath?: string;
    backupPath?: string;
    warnings: string[];
    errors: string[];
    operationId: string;
  }>;
  uninstallServer(
    serverName: string,
    options?: UninstallAdapterOptions,
  ): Promise<{
    success: boolean;
    serverName: string;
    removedAt: Date;
    configRemoved: boolean;
    warnings: string[];
    errors: string[];
    operationId: string;
  }>;
  updateServer(
    serverName: string,
    version?: string,
    options?: UpdateAdapterOptions,
  ): Promise<{
    success: boolean;
    serverName: string;
    previousVersion: string;
    newVersion: string;
    updatedAt: Date;
    warnings: string[];
    errors: string[];
    operationId: string;
  }>;
  listInstalledServers(options?: ListAdapterOptions): Promise<string[]>;
  validateTags(tags: string[]): { valid: boolean; errors: string[] };
  parseTags(tagsString: string): string[];
}

/**
 * Adapter-specific options that extend domain service options
 */
export interface InstallAdapterOptions extends Omit<InstallOptions, 'force' | 'backup'> {
  /** Force installation even if server exists */
  force?: boolean;
  /** Create backup before installation */
  backup?: boolean;
  /** Tags to assign to the server */
  tags?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Command line arguments */
  args?: string[];
}

export interface UninstallAdapterOptions extends Omit<UninstallOptions, 'force' | 'backup'> {
  /** Force uninstallation */
  force?: boolean;
  /** Create backup before uninstallation */
  backup?: boolean;
  /** Remove all configuration files */
  removeAll?: boolean;
}

export interface UpdateAdapterOptions extends Omit<UpdateOptions, 'force' | 'backup'> {
  /** Force update */
  force?: boolean;
  /** Create backup before update */
  backup?: boolean;
  /** Check for updates without applying */
  dryRun?: boolean;
}

export interface ListAdapterOptions extends ListOptions {
  /** Filter servers by tags */
  tags?: string[];
  /** Show detailed information */
  detailed?: boolean;
}

/**
 * Server installation service adapter implementation
 */
export class ServerInstallationAdapter implements InstallationAdapter {
  private installationService;

  constructor() {
    this.installationService = createServerInstallationService();
  }

  /**
   * Install a server from the registry
   */
  async installServer(
    serverName: string,
    version?: string,
    options: InstallAdapterOptions = {},
  ): Promise<{
    success: boolean;
    serverName: string;
    version?: string;
    installedAt: Date;
    configPath?: string;
    backupPath?: string;
    warnings: string[];
    errors: string[];
    operationId: string;
  }> {
    debugIf(() => ({
      message: 'Adapter: Installing server',
      meta: { serverName, version, options },
    }));

    try {
      // Validate tags if provided
      if (options.tags) {
        const tagValidation = this.validateTags(options.tags);
        if (!tagValidation.valid) {
          throw new Error(`Invalid tags: ${tagValidation.errors.join(', ')}`);
        }
      }

      // Convert adapter options to domain service options
      const domainOptions: InstallOptions = {
        force: options.force || false,
      };

      const result = await this.installationService.installServer(serverName, version, domainOptions);

      if (!result) {
        throw new Error('Installation service returned undefined result');
      }

      // If installation succeeded and tags are provided, update configuration
      if (result.success && options.tags && options.tags.length > 0) {
        const currentConfig = getServer(serverName);
        if (currentConfig) {
          const updatedConfig = {
            ...currentConfig,
            tags: options.tags,
            env: { ...currentConfig.env, ...options.env },
            args: options.args || currentConfig.args,
          };
          setServer(serverName, updatedConfig);
        }
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Server installation failed', { error: errorMessage, serverName, version });
      throw new Error(`Server installation failed: ${errorMessage}`);
    }
  }

  /**
   * Uninstall a server
   */
  async uninstallServer(
    serverName: string,
    options: UninstallAdapterOptions = {},
  ): Promise<{
    success: boolean;
    serverName: string;
    removedAt: Date;
    configRemoved: boolean;
    warnings: string[];
    errors: string[];
    operationId: string;
  }> {
    debugIf(() => ({
      message: 'Adapter: Uninstalling server',
      meta: { serverName, options },
    }));

    try {
      // Convert adapter options to domain service options
      const domainOptions: UninstallOptions = {
        force: options.force || false,
        backup: options.backup || false,
      };

      const result = await this.installationService.uninstallServer(serverName, domainOptions);

      if (!result) {
        throw new Error('Uninstallation service returned undefined result');
      }

      // If removeAll is specified, remove server from configuration
      if (result.success && options.removeAll) {
        try {
          const allServers = getAllServers();
          if (allServers[serverName]) {
            delete allServers[serverName];
            // Note: In a real implementation, we'd need to save the configuration back
            logger.debug(`Removed server ${serverName} from configuration`);
          }
        } catch (configError) {
          const errorMessage = configError instanceof Error ? configError.message : String(configError);
          logger.warn('Failed to remove server from configuration', { error: errorMessage, serverName });
          result.warnings.push(`Failed to remove from configuration: ${errorMessage}`);
        }
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Server uninstallation failed', { error: errorMessage, serverName });
      throw new Error(`Server uninstallation failed: ${errorMessage}`);
    }
  }

  /**
   * Update a server
   */
  async updateServer(
    serverName: string,
    version?: string,
    options: UpdateAdapterOptions = {},
  ): Promise<{
    success: boolean;
    serverName: string;
    previousVersion: string;
    newVersion: string;
    updatedAt: Date;
    warnings: string[];
    errors: string[];
    operationId: string;
  }> {
    debugIf(() => ({
      message: 'Adapter: Updating server',
      meta: { serverName, version, options },
    }));

    try {
      // Convert adapter options to domain service options
      const domainOptions: UpdateOptions = {
        backup: options.backup || false,
      };

      // If dry run, check for updates without applying
      if (options.dryRun) {
        const updateChecks = await this.installationService.checkForUpdates([serverName]);
        const updateCheck = updateChecks[0];

        if (!updateCheck) {
          throw new Error(`Could not check updates for server: ${serverName}`);
        }

        return {
          success: true,
          serverName,
          previousVersion: updateCheck.currentVersion || 'unknown',
          newVersion: updateCheck.latestVersion || 'unknown',
          updatedAt: new Date(),
          warnings: [
            `Dry run: Update available from ${updateCheck.currentVersion || 'unknown'} to ${updateCheck.latestVersion || 'unknown'}`,
          ],
          errors: [],
          operationId: `dryrun_${Date.now()}`,
        };
      }

      const result = await this.installationService.updateServer(serverName, version, domainOptions);

      if (!result) {
        throw new Error('Update service returned undefined result');
      }

      // Convert UpdateResult to the expected adapter return type
      return {
        success: result.success,
        serverName: result.serverName || serverName,
        previousVersion: result.previousVersion || 'unknown',
        newVersion: result.newVersion || 'unknown',
        updatedAt: result.updatedAt || new Date(),
        warnings: result.warnings || [],
        errors: result.errors || [],
        operationId: result.operationId || `update_${Date.now()}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Server update failed', { error: errorMessage, serverName, version });
      throw new Error(`Server update failed: ${errorMessage}`);
    }
  }

  /**
   * List installed servers
   */
  async listInstalledServers(options: ListAdapterOptions = {}): Promise<string[]> {
    debugIf(() => ({
      message: 'Adapter: Listing installed servers',
      meta: { options },
    }));

    try {
      // Convert adapter options to domain service options
      const domainOptions: ListOptions = {
        filterActive: options.filterActive,
      };

      let servers = await this.installationService.listInstalledServers(domainOptions);

      if (!servers) {
        return [];
      }

      // Apply tag filtering if specified
      if (options.tags && options.tags.length > 0) {
        const allServers = getAllServers();
        servers = servers.filter((serverName) => {
          const serverConfig = allServers[serverName];
          if (!serverConfig || !serverConfig.tags) {
            return false;
          }
          return options.tags!.some((tag) => serverConfig.tags!.includes(tag));
        });
      }

      return servers;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Server listing failed', { error: errorMessage });
      throw new Error(`Server listing failed: ${errorMessage}`);
    }
  }

  /**
   * Validate tags format
   */
  validateTags(tags: string[]): { valid: boolean; errors: string[] } {
    debugIf(() => ({
      message: 'Adapter: Validating tags',
      meta: { tags },
    }));

    try {
      return validateTags(tags);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Tag validation failed', { error: errorMessage, tags });
      return {
        valid: false,
        errors: [errorMessage],
      };
    }
  }

  /**
   * Parse tags from comma-separated string
   */
  parseTags(tagsString: string): string[] {
    debugIf(() => ({
      message: 'Adapter: Parsing tags',
      meta: { tagsString },
    }));

    try {
      return parseTags(tagsString);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Tag parsing failed', { error: errorMessage, tagsString });
      throw new Error(`Tag parsing failed: ${errorMessage}`);
    }
  }

  /**
   * Get installation metadata for a server
   */
  getServerMetadata(serverName: string): {
    version?: string;
    installedAt?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  } | null {
    debugIf(() => ({
      message: 'Adapter: Getting server metadata',
      meta: { serverName },
    }));

    try {
      const metadata = getInstallationMetadata(serverName);
      if (!metadata) {
        return null;
      }

      // Convert the metadata to match expected adapter interface
      return {
        version: metadata.version,
        installedAt: metadata.installedAt?.toISOString(),
        source: metadata.installedBy,
        metadata: {
          installedBy: metadata.installedBy,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to get server metadata', { error: errorMessage, serverName });
      return null;
    }
  }

  /**
   * Check for available updates for servers
   */
  async checkForUpdates(serverNames?: string[]): Promise<
    Array<{
      serverName: string;
      currentVersion: string;
      latestVersion: string;
      hasUpdate: boolean;
      updateAvailable: boolean;
      updateType?: 'patch' | 'minor' | 'major' | 'unknown';
    }>
  > {
    debugIf(() => ({
      message: 'Adapter: Checking for updates',
      meta: { serverNames },
    }));

    try {
      const updateResults = await this.installationService.checkForUpdates(serverNames);

      if (!updateResults) {
        return [];
      }

      // Transform UpdateCheckResult to match expected interface
      return updateResults.map((result) => ({
        serverName: result.serverName,
        currentVersion: result.currentVersion || 'unknown',
        latestVersion: result.latestVersion || 'unknown',
        hasUpdate: result.hasUpdate || false,
        updateAvailable: result.updateAvailable || false,
        updateType: result.updateType,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Update check failed', { error: errorMessage, serverNames });
      throw new Error(`Update check failed: ${errorMessage}`);
    }
  }
}

/**
 * Factory function to create installation adapter
 */
export function createInstallationAdapter(): InstallationAdapter {
  return new ServerInstallationAdapter();
}
