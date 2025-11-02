import { MCP_SERVER_VERSION } from '@src/constants.js';
import logger from '@src/logger/logger.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

import { CacheManager } from './cacheManager.js';
import {
  RegistryClientOptions,
  RegistryOptions,
  RegistryServer,
  RegistryStatusResult,
  SearchOptions,
  ServerListOptions,
  ServerMeta,
  ServersListResponse,
  ServerVersionsResponse,
} from './types.js';

/**
 * HTTP client for the MCP Registry API
 * https://registry.modelcontextprotocol.io/docs
 * https://registry.modelcontextprotocol.io/openapi.yaml
 */
export class MCPRegistryClient {
  private baseUrl: string;
  private timeout: number;
  private cache: CacheManager;
  private proxyConfig?: RegistryClientOptions['proxy'];
  private axiosInstance: AxiosInstance;

  constructor(options: RegistryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = options.timeout;
    this.cache = new CacheManager(options.cache);
    this.proxyConfig = options.proxy;
    this.axiosInstance = this.createAxiosInstance();
  }

  /**
   * Get servers from the registry with optional filtering
   */
  async getServers(options: ServerListOptions = {}): Promise<RegistryServer[]> {
    const handler = withErrorHandling(async () => {
      const params = this.buildParams(options);

      return await this.withCache(
        '/servers',
        params,
        async () => {
          const url = `${this.baseUrl}/v0.1/servers${this.buildQueryString(params)}`;
          const response = await this.makeRequest<ServersListResponse>(url);
          // Extract RegistryServer objects from ServerResponse objects and merge metadata
          return (response.servers || []).map((sr) => ({
            ...sr.server,
            _meta: sr._meta as unknown as ServerMeta, // Cast to unknown then ServerMeta since ResponseMeta is compatible
          }));
        },
        300, // 5 minutes TTL
        'servers list',
      );
    }, 'Failed to fetch servers from registry');

    return await handler();
  }

  /**
   * Get servers from the registry with full response metadata (including pagination)
   */
  async getServersWithMetadata(options: ServerListOptions = {}): Promise<ServersListResponse> {
    const handler = withErrorHandling(async () => {
      const params = this.buildParams(options);

      return await this.withCache(
        '/servers-metadata',
        params,
        async () => {
          const url = `${this.baseUrl}/v0.1/servers${this.buildQueryString(params)}`;
          const response = await this.makeRequest<ServersListResponse>(url);
          return response;
        },
        300, // 5 minutes TTL
        'servers list with metadata',
      );
    }, 'Failed to fetch servers from registry with metadata');

    return await handler();
  }

  /**
   * Get a specific server by ID
   */
  async getServerById(id: string, version?: string): Promise<RegistryServer> {
    const handler = withErrorHandling(
      async () => {
        const cacheKey = version ? `/servers/${id}/versions/${version}` : `/servers/${id}/versions`;
        return await this.withCache(
          cacheKey,
          undefined,
          async () => {
            // The v0.1 API doesn't have direct server lookup, only versions endpoint
            // GET /v0.1/servers/{serverName}/versions - get all versions or specific version
            const url = `${this.baseUrl}/v0.1/servers/${encodeURIComponent(id)}/versions`;
            const response = await this.makeRequest<ServersListResponse>(url);
            if (!response.servers || response.servers.length === 0) {
              throw new Error(`No versions found for server: ${id}`);
            }

            // Find the specific version if requested, otherwise return the first (latest)
            let serverResponse;
            if (version) {
              serverResponse = response.servers.find((sr) => sr.server.version === version);
              if (!serverResponse) {
                throw new Error(`Version ${version} not found for server: ${id}`);
              }
            } else {
              serverResponse = response.servers[0]; // First one is typically the latest
            }

            // Return the server with metadata merged from the response wrapper
            return {
              ...serverResponse.server,
              _meta: serverResponse._meta as unknown as ServerMeta,
            };
          },
          600, // 10 minutes TTL for individual servers
          `server: ${id}${version ? ` (v${version})` : ''}`,
        );
      },
      `Failed to fetch server with ID: ${id}${version ? ` (version: ${version})` : ''}`,
    );

    return await handler();
  }

