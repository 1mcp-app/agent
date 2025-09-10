import logger from '../../logger/logger.js';
import { withErrorHandling } from '../../utils/errorHandling.js';
import { CacheManager } from './cacheManager.js';
import {
  RegistryServer,
  ServerListOptions,
  SearchOptions,
  RegistryClientOptions,
  RegistryStatusResult,
} from './types.js';

/**
 * HTTP client for the MCP Registry API
 */
export class MCPRegistryClient {
  private baseUrl: string;
  private timeout: number;
  private cache: CacheManager;

  constructor(options: RegistryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = options.timeout;
    this.cache = new CacheManager(options.cache);
  }

  /**
   * Get servers from the registry with optional filtering
   */
  async getServers(options: ServerListOptions = {}): Promise<RegistryServer[]> {
    const handler = withErrorHandling(async () => {
      const params = this.buildParams(options);
      const cacheKey = this.cache.generateKey('/servers', params);

      // Try cache first
      const cached = await this.cache.get<RegistryServer[]>(cacheKey);
      if (cached) {
        logger.debug(`Cache hit for servers list: ${cacheKey}`);
        return cached;
      }

      // Make API request
      const url = `${this.baseUrl}/servers${this.buildQueryString(params)}`;
      const response = await this.makeRequest<RegistryServer[]>(url);

      // Cache the response
      await this.cache.set(cacheKey, response, 300); // 5 minutes TTL

      return response;
    }, 'Failed to fetch servers from registry');

    return await handler();
  }

  /**
   * Get a specific server by ID
   */
  async getServerById(id: string): Promise<RegistryServer> {
    const handler = withErrorHandling(async () => {
      const cacheKey = this.cache.generateKey(`/servers/${id}`);

      // Try cache first
      const cached = await this.cache.get<RegistryServer>(cacheKey);
      if (cached) {
        logger.debug(`Cache hit for server: ${id}`);
        return cached;
      }

      // Make API request
      const url = `${this.baseUrl}/servers/${encodeURIComponent(id)}`;
      const response = await this.makeRequest<RegistryServer>(url);

      // Cache the response
      await this.cache.set(cacheKey, response, 600); // 10 minutes TTL for individual servers

      return response;
    }, `Failed to fetch server with ID: ${id}`);

    return await handler();
  }

  /**
   * Search servers with advanced filtering
   */
  async searchServers(searchOptions: SearchOptions): Promise<RegistryServer[]> {
    const handler = withErrorHandling(async () => {
      const params = this.buildParams(searchOptions);
      const cacheKey = this.cache.generateKey('/search', params);

      // Try cache first
      const cached = await this.cache.get<RegistryServer[]>(cacheKey);
      if (cached) {
        logger.debug(`Cache hit for search: ${cacheKey}`);
        return cached;
      }

      // For search, we'll use the main servers endpoint with filters
      // This assumes the registry API supports these query parameters
      const url = `${this.baseUrl}/servers${this.buildQueryString(params)}`;
      const response = await this.makeRequest<RegistryServer[]>(url);

      // Cache search results for a shorter time
      await this.cache.set(cacheKey, response, 180); // 3 minutes TTL

      return response;
    }, 'Failed to search servers in registry');

    return await handler();
  }

  /**
   * Get registry status and statistics
   */
  async getRegistryStatus(includeStats = false): Promise<RegistryStatusResult> {
    const handler = withErrorHandling(async () => {
      const cacheKey = this.cache.generateKey('/status', { includeStats });

      // Try cache first with short TTL for status
      const cached = await this.cache.get<RegistryStatusResult>(cacheKey);
      if (cached) {
        logger.debug(`Cache hit for registry status`);
        return cached;
      }

      const startTime = Date.now();

      try {
        // Check registry availability
        const url = `${this.baseUrl}/servers?limit=1`;
        await this.makeRequest<RegistryServer[]>(url);
        const responseTime = Date.now() - startTime;

        const status: RegistryStatusResult = {
          available: true,
          url: this.baseUrl,
          response_time_ms: responseTime,
          last_updated: new Date().toISOString(),
        };

        // Calculate statistics if requested
        if (includeStats) {
          const allServers = await this.getServers({ limit: 1000 });
          status.stats = this.calculateStats(allServers);
        }

        // Cache status for 1 minute
        await this.cache.set(cacheKey, status, 60);

        return status;
      } catch (_error) {
        const responseTime = Date.now() - startTime;
        const status: RegistryStatusResult = {
          available: false,
          url: this.baseUrl,
          response_time_ms: responseTime,
          last_updated: new Date().toISOString(),
        };

        // Don't cache failed status checks
        return status;
      }
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
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.cache.destroy();
  }

  /**
   * Make HTTP request with timeout and retry logic
   */
  private async makeRequest<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      logger.debug(`Making request to: ${url}`);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': '1mcp-agent/0.21.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as T;
      logger.debug(`Request successful: ${url}`);

      return data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Build query parameters object
   */
  private buildParams(options: ServerListOptions | SearchOptions): Record<string, string> {
    const params: Record<string, string> = {};

    if (options.limit) params.limit = String(options.limit);
    if (options.offset) params.offset = String(options.offset);

    // Add search-specific parameters
    if ('query' in options) {
      if (options.query) params.q = options.query;
      if (options.status && options.status !== 'all') params.status = options.status;
      if (options.registry_type) params.registry_type = options.registry_type;
      if (options.transport) params.transport = options.transport;
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
  private calculateStats(servers: RegistryServer[]) {
    const byRegistryType: Record<string, number> = {};
    const byTransport: Record<string, number> = {};
    let activeCount = 0;
    let deprecatedCount = 0;

    servers.forEach((server) => {
      if (server.status === 'active') activeCount++;
      if (server.status === 'deprecated') deprecatedCount++;

      // Count by registry type and transport
      server.packages.forEach((pkg) => {
        byRegistryType[pkg.registry_type] = (byRegistryType[pkg.registry_type] || 0) + 1;
        byTransport[pkg.transport] = (byTransport[pkg.transport] || 0) + 1;
      });
    });

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
 * Create a registry client instance with default configuration
 */
export function createRegistryClient(options?: Partial<RegistryClientOptions>): MCPRegistryClient {
  const defaultOptions: RegistryClientOptions = {
    baseUrl: process.env.ONE_MCP_REGISTRY_URL || 'https://registry.modelcontextprotocol.io',
    timeout: parseInt(process.env.ONE_MCP_REGISTRY_TIMEOUT || '10000'),
    cache: {
      defaultTtl: parseInt(process.env.ONE_MCP_REGISTRY_CACHE_TTL || '300'),
      maxSize: 1000,
      cleanupInterval: 60000,
    },
  };

  return new MCPRegistryClient({ ...defaultOptions, ...options });
}
