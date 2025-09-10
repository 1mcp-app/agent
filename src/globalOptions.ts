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
} as const;

/**
 * Type definition for global options interface
 */
export interface GlobalOptions {
  config?: string;
  'config-dir'?: string;
  'log-level'?: 'debug' | 'info' | 'warn' | 'error';
  'log-file'?: string;
}