  /**
   * Get all versions for a specific server
   */
  async getServerVersions(id: string): Promise<ServerVersionsResponse> {
    const handler = withErrorHandling(async () => {
      return await this.withCache(
        `/servers/${id}/versions`,
        undefined,
        async () => {
          const url = `${this.baseUrl}/v0.1/servers/${encodeURIComponent(id)}/versions`;
          // The API returns servers in the same format as the main endpoint
          const response = await this.makeRequest<ServersListResponse>(url);

          // Transform to the expected ServerVersionsResponse format
          const versions = (response.servers || []).map((serverResponse) => {
            const server = serverResponse.server;
            const registryMeta = serverResponse._meta['io.modelcontextprotocol.registry/official'];
            return {
              version: server.version,
              publishedAt: registryMeta.publishedAt,
              updatedAt: registryMeta.updatedAt,
              isLatest: registryMeta.isLatest,
              status: registryMeta.status,
            };
          });

          // Get server name from the first server (they should all have the same name)
          const serverName = response.servers && response.servers.length > 0 ? response.servers[0].server.name : '';

          return {
            versions,
            serverId: id,
            name: serverName,
          };
        },
        300, // 5 minutes TTL for versions list
        `server versions: ${id}`,
      );
    }, `Failed to fetch versions for server with ID: ${id}`);

    return await handler();
  }

  /**
   * Search servers with advanced filtering
   */
  async searchServers(searchOptions: SearchOptions): Promise<RegistryServer[]> {
    const handler = withErrorHandling(async () => {
      const params = this.buildParams(searchOptions);

      return await this.withCache(
        '/search',
        params,
        async () => {
          // For search, we'll use the main servers endpoint with filters
          // This assumes the registry API supports these query parameters
          const url = `${this.baseUrl}/v0.1/servers${this.buildQueryString(params)}`;
          const response = await this.makeRequest<ServersListResponse>(url);
          // Extract RegistryServer objects from ServerResponse objects
          return (response.servers || []).map((sr) => sr.server);
        },
        180, // 3 minutes TTL
        'search',
      );
    }, 'Failed to search servers in registry');

    return await handler();
  }

  /**
   * Get registry status and statistics
   */
  async getRegistryStatus(includeStats = false): Promise<RegistryStatusResult> {
    const handler = withErrorHandling(async () => {
      return await this.withCache(
        '/status',
        { includeStats },
        async () => {
          const startTime = Date.now();

          try {
            // Check registry availability using health endpoint
            const url = `${this.baseUrl}/v0.1/health`;
            const healthResponse = await this.makeRequest<{ status: string; github_client_id?: string }>(url);
            const responseTime = Date.now() - startTime;

            const registryStatus: RegistryStatusResult = {
              available: true,
              url: this.baseUrl,
              response_time_ms: responseTime,
              last_updated: new Date().toISOString(),
              github_client_id: healthResponse.github_client_id,
            };

            // Calculate statistics if requested
            if (includeStats) {
              const allServers = await this.getAllServersWithPagination();
              registryStatus.stats = this.calculateStats(allServers);
            }

            return registryStatus;
          } catch (_error) {
            const responseTime = Date.now() - startTime;
            return {
              available: false,
              url: this.baseUrl,
              response_time_ms: responseTime,
              last_updated: new Date().toISOString(),
            };
          }
        },
        60, // 1 minute TTL
        'registry status',
      );
    }, 'Failed to get registry status');

    return await handler();
  }

