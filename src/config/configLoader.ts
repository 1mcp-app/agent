import fs from 'fs';

import { substituteEnvVarsInConfig } from '@src/config/envProcessor.js';
import { DEFAULT_CONFIG, getGlobalConfigDir, getGlobalConfigPath } from '@src/constants.js';
import { MCP_CONFIG_SCHEMA_URL } from '@src/constants/schema.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { MCPServerParams, transportConfigSchema } from '@src/core/types/transport.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { ZodError } from 'zod';

interface ErrnoException extends Error {
  code?: string;
}

export class ConfigLoader {
  private configFilePath: string;
  private lastModified = 0;

  constructor(configFilePath?: string) {
    this.configFilePath = configFilePath || getGlobalConfigPath();
    this.ensureConfigExists();
  }

  private ensureConfigExists(): void {
    try {
      const configDir = getGlobalConfigDir();
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

  public loadRawConfig(): unknown {
    try {
      const stats = fs.statSync(this.configFilePath);
      this.lastModified = stats.mtime.getTime();
      const rawConfigData = fs.readFileSync(this.configFilePath, 'utf8');
      const config = JSON.parse(rawConfigData) as Record<string, unknown>;

      // Ensure $schema field is present for IDE autocompletion
      if (config && typeof config === 'object' && !('$schema' in config)) {
        config.$schema = MCP_CONFIG_SCHEMA_URL;

        // Log the enhancement for debugging and transparency
        debugIf(() => ({
          message: `Added $schema property to config for IDE autocompletion`,
          meta: {
            configPath: this.configFilePath,
            schemaUrl: MCP_CONFIG_SCHEMA_URL,
          },
        }));
      }

      return config;
    } catch (error) {
      const message = `Failed to load configuration from '${this.configFilePath}': ${error instanceof Error ? error.message : String(error)}`;
      logger.error(message, {
        configPath: this.configFilePath,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });
      throw error;
    }
  }

  public validateServerConfig(serverName: string, config: unknown): MCPServerParams {
    try {
      return transportConfigSchema.parse(config);
    } catch (error) {
      if (error instanceof ZodError) {
        const fieldErrors = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        throw new Error(`Invalid configuration for server '${serverName}': ${fieldErrors}`);
      }
      throw new Error(
        `Invalid configuration for server '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public loadConfigWithEnvSubstitution(): Record<string, MCPServerParams> {
    let rawConfig: unknown;
    try {
      rawConfig = this.loadRawConfig();
    } catch (error) {
      const errorMsg = `Failed to load raw configuration: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const agentConfig = AgentConfigManager.getInstance();
    const features = agentConfig.get('features');

    const processedConfig = features.envSubstitution ? substituteEnvVarsInConfig(rawConfig) : rawConfig;

    if (!processedConfig || typeof processedConfig !== 'object') {
      const errorMsg = 'Invalid configuration format';
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const configObj = processedConfig as Record<string, unknown>;
    const mcpServersConfig = (configObj.mcpServers as Record<string, unknown>) || {};
    const mcpTemplatesConfig = (configObj.mcpTemplates as Record<string, unknown>) || {};
    const templateServerNames = new Set(Object.keys(mcpTemplatesConfig));

    const validatedConfig: Record<string, MCPServerParams> = {};
    for (const [serverName, serverConfig] of Object.entries(mcpServersConfig)) {
      try {
        validatedConfig[serverName] = this.validateServerConfig(serverName, serverConfig);
        debugIf(() => ({
          message: `Validated configuration for server: ${serverName}`,
          meta: { serverName },
        }));
      } catch (error) {
        logger.error(`Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }

    const conflictingServers: string[] = [];
    for (const serverName of Object.keys(validatedConfig)) {
      if (templateServerNames.has(serverName)) {
        conflictingServers.push(serverName);
        delete validatedConfig[serverName];
      }
    }

    if (conflictingServers.length > 0) {
      logger.warn(
        `Ignoring ${conflictingServers.length} static server(s) that conflict with template servers: ${conflictingServers.join(', ')}`,
      );
    }

    return validatedConfig;
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
