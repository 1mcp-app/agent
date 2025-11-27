/**
 * Type definitions for MCP Registry data structures
 */

export const OFFICIAL_REGISTRY_KEY = 'io.modelcontextprotocol.registry/official';

export interface Repository {
  id?: string;
  source: string;
  subfolder?: string;
  url: string;
}

/**
 * Server data structure
 */
export interface RegistryServer {
  $schema?: string;
  name: string;
  description: string;
  status: 'active' | 'deprecated' | 'archived';
  version: string;
  repository: Repository;
  packages?: ServerPackage[];
  remotes?: ServerRemote[];
  websiteUrl?: string;
  _meta: ServerMeta;
}

export interface Input {
  choices?: string[];
  default?: string;
  description?: string;
  format?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  name?: string;
  value?: string;
  variables?: Record<string, Input>;
}

export interface Argument {
  choices?: string[];
  default?: string;
  description?: string;
  format?: string;
  isRepeated?: boolean;
  isRequired?: boolean;
  isSecret?: boolean;
  name?: string;
  type?: string;
  value?: string;
  valueHint?: string;
  variables?: Record<string, Input>;
}

export interface ServerPackage {
  environmentVariables?: Input[];
  fileSha256?: string;
  identifier: string;
  packageArguments?: Argument[];
  registryBaseUrl?: string;
  registryType: string;
  runtimeArguments?: Argument[];
  runtimeHint?: string;
  transport?: Transport;
  version?: string;
}

export interface ServerRemote {
  headers?: Input[];
  type: string;
  url: string;
}

export interface ServerMeta {
  'io.modelcontextprotocol.registry/official': RegistryExtensions;
  [key: string]: unknown;
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

export interface Transport {
  headers?: Input[];
  type: string;
  url?: string;
}

export interface ServersListResponse {
  servers: ServerResponse[] | null;
  metadata: {
    nextCursor?: string;
    count: number;
  };
}

export interface ServerListResponse {
  servers: ServerResponse[] | null;
  metadata: {
    nextCursor?: string;
    count: number;
  };
}

export interface ServerResponse {
  server: RegistryServer;
  _meta: ResponseMeta;
}

export interface ResponseMeta {
  'io.modelcontextprotocol.registry/official': RegistryExtensions;
}

export interface RegistryExtensions {
  isLatest: boolean;
  publishedAt: string;
  status: 'active' | 'deprecated' | 'archived';
  updatedAt: string;
}

export interface OfficialMeta extends RegistryExtensions {}

export interface ServerVersion {
  version: string;
  publishedAt: string;
  updatedAt: string;
  isLatest: boolean;
  status: 'active' | 'archived' | 'deprecated';
}

export interface ServerVersionsResponse {
  versions: ServerVersion[];
  serverId: string;
  name: string;
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

/**
 * Output format types for registry commands
 */
export type OutputFormat = 'table' | 'json' | 'detailed';

/**
 * Show command arguments
 */
export interface ShowCommandArgs {
  serverId: string;
  version?: string;
  format?: OutputFormat;
}

/**
 * Versions command arguments
 */
export interface VersionsCommandArgs {
  serverId: string;
  format?: OutputFormat;
}