  /**
   * Invalidate cache for specific patterns
   */
  async invalidateCache(pattern?: string): Promise<void> {
    if (pattern) {
      await this.cache.invalidate(pattern);
    } else {
      await this.cache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalEntries: number;
    validEntries: number;
    expiredEntries: number;
    maxSize: number;
    hitRatio: number;
  } {
    return this.cache.getStats();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.cache.destroy();
    // Force close any remaining connections
    if (this.axiosInstance && 'defaults' in this.axiosInstance) {
      // Clear any timeout references
      if (this.axiosInstance.defaults?.timeout) {
        delete this.axiosInstance.defaults.timeout;
      }
    }
  }

  /**
   * Generic cache wrapper that handles the cache-check-call-store pattern
   */
  private async withCache<T>(
    cacheKeyPath: string,
    cacheKeyParams: Record<string, unknown> | undefined,
    apiCall: () => Promise<T>,
    ttl: number,
    debugDescription: string,
  ): Promise<T> {
    const cacheKey = cacheKeyParams
      ? this.cache.generateKey(cacheKeyPath, cacheKeyParams)
      : this.cache.generateKey(cacheKeyPath);

    // Try cache first
    const cached = await this.cache.get<T>(cacheKey);
    if (cached) {
      logger.debug(`Cache hit for ${debugDescription}: ${cacheKey}`);
      return cached;
    }

    // Cache miss - make API call
    const result = await apiCall();

    // Cache the response
    await this.cache.set(cacheKey, result, ttl);

    return result;
  }

  /**
   * Get all servers using pagination to handle large result sets
   */
  private async getAllServersWithPagination(
    baseOptions: ServerListOptions = {},
    maxPages = 10,
  ): Promise<RegistryServer[]> {
    const allServers: RegistryServer[] = [];
    let cursor: string | undefined;
    let pageCount = 0;

    do {
      const params: ServerListOptions = {
        ...baseOptions,
        limit: baseOptions.limit || 100,
      };

      if (cursor) {
        params.cursor = cursor;
      }

      const response = await this.makeRequest<ServersListResponse>(
        `${this.baseUrl}/v0.1/servers${this.buildQueryString(this.buildParams(params))}`,
      );

      allServers.push(...(response.servers || []).map((sr) => sr.server));
      cursor = response.metadata.nextCursor;
      pageCount++;
    } while (cursor && pageCount < maxPages);

    return allServers;
  }

  /**
   * Create axios instance with timeout and proxy support
   */
  private createAxiosInstance(): AxiosInstance {
    const config: AxiosRequestConfig = {
      timeout: this.timeout,
      headers: {
        Accept: 'application/json',
        'User-Agent': `1mcp-agent/${MCP_SERVER_VERSION}`,
        // Ensure connection is closed after request to prevent hanging
        Connection: 'close',
      },
    };

    // Add proxy support if configured
    const proxyConfig = this.getProxyConfig();
    if (proxyConfig) {
      try {
        // For axios, we can use the proxy configuration directly
        const proxyUrl = new URL(proxyConfig.url);

        config.proxy = {
          protocol: proxyUrl.protocol.replace(':', ''),
          host: proxyUrl.hostname,
          port: parseInt(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80),
        };

        // Add auth if provided
        if (proxyConfig.auth) {
          config.proxy.auth = {
            username: proxyConfig.auth.username,
            password: proxyConfig.auth.password,
          };
        } else if (proxyUrl.username && proxyUrl.password) {
          config.proxy.auth = {
            username: decodeURIComponent(proxyUrl.username),
            password: decodeURIComponent(proxyUrl.password),
          };
        }

        logger.debug(`Using proxy: ${proxyConfig.url}`);
      } catch (proxyError) {
        logger.warn(`Failed to configure proxy, proceeding without: ${proxyError}`);
      }
    }

    return axios.create(config);
  }

  /**
   * Make HTTP request with timeout and proxy support
   */
  private async makeRequest<T>(url: string): Promise<T> {
    try {
      logger.debug(`Making request to: ${url}`);
      const response = await this.axiosInstance.get<T>(url);
      logger.debug(`Request successful: ${url}`);
      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const errorMessages = {
          ECONNABORTED: `Request timeout after ${this.timeout}ms`,
          response: `HTTP ${error.response?.status}: ${error.response?.statusText}`,
          request: `Network error: ${error instanceof Error ? error.message : String(error)}`,
        };

        if (error.code === 'ECONNABORTED') throw new Error(errorMessages.ECONNABORTED);
        if (error.response) throw new Error(errorMessages.response);
        if (error.request) throw new Error(errorMessages.request);
      }
      throw error;
    }
  }

  /**
   * Get proxy configuration from options or environment
   */
  private getProxyConfig(): RegistryClientOptions['proxy'] | undefined {
    if (this.proxyConfig) {
      return this.proxyConfig;
    }

    const proxyUrl = this.findProxyUrlFromEnv();
    if (!proxyUrl) {
      return undefined;
    }

    return this.parseProxyUrl(proxyUrl);
  }

  /**
   * Find proxy URL from environment variables
   */
  private findProxyUrlFromEnv(): string | undefined {
    const proxyEnvVars = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

    return proxyEnvVars
      .map((envVar) => process.env[envVar])
      .find((value): value is string => typeof value === 'string' && value.length > 0);
  }

  /**
   * Parse proxy URL and extract configuration
   */
  private parseProxyUrl(proxyUrl: string): RegistryClientOptions['proxy'] | undefined {
    try {
      const proxyUrlObj = new URL(proxyUrl);
      const config: RegistryClientOptions['proxy'] = { url: proxyUrl };

      // Extract auth from URL if present
      if (proxyUrlObj.username && proxyUrlObj.password) {
        config.auth = {
          username: decodeURIComponent(proxyUrlObj.username),
          password: decodeURIComponent(proxyUrlObj.password),
        };
      }

      return config;
    } catch (_error) {
      logger.warn(`Invalid proxy URL: ${proxyUrl}`);
      return undefined;
    }
  }

