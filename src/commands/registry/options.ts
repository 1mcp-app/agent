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
    describe: 'MCP registry base URL',
    type: 'string' as const,
    env: 'ONE_MCP_REGISTRY_URL',
    default: undefined,
  },
  timeout: {
    describe: 'Registry request timeout in milliseconds',
    type: 'number' as const,
    env: 'ONE_MCP_REGISTRY_TIMEOUT',
    default: undefined,
  },
  'cache-ttl': {
    describe: 'Registry cache TTL in seconds',
    type: 'number' as const,
    env: 'ONE_MCP_REGISTRY_CACHE_TTL',
    default: undefined,
  },
  'cache-max-size': {
    describe: 'Registry cache maximum size',
    type: 'number' as const,
    env: 'ONE_MCP_REGISTRY_CACHE_MAX_SIZE',
    default: undefined,
  },
  'cache-cleanup-interval': {
    describe: 'Registry cache cleanup interval in milliseconds',
    type: 'number' as const,
    env: 'ONE_MCP_REGISTRY_CACHE_CLEANUP_INTERVAL',
    default: undefined,
  },
  proxy: {
    describe: 'Registry HTTP proxy URL',
    type: 'string' as const,
    env: 'ONE_MCP_REGISTRY_PROXY',
    default: undefined,
  },
  'proxy-auth': {
    describe: 'Registry proxy authentication (username:password)',
    type: 'string' as const,
    env: 'ONE_MCP_REGISTRY_PROXY_AUTH',
    default: undefined,
  },
} as const;
