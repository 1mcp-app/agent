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
  packages: ServerPackage[];
  remotes?: ServerRemote[];
  _meta: ServerMeta;
}

export interface ServerPackage {
  registry_type: 'npm' | 'pypi' | 'docker';
  identifier: string;
  version: string;
  transport: 'stdio' | 'sse' | 'webhook';
  environment_variables?: Record<string, string>;
}

export interface ServerRemote {
  url: string;
  transport: 'sse' | 'webhook';
}

export interface ServerMeta {
  id: string;
  published_at: string;
  updated_at: string;
  is_latest: boolean;
}

export interface ServerListOptions {
  limit?: number; // Max results (default: 20, max: 100)
  offset?: number; // Pagination offset
}

export interface SearchOptions extends ServerListOptions {
  query?: string; // Search in name, description
  status?: 'active' | 'archived' | 'deprecated' | 'all';
  registry_type?: 'npm' | 'pypi' | 'docker';
  transport?: 'stdio' | 'sse' | 'webhook';
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

export interface RegistryStatusResult {
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
}