  /**
   * Build query parameters object from options
   */
  private buildParams(options: ServerListOptions | SearchOptions): Record<string, string> {
    const params: Record<string, string> = {};

    // API-supported parameters
    if (options.limit) params.limit = String(options.limit);
    if (options.cursor) params.cursor = options.cursor;
    if (options.updated_since) params.updated_since = options.updated_since;
    if (options.search) params.search = options.search;
    if (options.version) params.version = options.version;

    // Legacy support - map query to search parameter
    if ('query' in options && options.query && !params.search) {
      params.search = options.query;
    }

    return params;
  }

  /**
   * Build query string from parameters
   */
  private buildQueryString(params: Record<string, string>): string {
    const entries = Object.entries(params);
    if (entries.length === 0) return '';

    const searchParams = new URLSearchParams(entries);
    return `?${searchParams.toString()}`;
  }

  /**
   * Calculate statistics from server list
   */
  private calculateStats(servers: RegistryServer[]): {
    total_servers: number;
    active_servers: number;
    deprecated_servers: number;
    by_registry_type: Record<string, number>;
    by_transport: Record<string, number>;
  } {
    const byRegistryType: Record<string, number> = {};
    const byTransport: Record<string, number> = {};
    let activeCount = 0;
    let deprecatedCount = 0;

    servers.forEach((server) => {
      if (server.status === 'active') activeCount++;
      if (server.status === 'deprecated') deprecatedCount++;

      // Count by transport type (remotes contain transport info)
      if (server.remotes) {
        server.remotes.forEach((remote) => {
          byTransport[remote.type] = (byTransport[remote.type] || 0) + 1;
        });
      }

      // Also count by package transport types
      if (server.packages) {
        server.packages.forEach((pkg) => {
          if (pkg.transport) {
            byTransport[pkg.transport.type] = (byTransport[pkg.transport.type] || 0) + 1;
          }
        });
      }
    });

    // For now, set registry type count to unknown since the new schema doesn't provide this info
    byRegistryType['unknown'] = servers.length;

    return {
      total_servers: servers.length,
      active_servers: activeCount,
      deprecated_servers: deprecatedCount,
      by_registry_type: byRegistryType,
      by_transport: byTransport,
    };
  }
}

/**
 * Convert CLI options to registry client options with defaults
 */
function convertCliOptionsToClientOptions(cliOptions: RegistryOptions = {}): RegistryClientOptions {
  // Parse proxy from CLI options only
  let proxy: RegistryClientOptions['proxy'] | undefined;

  const proxyUrl = cliOptions.proxy;
  if (proxyUrl) {
    proxy = { url: proxyUrl };

    const proxyAuth = cliOptions.proxyAuth;
    if (proxyAuth && proxyAuth.includes(':')) {
      const [username, password] = proxyAuth.split(':', 2);
      proxy.auth = { username, password };
    }
  }

  // Fallback to standard proxy environment variables if no CLI proxy is set
  if (!proxy) {
    proxy = parseProxyFromStandardEnv();
  }

  return {
    baseUrl: cliOptions.url || 'https://registry.modelcontextprotocol.io',
    timeout: cliOptions.timeout || 10000,
    cache: {
      defaultTtl: cliOptions.cacheTtl || 300,
      maxSize: cliOptions.cacheMaxSize || 1000,
      cleanupInterval: cliOptions.cacheCleanupInterval || 60000,
    },
    proxy,
  };
}

/**
 * Parse proxy configuration from standard environment variables (fallback)
 */
function parseProxyFromStandardEnv(): RegistryClientOptions['proxy'] | undefined {
  const proxyEnvVars = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

  const proxyUrl = proxyEnvVars
    .map((envVar) => process.env[envVar])
    .find((value): value is string => typeof value === 'string' && value.length > 0);

  return proxyUrl ? { url: proxyUrl } : undefined;
}

/**
 * Create a registry client instance with CLI options or defaults
 */
export function createRegistryClient(cliOptions?: RegistryOptions): MCPRegistryClient {
  const clientOptions = convertCliOptionsToClientOptions(cliOptions);
  return new MCPRegistryClient(clientOptions);
}
