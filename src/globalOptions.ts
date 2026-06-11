/**
 * Global CLI options that can be used across all command groups
 * These options provide common functionality like configuration, logging, and directory management
 *
 * Environment Variables:
 * All options can be set via environment variables with the 'ONE_MCP_' prefix:
 * - ONE_MCP_CONFIG
 * - ONE_MCP_CONFIG_DIR
 * - ONE_MCP_LOG_LEVEL
 * - ONE_MCP_LOG_FILE
 */
export const globalOptions = {
  config: {
    alias: 'c',
    describe: 'Path to the config file (env: ONE_MCP_CONFIG)',
    type: 'string' as const,
    default: undefined,
  },
  'config-dir': {
    alias: 'd',
    describe: 'Path to the config directory (env: ONE_MCP_CONFIG_DIR)',
    type: 'string' as const,
    default: undefined,
  },
  'cli-session-cache-path': {
    describe:
      'Path template for the run/inspect CLI session cache file, supports {pid} (env: ONE_MCP_CLI_SESSION_CACHE_PATH)',
    type: 'string' as const,
    default: undefined,
  },
  'log-level': {
    describe: 'Set the log level (debug, info, warn, error) (env: ONE_MCP_LOG_LEVEL)',
    type: 'string' as const,
    choices: ['debug', 'info', 'warn', 'error'] as const,
    default: undefined,
  },
  'log-file': {
    describe: 'Write logs to a file in addition to console (env: ONE_MCP_LOG_FILE)',
    type: 'string' as const,
    default: undefined,
  },
  'registry-url': {
    describe: 'MCP registry base URL (env: ONE_MCP_REGISTRY_URL)',
    type: 'string' as const,
    hidden: true,
    default: undefined,
  },
  'registry-timeout': {
    describe: 'Registry request timeout in milliseconds (env: ONE_MCP_REGISTRY_TIMEOUT)',
    type: 'number' as const,
    hidden: true,
    default: undefined,
  },
  'registry-cache-ttl': {
    describe: 'Registry cache TTL in seconds (env: ONE_MCP_REGISTRY_CACHE_TTL)',
    type: 'number' as const,
    hidden: true,
    default: undefined,
  },
  'registry-cache-max-size': {
    describe: 'Registry cache maximum size (env: ONE_MCP_REGISTRY_CACHE_MAX_SIZE)',
    type: 'number' as const,
    hidden: true,
    default: undefined,
  },
  'registry-cache-cleanup-interval': {
    describe: 'Registry cache cleanup interval in milliseconds (env: ONE_MCP_REGISTRY_CACHE_CLEANUP_INTERVAL)',
    type: 'number' as const,
    hidden: true,
    default: undefined,
  },
  'registry-proxy': {
    describe: 'Registry HTTP proxy URL (env: ONE_MCP_REGISTRY_PROXY)',
    type: 'string' as const,
    hidden: true,
    default: undefined,
  },
  'registry-proxy-auth': {
    describe: 'Registry proxy authentication (env: ONE_MCP_REGISTRY_PROXY_AUTH)',
    type: 'string' as const,
    hidden: true,
    default: undefined,
  },
} as const;

/**
 * Type definition for global options interface
 */
export interface GlobalOptions {
  config?: string;
  'config-dir'?: string;
  'cli-session-cache-path'?: string;
  'log-level'?: 'debug' | 'info' | 'warn' | 'error';
  'log-file'?: string;
  'registry-url'?: string;
  'registry-timeout'?: number;
  'registry-cache-ttl'?: number;
  'registry-cache-max-size'?: number;
  'registry-cache-cleanup-interval'?: number;
  'registry-proxy'?: string;
  'registry-proxy-auth'?: string;
}
