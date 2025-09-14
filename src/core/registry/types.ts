/**
 * Type definitions for MCP Registry data structures
 */

export interface RegistryServer {
  $schema: string;
  name: string;
  description: string;
  status: 'active' | 'archived' | 'deprecated';
  repository: {
    url: string;
    source: 'github' | 'gitlab';
    subfolder?: string;
  };
  version: string;
  packages?: ServerPackage[]; // Optional packages array
  remotes?: ServerRemote[]; // Optional remotes array
  website_url?: string; // Optional website URL
  _meta: ServerMeta;
}

export interface ServerPackage {
  registry_type: 'npm' | 'pypi' | 'docker';
  identifier: string;
  version?: string; // Optional version
  transport?: 'stdio' | 'sse' | 'webhook'; // Optional transport
  arguments?: string[]; // Optional arguments array
  environment_variables?: Record<string, string>;
}

export interface ServerRemote {
  type: 'streamable-http' | 'sse' | 'webhook';
  url: string;
}

export interface ServerMeta {
  'io.modelcontextprotocol.registry/official': {
    id: string;
    published_at: string;
    updated_at: string;
    is_latest: boolean;
  };
}

export interface ServerListOptions {
  limit?: number; // Max results (default: 30, max: 100)
  cursor?: string; // Pagination cursor (UUID)
  updated_since?: string; // RFC3339 datetime - filter servers updated since timestamp
  search?: string; // Search servers by name (substring match)
  version?: string; // Filter by version ('latest' or exact version)
}

export interface SearchOptions extends ServerListOptions {
  query?: string; // Search in name, description (legacy, maps to search)
  status?: 'active' | 'archived' | 'deprecated' | 'all'; // Client-side filtering
  registry_type?: 'npm' | 'pypi' | 'docker'; // Client-side filtering
  transport?: 'stdio' | 'sse' | 'webhook'; // Client-side filtering
}

export interface MCPServerSearchResult {
  name: string;
  description: string;
  status: string;
  version: string;
  repository: {
    url: string;
    source: string;
    subfolder?: string;
  };
  packages: Array<{
    registry_type: string;
    identifier: string;
    version: string;
    transport: string;
  }>;
  lastUpdated: string;
  registryId: string;
}

export interface ServersListResponse {
  servers: RegistryServer[];
  metadata: {
    next_cursor?: string;
    count: number;
  };
}

export interface RegistryStatusResult {
  available: boolean;
  url: string;
  response_time_ms: number;
  last_updated: string;
  github_client_id?: string;
  stats?: {
    total_servers: number;
    active_servers: number;
    deprecated_servers: number;
    by_registry_type: Record<string, number>;
    by_transport: Record<string, number>;
  };
}

export interface CacheOptions {
  defaultTtl: number; // Default 5 minutes
  maxSize: number; // Max cache entries
  cleanupInterval: number; // Cleanup interval in ms
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

export interface RegistryClientOptions {
  baseUrl: string;
  timeout: number;
  cache?: CacheOptions;
  proxy?: {
    url: string;
    auth?: {
      username: string;
      password: string;
    };
  };
}

/**
 * CLI registry options interface - maps to command line options
 */
export interface RegistryOptions {
  url?: string;
  timeout?: number;
  cacheTtl?: number;
  cacheMaxSize?: number;
  cacheCleanupInterval?: number;
  proxy?: string;
  proxyAuth?: string;
}
