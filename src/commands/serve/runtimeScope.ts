import path from 'path';

import ConfigContext from '@src/config/configContext.js';

import type { ServeOptions } from './serve.js';

export interface ServeConfigPaths {
  /** MCP config file path selected by --config, --config-dir, or the global default. */
  configFilePath: string;
  /** Runtime Scope directory that owns PID/state/log defaults for this config. */
  runtimeScope: string;
}

/**
 * Initialize ConfigContext from serve CLI options and return the config paths
 * derived from that single source of truth.
 */
export function resolveServeConfigPaths(parsedArgv: Pick<ServeOptions, 'config' | 'config-dir'>): ServeConfigPaths {
  const configContext = ConfigContext.getInstance();

  if (parsedArgv.config) {
    configContext.setConfigPath(parsedArgv.config);
  } else if (parsedArgv['config-dir']) {
    configContext.setConfigDir(parsedArgv['config-dir']);
  } else {
    configContext.reset();
  }

  const configFilePath = configContext.getResolvedConfigPath();
  return {
    configFilePath,
    runtimeScope: path.dirname(configFilePath),
  };
}
