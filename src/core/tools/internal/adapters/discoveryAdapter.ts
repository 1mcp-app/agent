/**
 * Discovery domain service adapter
 *
 * Thin adapter that bridges internal tools with discovery domain services.
 * This adapter wraps existing domain service calls and transforms data
 * between internal tool format and domain service format.
 */
import {
  checkConsolidationStatus,
  discoverAppConfigs,
  discoverInstalledApps,
} from '@src/domains/discovery/appDiscovery.js';
import { createRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import type { RegistryServer, SearchOptions } from '@src/domains/registry/types.js';
import logger, { debugIf } from '@src/logger/logger.js';

/**
 * Discovery adapter interface
 */
export interface DiscoveryAdapter {
  searchServers(query: string, options?: SearchOptions): Promise<RegistryServer[]>;
  getServerById(id: string, version?: string): Promise<RegistryServer | null>;
  getRegistryStatus(includeStats?: boolean): Promise<{
    available: boolean;
    url: string;
    response_time_ms: number;
    last_updated: string;
    stats?: {
      total_servers: number;
      active_servers: number;
      deprecated_servers: number;
      by_registry_type: Record<string, number>;
      by_transport: Record<string, number>;
    };
    github_client_id?: string;
  }>;
  discoverInstalledApps(): Promise<{
    configurable: Array<{
      name: string;
      displayName: string;
      hasConfig: boolean;
      configCount: number;
      serverCount: number;
      paths: string[];
    }>;
    manualOnly: string[];
  }>;
  discoverAppConfigs(appName: string): Promise<{
    app: string;
    configs: Array<{
      path: string;
      level: 'project' | 'user' | 'system';
      servers: Array<{
        name: string;
        command?: string;
        url?: string;
        args?: string[];
        env?: Record<string, string>;
      }>;
      priority: number;
      exists: boolean;
      readable: boolean;
      valid: boolean;
      content?: unknown;
      error?: string;
    }>;
  }>;
  checkAppConsolidationStatus(appName: string): Promise<{
    isConsolidated: boolean;
    consolidatedUrl?: string;
    configPath?: string;
    originalServers?: number;
    message?: string;
  }>;
}

/**
 * Registry-based discovery adapter implementation
 */
export class RegistryDiscoveryAdapter implements DiscoveryAdapter {
  private registryClient;

  constructor() {
    this.registryClient = createRegistryClient();
  }

  /**
   * Search for servers in the registry
   */
  async searchServers(query: string, options: SearchOptions = {}): Promise<RegistryServer[]> {
    debugIf(() => ({ message: 'discoveryAdapter.adapter.searching.servers.in.registry.ee1ac44f' }));

    try {
      const result = await this.registryClient.searchServers({
        ...options,
        search: query,
      });

      if (!result) {
        return [];
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('discoveryAdapter.registry.search.failed.1fecc7fb', { error: errorMessage });
      throw new Error(`Registry search failed: ${errorMessage}`);
    }
  }

  /**
   * Get server details by ID
   */
  async getServerById(id: string, version?: string): Promise<RegistryServer | null> {
    debugIf(() => ({ message: 'discoveryAdapter.adapter.getting.server.by.id.from.registry.54161885' }));

    try {
      const result = await this.registryClient.getServerById(id, version);
      return result || null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('discoveryAdapter.registry.get.server.failed.d571a1d0', { error: errorMessage });

      // Return null for not found errors, throw for others
      if (errorMessage.includes('not found') || errorMessage.includes('No versions found')) {
        return null;
      }
      throw new Error(`Registry get server failed: ${errorMessage}`);
    }
  }

  /**
   * Get registry status and health
   */
  async getRegistryStatus(includeStats = false): Promise<{
    available: boolean;
    url: string;
    response_time_ms: number;
    last_updated: string;
    stats?: {
      total_servers: number;
      active_servers: number;
      deprecated_servers: number;
      by_registry_type: Record<string, number>;
      by_transport: Record<string, number>;
    };
    github_client_id?: string;
  }> {
    debugIf(() => ({ message: 'discoveryAdapter.adapter.getting.registry.status.e84bf5f0' }));

    try {
      const result = await this.registryClient.getRegistryStatus(includeStats);
      if (!result) {
        throw new Error('Registry client returned undefined status');
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('discoveryAdapter.registry.status.check.failed.445d98cb', { error: errorMessage });
      throw new Error(`Registry status check failed: ${errorMessage}`);
    }
  }

  /**
   * Discover installed applications with MCP configurations
   */
  async discoverInstalledApps(): Promise<{
    configurable: Array<{
      name: string;
      displayName: string;
      hasConfig: boolean;
      configCount: number;
      serverCount: number;
      paths: string[];
    }>;
    manualOnly: string[];
  }> {
    debugIf(() => ({ message: 'discoveryAdapter.adapter.discovering.installed.apps.d997f6b6' }));

    try {
      const result = await discoverInstalledApps();
      if (!result) {
        throw new Error('App discovery returned undefined result');
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('discoveryAdapter.app.discovery.failed.966f8a82', { error: errorMessage });
      throw new Error(`App discovery failed: ${errorMessage}`);
    }
  }

  /**
   * Discover configuration files for a specific application
   */
  async discoverAppConfigs(appName: string): Promise<{
    app: string;
    configs: Array<{
      path: string;
      level: 'project' | 'user' | 'system';
      servers: Array<{
        name: string;
        command?: string;
        url?: string;
        args?: string[];
        env?: Record<string, string>;
      }>;
      priority: number;
      exists: boolean;
      readable: boolean;
      valid: boolean;
      content?: unknown;
      error?: string;
    }>;
  }> {
    debugIf(() => ({ message: 'discoveryAdapter.adapter.discovering.app.configs.b3ecb728' }));

    try {
      const result = await discoverAppConfigs(appName);
      if (!result) {
        throw new Error('App config discovery returned undefined result');
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('discoveryAdapter.app.config.discovery.failed.87c4904c', { error: errorMessage });
      throw new Error(`App config discovery failed: ${errorMessage}`);
    }
  }

  /**
   * Check if an application has been consolidated to 1mcp
   */
  async checkAppConsolidationStatus(appName: string): Promise<{
    isConsolidated: boolean;
    consolidatedUrl?: string;
    configPath?: string;
    originalServers?: number;
    message?: string;
  }> {
    debugIf(() => ({ message: 'discoveryAdapter.adapter.checking.app.consolidation.status.09a6a361' }));

    try {
      const result = await checkConsolidationStatus(appName);
      if (!result) {
        throw new Error('App consolidation status check returned undefined result');
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('discoveryAdapter.app.consolidation.status.check.failed.6bd497dd', { error: errorMessage });
      throw new Error(`App consolidation status check failed: ${errorMessage}`);
    }
  }

  /**
   * Clean up adapter resources
   */
  destroy(): void {
    if (this.registryClient) {
      this.registryClient.destroy();
    }
  }
}

/**
 * Factory function to create discovery adapter
 */
export function createDiscoveryAdapter(): DiscoveryAdapter {
  return new RegistryDiscoveryAdapter();
}
