import type { RegistryOptions } from '@src/domains/registry/types.js';

import { z } from 'zod';

export interface RegistryYargsOptions {
  url?: string;
  timeout?: number;
  'cache-ttl'?: number;
  'cache-max-size'?: number;
  'cache-cleanup-interval'?: number;
  proxy?: string;
  'proxy-auth'?: string;
}

const positiveInteger = z.number().int().positive();
const registryYargsOptionsSchema = z.object({
  url: z.string().url().optional(),
  timeout: positiveInteger.optional(),
  'cache-ttl': positiveInteger.optional(),
  'cache-max-size': positiveInteger.optional(),
  'cache-cleanup-interval': positiveInteger.optional(),
  proxy: z.string().url().optional(),
  'proxy-auth': z
    .string()
    .regex(/^[^:]+:.+$/, 'Registry proxy authentication must use username:password')
    .optional(),
});

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

/** Validate and map the shared registry CLI surface to the domain contract. */
export function registryOptionsFromArgv(options: RegistryYargsOptions): RegistryOptions {
  const parsed = registryYargsOptionsSchema.parse(options);
  return {
    url: parsed.url,
    timeout: parsed.timeout,
    cacheTtl: parsed['cache-ttl'],
    cacheMaxSize: parsed['cache-max-size'],
    cacheCleanupInterval: parsed['cache-cleanup-interval'],
    proxy: parsed.proxy,
    proxyAuth: parsed['proxy-auth'],
  };
}
