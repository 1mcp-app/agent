import path from 'path';

import ConfigContext from '@src/config/configContext.js';
import { getConfigPath } from '@src/constants.js';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveServeConfigPaths } from './runtimeScope.js';

describe('resolveServeConfigPaths', () => {
  afterEach(() => {
    ConfigContext.getInstance().reset();
  });

  it('uses the directory containing --config as the Runtime Scope', () => {
    const configFilePath = path.join(process.cwd(), '.tmp-runtime-scope', 'custom.json');

    expect(resolveServeConfigPaths({ config: configFilePath })).toEqual({
      configFilePath,
      runtimeScope: path.dirname(configFilePath),
    });
  });

  it('uses --config-dir for both mcp.json resolution and Runtime Scope', () => {
    const configDir = path.join(process.cwd(), '.tmp-runtime-scope-dir');

    expect(resolveServeConfigPaths({ 'config-dir': configDir })).toEqual({
      configFilePath: getConfigPath(configDir),
      runtimeScope: configDir,
    });
  });
});
