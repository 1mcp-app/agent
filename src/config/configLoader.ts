import fs from 'fs';
import path from 'path';

import { substituteEnvVarsInConfig } from '@src/config/envProcessor.js';
import { getUnknownGlobalConfigKeys, mergeGlobalAndServerConfig } from '@src/config/mcpConfigMerge.js';
import { DEFAULT_CONFIG, getGlobalConfigPath } from '@src/constants.js';
import { MCP_CONFIG_SCHEMA_URL } from '@src/constants/schema.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import {
  ApplicationConfig,
  applicationConfigSchema,
  GlobalTransportConfig,
  globalTransportConfigSchema,
  MCPServerParams,
  transportConfigSchema,
} from '@src/core/types/transport.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { parse as parseToml } from 'smol-toml';
import { ZodError } from 'zod';

interface ErrnoException extends Error {
  code?: string;
}

interface RawConfigLoadResult {
  config: unknown;
  lastModified: number;
  schemaInjected: boolean;
}

export interface LoadedMcpConfig {
  rawConfig: Record<string, unknown>;
  processedConfig: Record<string, unknown>;
  globalConfig: GlobalTransportConfig;
  appConfig: ApplicationConfig;
  rawServers: Record<string, MCPServerParams>;
  validatedServers: Record<string, MCPServerParams>;
  lastModified: number;
  schemaInjected: boolean;
}

interface ConfigLoaderOptions {
  ensureConfigExists?: boolean;
}

interface LoadParsedConfigOptions {
  substituteEnv?: boolean;
  includeAppConfig?: boolean;
}

function formatZodIssues(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
}

function getValidationErrorMessage(context: string, error: unknown): string {
  if (error instanceof ZodError) {
    return `${context}: ${formatZodIssues(error)}`;
  }

  return `${context}: ${error instanceof Error ? error.message : String(error)}`;
}

function warnIfLegacyAppConfig(rawConfig: unknown, configFilePath: string): void {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return;
  }

  const configObj = rawConfig as Record<string, unknown>;
  if (configObj.app === undefined) {
    return;
  }

  const tomlPath = path.join(path.dirname(configFilePath), 'config.toml');
  logger.warn(
    `The "app" key in mcp.json is deprecated. Please move your app settings to ${tomlPath}. ` +
      `The "app" key in mcp.json will be ignored.`,
  );
}

function warnForUnknownGlobalConfigKeys(rawGlobal: unknown): void {
  const unknownGlobalKeys = getUnknownGlobalConfigKeys(rawGlobal);
  if (unknownGlobalKeys.length === 0) {
    return;
  }

  logger.warn(`Unknown properties in global MCP configuration were ignored: ${unknownGlobalKeys.join(', ')}`);
}

function normalizeRawServerConfigs(rawServers: unknown): Record<string, MCPServerParams> {
  if (!rawServers || typeof rawServers !== 'object') {
    return {};
  }

  const normalizedServers: Record<string, MCPServerParams> = {};

  for (const [serverName, serverConfig] of Object.entries(rawServers)) {
    if (serverConfig && typeof serverConfig === 'object') {
      normalizedServers[serverName] = serverConfig as MCPServerParams;
    }
  }

  return normalizedServers;
}

