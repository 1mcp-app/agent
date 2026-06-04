import fs from 'fs';

import ConfigContext from '@src/config/configContext.js';
import { GlobalTransportConfig, MCPServerParams } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

export function parseEnvVars(envArray?: string[]): Record<string, string> {
  if (!envArray || envArray.length === 0) {
    return {};
  }

  const env: Record<string, string> = {};

  for (const envVar of envArray) {
    const equalIndex = envVar.indexOf('=');
    if (equalIndex === -1) {
      throw new Error(`Invalid environment variable format: ${envVar}. Expected key=value`);
    }

    const key = envVar.substring(0, equalIndex).trim();
    const value = envVar.substring(equalIndex + 1);

    if (!key) {
      throw new Error(`Invalid environment variable format: ${envVar}. Key cannot be empty`);
    }

    env[key] = value;
  }

  return env;
}

export function parseHeaders(headersArray?: string[]): Record<string, string> {
  if (!headersArray || headersArray.length === 0) {
    return {};
  }

  const headers: Record<string, string> = {};

  for (const header of headersArray) {
    const colonIndex = header.indexOf('=');
    if (colonIndex === -1) {
      throw new Error(`Invalid header format: ${header}. Expected key=value`);
    }

    const key = header.substring(0, colonIndex).trim();
    const value = header.substring(colonIndex + 1);

    if (!key) {
      throw new Error(`Invalid header format: ${header}. Key cannot be empty`);
    }

    headers[key] = value;
  }

  return headers;
}

export function parseTags(tagsString?: string): string[] {
  if (!tagsString) {
    return [];
  }

  return tagsString
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function validateConfigPath(configPath?: string): string {
  const configContext = ConfigContext.getInstance();
  const filePath = configPath || configContext.getResolvedConfigPath();

  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Configuration file not found: ${filePath}`);
    }

    fs.accessSync(filePath, fs.constants.R_OK);
    fs.accessSync(filePath, fs.constants.W_OK);

    return filePath;
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      throw error;
    }
    throw new Error(`Cannot access configuration file: ${filePath}. ${error}`);
  }
}

export function backupConfig(): string {
  const configContext = ConfigContext.getInstance();
  const filePath = configContext.getResolvedConfigPath();
  const timestamp = Date.now();
  const backupPath = `${filePath}.backup.${timestamp}`;

  try {
    fs.copyFileSync(filePath, backupPath);
    logger.info(`Configuration backed up to: ${backupPath}`);
    return backupPath;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create backup: ${errorMessage}`);
  }
}

export function validateServerConfig(serverConfig: MCPServerParams): void {
  if (!serverConfig.type) {
    throw new Error('Server type is required');
  }

  switch (serverConfig.type) {
    case 'stdio':
      if (!serverConfig.command) {
        throw new Error('Command is required for stdio servers');
      }
      break;

    case 'http':
    case 'sse':
    case 'streamableHttp':
      if (!serverConfig.url) {
        throw new Error(`URL is required for ${serverConfig.type} servers`);
      }

      try {
        new URL(serverConfig.url);
      } catch (_error) {
        throw new Error(`Invalid URL format: ${serverConfig.url}`);
      }
      break;

    default:
      throw new Error(`Unsupported server type: ${serverConfig.type}`);
  }

  if (serverConfig.timeout !== undefined) {
    if (typeof serverConfig.timeout !== 'number' || serverConfig.timeout < 0) {
      throw new Error('Timeout must be a positive number');
    }
  }

  if (serverConfig.tags !== undefined) {
    if (!Array.isArray(serverConfig.tags)) {
      throw new Error('Tags must be an array');
    }

    for (const tag of serverConfig.tags) {
      if (typeof tag !== 'string' || tag.trim().length === 0) {
        throw new Error('All tags must be non-empty strings');
      }
    }
  }
}

export function getInheritedKeys(
  rawConfig: MCPServerParams,
  effectiveConfig: MCPServerParams,
  globalConfig: GlobalTransportConfig,
): string[] {
  const inherited: string[] = [];
  const fallbackKeys: Array<keyof MCPServerParams> = [
    'timeout',
    'connectionTimeout',
    'requestTimeout',
    'oauth',
    'headers',
    'inheritParentEnv',
  ];

  for (const key of fallbackKeys) {
    if (
      rawConfig[key] === undefined &&
      effectiveConfig[key] !== undefined &&
      globalConfig[key as keyof GlobalTransportConfig] !== undefined
    ) {
      inherited.push(String(key));
    }
  }

  if (rawConfig.env === undefined && effectiveConfig.env !== undefined && globalConfig.env !== undefined) {
    inherited.push('env');
  }

  if (
    rawConfig.envFilter === undefined &&
    Array.isArray(effectiveConfig.envFilter) &&
    effectiveConfig.envFilter.length > 0 &&
    Array.isArray(globalConfig.envFilter) &&
    globalConfig.envFilter.length > 0
  ) {
    inherited.push('envFilter');
  }

  if (
    Array.isArray(rawConfig.envFilter) &&
    Array.isArray(effectiveConfig.envFilter) &&
    Array.isArray(globalConfig.envFilter) &&
    effectiveConfig.envFilter.some((pattern) => !rawConfig.envFilter?.includes(pattern))
  ) {
    inherited.push('envFilter(merged)');
  }

  if (
    rawConfig.env &&
    effectiveConfig.env &&
    typeof rawConfig.env === 'object' &&
    typeof effectiveConfig.env === 'object' &&
    !Array.isArray(rawConfig.env) &&
    !Array.isArray(effectiveConfig.env) &&
    typeof globalConfig.env === 'object' &&
    globalConfig.env !== null &&
    !Array.isArray(globalConfig.env)
  ) {
    const rawEnv = rawConfig.env as Record<string, string>;
    const effectiveEnv = effectiveConfig.env as Record<string, string>;
    if (Object.keys(effectiveEnv).some((key) => !(key in rawEnv))) {
      inherited.push('env(merged)');
    }
  }

  return inherited;
}
