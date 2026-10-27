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
import { configureProductTelemetryBootstrap } from '@src/config/productTelemetryBootstrap.js';
import { getRuntimeParentEnvironment } from '@src/config/runtimeBootstrap.js';

import type { Argv } from 'yargs';

export const globalOptions = {
  'product-telemetry-test-suppressed': {
    describe: 'Suppress Product Usage Telemetry in test-owned processes',
    type: 'boolean' as const,
    hidden: true,
    default: undefined,
    // A command-line false must never undo the launcher suppression decision.
    coerce: (value: boolean) =>
      getRuntimeParentEnvironment().ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED === 'true' || value,
  },
  'project-owner': {
    describe:
      'Override automatic session ownership with your own private bootstrap credential (env: ONE_MCP_PROJECT_OWNER)',
    type: 'string' as const,
    default: undefined,
  },
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
      'Path template for the run/inspect CLI session cache file, supports {pid} and {scope} (env: ONE_MCP_CLI_SESSION_CACHE_PATH)',
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

const configuredParsers = new WeakSet<Argv>();

/** Register before command builders run, so nested commands inherit one copy. */
export function withGlobalOptions(yargs: Argv): Argv<GlobalOptions> {
  if (configuredParsers.has(yargs)) return yargs;
  configuredParsers.add(yargs);
  return yargs
    .options(globalOptions)
    .group(Object.keys(globalOptions), 'Global options:')
    .middleware((argv) => configureProductTelemetryBootstrap(argv), true);
}

/**
 * Type definition for global options interface
 */
export interface GlobalOptions {
  'product-telemetry-test-suppressed'?: boolean;
  'project-owner'?: string;
  config?: string;
  'config-dir'?: string;
  'cli-session-cache-path'?: string;
  'log-level'?: 'debug' | 'info' | 'warn' | 'error';
  'log-file'?: string;
}