export function loadAppConfigFromTomlPath(tomlPath: string): ApplicationConfig {
  try {
    if (!fs.existsSync(tomlPath)) {
      return {};
    }
    const raw = fs.readFileSync(tomlPath, 'utf8');
    const parsed = parseToml(raw);
    return applicationConfigSchema.parse(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      logger.error(`Invalid app configuration in config.toml (ignored): ${formatZodIssues(error)}`);
    } else {
      logger.error(
        `Failed to load app configuration from ${tomlPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {};
  }
}

export class ConfigLoader {
  private configFilePath: string;
  private lastModified = 0;

  constructor(configFilePath?: string, options?: ConfigLoaderOptions) {
    this.configFilePath = configFilePath || getGlobalConfigPath();
    if (options?.ensureConfigExists !== false) {
      this.ensureConfigExists();
    }
  }

  private ensureConfigExists(): void {
    try {
      const configDir = path.dirname(this.configFilePath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
        logger.info(`Created config directory: ${configDir}`);
      }

      if (!fs.existsSync(this.configFilePath)) {
        fs.writeFileSync(this.configFilePath, JSON.stringify(DEFAULT_CONFIG, null, 2));
        logger.info(`Created default config file: ${this.configFilePath}`);
      }
    } catch (error) {
      logger.error(`Failed to ensure config exists: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  public getConfigFilePath(): string {
    return this.configFilePath;
  }

  public checkFileModified(): boolean {
    try {
      const stats = fs.statSync(this.configFilePath);
      const currentModified = stats.mtime.getTime();

      if (currentModified !== this.lastModified) {
        this.lastModified = currentModified;
        return true;
      }
      return false;
    } catch (error) {
      // For file modification checking, returning false is reasonable behavior
      // when file doesn't exist or can't be accessed - there's nothing to compare
      const errorCode = (error as ErrnoException).code;
      if (errorCode === 'ENOENT' || errorCode === 'EACCES') {
        logger.debug(`Cannot check file modification time for ${this.configFilePath}: ${errorCode}`);
        return false;
      }
      logger.warn(`Failed to check file modification time: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private loadRawConfigResult(): RawConfigLoadResult {
    try {
      const stats = fs.statSync(this.configFilePath);
      const lastModified = stats.mtime.getTime();
      this.lastModified = lastModified;
      const rawConfigData = fs.readFileSync(this.configFilePath, 'utf8');
      const config = JSON.parse(rawConfigData) as Record<string, unknown>;
      let schemaInjected = false;

      // Ensure $schema field is present for IDE autocompletion
      if (config && typeof config === 'object' && !('$schema' in config)) {
        config.$schema = MCP_CONFIG_SCHEMA_URL;
        schemaInjected = true;

        // Log the enhancement for debugging and transparency
        debugIf(() => ({
          message: `Added $schema property to config for IDE autocompletion`,
          meta: {
            configPath: this.configFilePath,
            schemaUrl: MCP_CONFIG_SCHEMA_URL,
          },
        }));
      }

      return { config, lastModified, schemaInjected };
    } catch (error) {
      const message = `Failed to load configuration from '${this.configFilePath}': ${error instanceof Error ? error.message : String(error)}`;
      logger.error(message, {
        configPath: this.configFilePath,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });
      throw error;
    }
  }

  public loadRawConfig(): unknown {
    return this.loadRawConfigResult().config;
  }

  public validateServerConfig(serverName: string, config: unknown): MCPServerParams {
    try {
      return transportConfigSchema.parse(config);
    } catch (error) {
      throw new Error(getValidationErrorMessage(`Invalid configuration for server '${serverName}'`, error));
    }
  }

  public validateGlobalConfig(config: unknown): GlobalTransportConfig {
    try {
      return globalTransportConfigSchema.parse(config);
    } catch (error) {
      throw new Error(getValidationErrorMessage('Invalid global configuration', error));
    }
  }

  public validateAppConfig(config: unknown): ApplicationConfig {
    try {
      return applicationConfigSchema.parse(config);
    } catch (error) {
      throw new Error(getValidationErrorMessage('Invalid app configuration', error));
    }
  }

  public loadAppConfig(): ApplicationConfig {
    // Check for legacy app key in mcp.json and warn
    try {
      warnIfLegacyAppConfig(this.loadRawConfig(), this.configFilePath);
    } catch (error) {
      logger.debug(`Could not check for legacy "app" key: ${error instanceof Error ? error.message : String(error)}`);
    }

    return this.loadAppConfigFromToml();
  }

  public loadAppConfigFromToml(): ApplicationConfig {
    const tomlPath = path.join(path.dirname(this.configFilePath), 'config.toml');
    return loadAppConfigFromTomlPath(tomlPath);
  }

  public loadParsedConfig(options?: LoadParsedConfigOptions): LoadedMcpConfig {
    let rawResult: RawConfigLoadResult;
    try {
      rawResult = this.loadRawConfigResult();
    } catch (error) {
      const errorMsg = `Failed to load raw configuration: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg, { cause: error });
    }

    const agentConfig = AgentConfigManager.getInstance();
    const features = agentConfig.get('features');
    const substituteEnv = options?.substituteEnv ?? features.envSubstitution;
    const processedConfig = substituteEnv ? substituteEnvVarsInConfig(rawResult.config) : rawResult.config;

    if (!processedConfig || typeof processedConfig !== 'object') {
      const errorMsg = 'Invalid configuration format';
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const configObj = processedConfig as Record<string, unknown>;
    const rawGlobal = configObj.serverDefaults;
    warnForUnknownGlobalConfigKeys(rawGlobal);
    const globalConfig = rawGlobal !== undefined ? this.validateGlobalConfig(rawGlobal) : {};

    warnIfLegacyAppConfig(configObj, this.configFilePath);
    const appConfig = options?.includeAppConfig === false ? {} : this.loadAppConfigFromToml();

    const rawServers = normalizeRawServerConfigs(configObj.mcpServers);
    const templateServerNames = new Set(Object.keys(normalizeRawServerConfigs(configObj.mcpTemplates)));
    const validatedServers: Record<string, MCPServerParams> = {};

    for (const [serverName, serverConfig] of Object.entries(rawServers)) {
      try {
        // Validate the raw server first, then re-validate after applying serverDefaults
        // so merged config errors are surfaced instead of silently accepted.
        const validatedServerConfig = this.validateServerConfig(serverName, serverConfig);
        const mergedConfig = mergeGlobalAndServerConfig(globalConfig, validatedServerConfig);
        validatedServers[serverName] = this.validateServerConfig(serverName, mergedConfig);
        debugIf(() => ({
          message: `Validated configuration for server: ${serverName}`,
          meta: { serverName },
        }));
      } catch (error) {
        logger.error(`Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const conflictingServers: string[] = [];
    for (const serverName of Object.keys(validatedServers)) {
      if (templateServerNames.has(serverName)) {
        conflictingServers.push(serverName);
        delete validatedServers[serverName];
      }
    }

    if (conflictingServers.length > 0) {
      logger.warn(
        `Ignoring ${conflictingServers.length} static server(s) that conflict with template servers: ${conflictingServers.join(', ')}`,
      );
    }

    return {
      rawConfig: rawResult.config as Record<string, unknown>,
      processedConfig: configObj,
      globalConfig,
      appConfig,
      rawServers,
      validatedServers,
      lastModified: rawResult.lastModified,
      schemaInjected: rawResult.schemaInjected,
    };
  }

  public loadParsedConfigWithEnvSubstitution(): LoadedMcpConfig {
    return this.loadParsedConfig();
  }

  public loadConfigWithEnvSubstitution(): Record<string, MCPServerParams> {
    return this.loadParsedConfigWithEnvSubstitution().validatedServers;
  }

  public getTransportConfig(transportConfig: Record<string, MCPServerParams>): Record<string, MCPServerParams> {
    const filtered: Record<string, MCPServerParams> = {};
    for (const [serverName, serverParams] of Object.entries(transportConfig)) {
      if (!serverParams.disabled) {
        filtered[serverName] = serverParams;
      }
    }
    return filtered;
  }

  public getAvailableTags(transportConfig: Record<string, MCPServerParams>): string[] {
    const tags = new Set<string>();

    for (const serverParams of Object.values(transportConfig)) {
      if (serverParams.disabled) continue;
      if (serverParams.tags?.[Symbol.iterator]) {
        for (const tag of serverParams.tags) tags.add(tag);
      }
    }

    return Array.from(tags).sort();
  }

  public isReloadEnabled(): boolean {
    const agentConfig = AgentConfigManager.getInstance();
    return agentConfig.get('features').configReload;
  }
}
