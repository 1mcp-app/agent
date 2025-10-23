export interface RegistryYargsOptions {
  url?: string;
  timeout?: number;
  'cache-ttl'?: number;
  'cache-max-size'?: number;
  'cache-cleanup-interval'?: number;
  proxy?: string;
  'proxy-auth'?: string;
}

// Registry-specific options
export const registryOptions = {
  url: {
    describe: 'MCP registry base URL (env: ONE_MCP_REGISTRY_URL)',
    type: 'string' as const,
    default: undefined,
  },
  timeout: {
    describe: 'Registry request timeout in milliseconds (env: ONE_MCP_REGISTRY_TIMEOUT)',
    type: 'number' as const,
    default: undefined,
  },
  'cache-ttl': {
    describe: 'Registry cache TTL in seconds (env: ONE_MCP_REGISTRY_CACHE_TTL)',
    type: 'number' as const,
    default: undefined,
  },
  'cache-max-size': {
    describe: 'Registry cache maximum size (env: ONE_MCP_REGISTRY_CACHE_MAX_SIZE)',
    type: 'number' as const,
    default: undefined,
  },
  'cache-cleanup-interval': {
    describe: 'Registry cache cleanup interval in milliseconds (env: ONE_MCP_REGISTRY_CACHE_CLEANUP_INTERVAL)',
    type: 'number' as const,
    default: undefined,
  },
  proxy: {
    describe: 'Registry HTTP proxy URL (env: ONE_MCP_REGISTRY_PROXY)',
    type: 'string' as const,
    default: undefined,
  },
  'proxy-auth': {
    describe: 'Registry proxy authentication (username:password) (env: ONE_MCP_REGISTRY_PROXY_AUTH)',
    type: 'string' as const,
    default: undefined,
  },
} as const;
