import fs from 'fs';
import { createHmac, randomBytes } from 'node:crypto';
import path from 'path';

import ConfigContext from '@src/config/configContext.js';
import { ConfigLoader } from '@src/config/configLoader.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { parse as parseToml } from 'smol-toml';

import {
  type BackupRetentionPolicy,
  DEFAULT_BACKUP_RETENTION,
  listConfigBackups,
  retentionSkipped,
} from './backupRetention.js';
import {
  acquireConfigLock,
  ConfigLockTimeoutError,
  DEFAULT_LOCK_TIMEOUT_MS,
  type ReleaseConfigLock,
} from './configLock.js';
import type {
  ConfigBackupPolicy,
  ConfigBackupResult,
  ConfigChangePorts,
  ConfigChangeReason,
  ConfigChangeResult,
  ConfigChangeService,
  ConfigReloadResult,
  ConfigRetentionCleanupResult,
  ConfiguredServerTargetRef,
  EditConfiguredServerTargetInput,
  MutableConfigDocument,
  RemoveConfiguredServerTargetInput,
  SetConfiguredServerTargetEnabledStateInput,
  SetStaticConfiguredServerTargetInput,
} from './types.js';

export type {
  ConfigBackupPolicy,
  ConfigBackupResult,
  ConfigChangeOperation,
  ConfigChangePorts,
  ConfigChangeReason,
  ConfigChangeResult,
  ConfigChangeService,
  ConfigChangeStatus,
  ConfigReloadResult,
  ConfigReloadStatus,
  ConfigRetentionCleanupResult,
  ConfiguredServerTargetRef,
  ConfiguredServerTargetSource,
  EditConfiguredServerTargetInput,
  RemoveConfiguredServerTargetInput,
  SetConfiguredServerTargetEnabledStateInput,
  SetStaticConfiguredServerTargetInput,
} from './types.js';

export function createConfigChangeService(ports: ConfigChangePorts = {}): ConfigChangeService {
  return new DefaultConfigChangeService(ports);
}

const CONFIGURED_SERVER_FINGERPRINT_KEY = randomBytes(32);

export function fingerprintConfiguredServerTarget(serverConfig: MCPServerParams): string {
  return `configured_server_${keyedConfiguredServerFingerprint('target', stableStringify(serverConfig))}`;
}

export function fingerprintConfiguredServerSecretValue(value: string): string {
  return keyedConfiguredServerFingerprint('inline-secret', value);
}

export function isConfiguredServerTargetDisabled(value: MCPServerParams['disabled']): boolean {
  if (typeof value !== 'string') return value === true;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

class DefaultConfigChangeService implements ConfigChangeService {
  constructor(private readonly ports: ConfigChangePorts) {}

  async removeConfiguredServerTarget(input: RemoveConfiguredServerTargetInput): Promise<ConfigChangeResult> {
    const configPath = this.resolveConfigPath();
    const operation = input.operation ?? 'remove';
    let releaseLock: ReleaseConfigLock;

    try {
      releaseLock = await acquireConfigLock(configPath, this.ports.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof ConfigLockTimeoutError) {
        return {
          status: 'failed',
          operation: 'remove',
          configPath,
          target: { name: input.targetName },
          changed: false,
          backup: { created: false },
          retentionCleanup: retentionSkipped(),
          reload: { status: 'skipped' },
          warnings: [],
          error: error.message,
        };
      }

      throw error;
    }

    let resultWithoutReload: ConfigChangeResult;

    try {
      const config = this.loadConfig(configPath);
      const target = resolveConfiguredServerTarget(config, input.targetName);

      if (!target.source) {
        resultWithoutReload = {
          status: 'not_found',
          operation: 'remove',
          configPath,
          target,
          changed: false,
          backup: { created: false },
          retentionCleanup: retentionSkipped(),
          reload: { status: 'skipped' },
          warnings: [],
        };
        return resultWithoutReload;
      }

      const backup = this.createBackupIfNeeded(configPath, input.backup ?? backupPolicyFor(operation));
      const existingTarget = target as Required<ConfiguredServerTargetRef>;
      removeTarget(config, existingTarget);
      this.validateConfig(configPath, config);
      this.writeConfig(configPath, config);
      const retentionCleanup = this.cleanupBackups(configPath, backup);

      resultWithoutReload = {
        status: 'changed',
        operation: 'remove',
        configPath,
        target,
        changed: true,
        backup,
        retentionCleanup,
        reload: { status: 'skipped' },
        warnings: retentionCleanup.warnings,
      };
    } finally {
      releaseLock();
    }

    return {
      ...resultWithoutReload,
      reload: this.reloadConfig(configPath),
    };
  }

  async setStaticConfiguredServerTarget(input: SetStaticConfiguredServerTargetInput): Promise<ConfigChangeResult> {
    const configPath = this.resolveConfigPath();
    const operation = input.operation ?? 'config_change';
    let releaseLock: ReleaseConfigLock;

    try {
      releaseLock = await acquireConfigLock(configPath, this.ports.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof ConfigLockTimeoutError) {
        return {
          status: 'failed',
          operation: 'set_static',
          configPath,
          target: { name: input.targetName },
          changed: false,
          backup: { created: false },
          retentionCleanup: retentionSkipped(),
          reload: { status: 'skipped' },
          warnings: [],
          error: error.message,
        };
      }

      throw error;
    }

    let resultWithoutReload: ConfigChangeResult;

    try {
      const config = this.loadConfigForSet(configPath);
      const target = resolveConfiguredServerTarget(config, input.targetName);

      if (target.source === 'mcpTemplates') {
        resultWithoutReload = {
          status: 'template_conflict',
          operation: 'set_static',
          configPath,
          target,
          changed: false,
          backup: { created: false },
          retentionCleanup: retentionSkipped(),
          reload: { status: 'skipped' },
          warnings: [],
          error: `Configured server target '${input.targetName}' exists in mcpTemplates and cannot be replaced by a static install`,
        };
        return resultWithoutReload;
      }

      const backup = this.createBackupIfNeeded(configPath, input.backup ?? backupPolicyFor(operation));
      config.mcpServers = normalizeServerRecord(config.mcpServers);
      config.mcpServers[input.targetName] = input.serverConfig;
      this.validateConfig(configPath, config);
      this.writeConfig(configPath, config);
      const retentionCleanup = this.cleanupBackups(configPath, backup);

      resultWithoutReload = {
        status: 'changed',
        operation: 'set_static',
        configPath,
        target: {
          name: input.targetName,
          source: 'mcpServers',
        },
        changed: true,
        backup,
        retentionCleanup,
        reload: { status: 'skipped' },
        warnings: retentionCleanup.warnings,
      };
    } finally {
      releaseLock();
    }

    return {
      ...resultWithoutReload,
      reload: this.reloadConfig(configPath),
    };
  }

  async setConfiguredServerTargetEnabledState(
    input: SetConfiguredServerTargetEnabledStateInput,
  ): Promise<ConfigChangeResult> {
    const configPath = this.resolveConfigPath();
    const operation = input.enabled ? 'enable' : 'disable';
    let releaseLock: ReleaseConfigLock;

    try {
      releaseLock = await acquireConfigLock(configPath, this.ports.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof ConfigLockTimeoutError) {
        return {
          status: 'failed',
          operation,
          configPath,
          target: { name: input.targetName },
          changed: false,
          backup: { created: false },
          retentionCleanup: retentionSkipped(),
          reload: { status: 'skipped' },
          warnings: [],
          error: error.message,
        };
      }

      throw error;
    }

    let resultWithoutReload: ConfigChangeResult;

    try {
      const config = this.loadConfig(configPath);
      const target = resolveConfiguredServerTarget(config, input.targetName);

      if (!target.source) {
        resultWithoutReload = {
          status: 'not_found',
          operation,
          configPath,
          target,
          changed: false,
          backup: { created: false },
          retentionCleanup: retentionSkipped(),
          reload: { status: 'skipped' },
          warnings: [],
        };
        return resultWithoutReload;
      }

      if (target.source === 'mcpTemplates') {
        resultWithoutReload = {
          status: 'template_conflict',
          operation,
          configPath,
          target,
          changed: false,
          backup: { created: false },
          retentionCleanup: retentionSkipped(),
          reload: { status: 'skipped' },
          warnings: [],
          error: `Configured server target '${input.targetName}' exists in mcpTemplates and does not support enable/disable`,
        };
        return resultWithoutReload;
      }

      const existingConfig = config.mcpServers?.[input.targetName];
      if (!existingConfig) {
        resultWithoutReload = {
          status: 'not_found',
          operation,
          configPath,
          target,
          changed: false,
          backup: { created: false },
          retentionCleanup: retentionSkipped(),
          reload: { status: 'skipped' },
          warnings: [],
        };
        return resultWithoutReload;
      }

      if (isConfiguredServerTargetDisabled(existingConfig.disabled) === !input.enabled) {
        resultWithoutReload = {
          status: 'unchanged',
          operation,
          configPath,
          target,
          changed: false,
          backup: { created: false },
          retentionCleanup: retentionSkipped(),
          reload: { status: 'skipped' },
          warnings: [],
        };
        return resultWithoutReload;
      }

      const backup = this.createBackupIfNeeded(configPath, input.backup ?? 'required');
      const updatedConfig: MCPServerParams = {
        ...existingConfig,
        disabled: !input.enabled,
      };
      if (input.enabled) {
        delete updatedConfig.disabled;
      }
      config.mcpServers = normalizeServerRecord(config.mcpServers);
      config.mcpServers[input.targetName] = updatedConfig;
      this.validateConfig(configPath, config);
      this.writeConfig(configPath, config);
      const retentionCleanup = this.cleanupBackups(configPath, backup);

      resultWithoutReload = {
        status: 'changed',
        operation,
        configPath,
        target,
        changed: true,
        backup,
        retentionCleanup,
        reload: { status: 'skipped' },
        warnings: retentionCleanup.warnings,
      };
    } finally {
      releaseLock();
    }

    return {
      ...resultWithoutReload,
      reload: this.reloadConfig(configPath),
    };
  }

  async editConfiguredServerTarget(input: EditConfiguredServerTargetInput): Promise<ConfigChangeResult> {
    const configPath = this.resolveConfigPath();
    let releaseLock: ReleaseConfigLock;

    try {
      releaseLock = await acquireConfigLock(configPath, this.ports.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof ConfigLockTimeoutError) {
        return failedEditResult(configPath, input.sourceName, error.message);
      }
      throw error;
    }

    let resultWithoutReload: ConfigChangeResult;
    try {
      const config = this.loadConfig(configPath);
      const source = resolveConfiguredServerTarget(config, input.sourceName);
      if (!source.source) {
        return editConflictResult('not_found', configPath, source);
      }
      if (source.source === 'mcpTemplates') {
        return editConflictResult(
          'template_conflict',
          configPath,
          source,
          `Configured server target '${input.sourceName}' exists in mcpTemplates and cannot be edited`,
        );
      }

      const existingConfig = config.mcpServers?.[input.sourceName];
      if (!existingConfig) {
        return editConflictResult('not_found', configPath, source);
      }
      if (fingerprintConfiguredServerTarget(existingConfig) !== input.expectedSourceFingerprint) {
        return editConflictResult(
          'source_conflict',
          configPath,
          source,
          `Configured server target '${input.sourceName}' changed after preview`,
        );
      }

      if (input.targetName !== input.sourceName) {
        const destination = resolveConfiguredServerTarget(config, input.targetName);
        if (destination.source) {
          return editConflictResult(
            'destination_conflict',
            configPath,
            destination,
            `Configured server target '${input.targetName}' already exists`,
          );
        }
      }

      if (
        input.targetName === input.sourceName &&
        fingerprintConfiguredServerTarget(input.serverConfig) === input.expectedSourceFingerprint
      ) {
        return editConflictResult('unchanged', configPath, source);
      }

      const nextConfig = cloneConfig(config);
      nextConfig.mcpServers = normalizeServerRecord(nextConfig.mcpServers);
      delete nextConfig.mcpServers[input.sourceName];
      nextConfig.mcpServers[input.targetName] = input.serverConfig;
      this.validateConfig(configPath, nextConfig);
      const backup = this.createBackupIfNeeded(configPath, 'required');
      this.writeConfig(configPath, nextConfig);
      const retentionCleanup = this.cleanupBackups(configPath, backup);
      resultWithoutReload = {
        status: 'changed',
        operation: 'edit',
        configPath,
        target: { name: input.targetName, source: 'mcpServers' },
        changed: true,
        backup,
        retentionCleanup,
        reload: { status: 'skipped' },
        warnings: retentionCleanup.warnings,
      };
    } finally {
      releaseLock();
    }

    return { ...resultWithoutReload, reload: this.reloadConfig(configPath) };
  }

  async previewConfiguredServerTargetEnabledState(
    input: SetConfiguredServerTargetEnabledStateInput,
  ): Promise<ConfigChangeResult> {
    const configPath = this.resolveConfigPath();
    const operation = input.enabled ? 'enable' : 'disable';
    const config = this.loadConfig(configPath);
    const target = resolveConfiguredServerTarget(config, input.targetName);

    if (!target.source) {
      return {
        status: 'not_found',
        operation,
        configPath,
        target,
        changed: false,
        backup: { created: false },
        retentionCleanup: retentionSkipped(),
        reload: { status: 'skipped' },
        warnings: [],
      };
    }

    if (target.source === 'mcpTemplates') {
      return {
        status: 'template_conflict',
        operation,
        configPath,
        target,
        changed: false,
        backup: { created: false },
        retentionCleanup: retentionSkipped(),
        reload: { status: 'skipped' },
        warnings: [],
        error: `Configured server target '${input.targetName}' exists in mcpTemplates and does not support enable/disable`,
      };
    }

    const existingConfig = config.mcpServers?.[input.targetName];
    if (!existingConfig) {
      return {
        status: 'not_found',
        operation,
        configPath,
        target,
        changed: false,
        backup: { created: false },
        retentionCleanup: retentionSkipped(),
        reload: { status: 'skipped' },
        warnings: [],
      };
    }

    const changed = isConfiguredServerTargetDisabled(existingConfig.disabled) !== !input.enabled;
    if (changed) {
      const previewConfig = cloneConfig(config);
      previewConfig.mcpServers = normalizeServerRecord(previewConfig.mcpServers);
      const previewTargetConfig = previewConfig.mcpServers[input.targetName];
      if (!previewTargetConfig) {
        return {
          status: 'not_found',
          operation,
          configPath,
          target,
          changed: false,
          backup: { created: false },
          retentionCleanup: retentionSkipped(),
          reload: { status: 'skipped' },
          warnings: [],
        };
      }

      const updatedConfig: MCPServerParams = {
        ...previewTargetConfig,
        disabled: !input.enabled,
      };
      if (input.enabled) {
        delete updatedConfig.disabled;
      }
      previewConfig.mcpServers[input.targetName] = updatedConfig;

      try {
        this.validateConfig(configPath, previewConfig);
      } catch (error) {
        return {
          status: 'failed',
          operation,
          configPath,
          target,
          changed: false,
          backup: { created: false },
          retentionCleanup: retentionSkipped(),
          reload: { status: 'skipped' },
          warnings: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      status: changed ? 'changed' : 'unchanged',
      operation,
      configPath,
      target,
      changed,
      backup: { created: false },
      retentionCleanup: retentionSkipped(),
      reload: { status: 'skipped' },
      warnings: [],
    };
  }

  async acquireConfigLockForTest(configPath: string): Promise<() => void> {
    return acquireConfigLock(configPath, DEFAULT_LOCK_TIMEOUT_MS);
  }

  private resolveConfigPath(): string {
    return this.ports.getConfigPath?.() ?? ConfigContext.getInstance().getResolvedConfigPath();
  }

  private loadConfig(configPath: string): MutableConfigDocument {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }

    try {
      const content = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(content) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid configuration format');
      }

      const config = parsed as MutableConfigDocument;
      config.mcpServers = normalizeServerRecord(config.mcpServers);
      if (config.mcpTemplates !== undefined) {
        config.mcpTemplates = normalizeServerRecord(config.mcpTemplates);
      }

      return config;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in configuration file: ${configPath}`);
      }

      throw error;
    }
  }

  private loadConfigForSet(configPath: string): MutableConfigDocument {
    if (!fs.existsSync(configPath)) {
      return { mcpServers: {} };
    }

    return this.loadConfig(configPath);
  }

  private createBackupIfNeeded(configPath: string, backupPolicy: ConfigBackupPolicy): ConfigBackupResult {
    if (backupPolicy === 'skip') {
      return { created: false };
    }

    const backupPath = `${configPath}.backup.${this.ports.now?.() ?? Date.now()}`;

    try {
      fs.copyFileSync(configPath, backupPath);
      return {
        created: true,
        path: backupPath,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create config backup: ${errorMessage}`);
    }
  }

  private cleanupBackups(configPath: string, backup: ConfigBackupResult): ConfigRetentionCleanupResult {
    if (!backup.created) {
      return retentionSkipped();
    }

    const result: ConfigRetentionCleanupResult = {
      attempted: true,
      deletedPaths: [],
      warnings: [],
    };

    try {
      const policy = this.loadBackupRetentionPolicy(configPath);
      const backups = listConfigBackups(configPath);
      const cutoff = (this.ports.now?.() ?? Date.now()) - policy.maxAgeDays * 24 * 60 * 60 * 1000;
      const latestBackupPaths = new Set(backups.slice(0, policy.keepLatest).map((candidate) => candidate.path));

      for (const candidate of backups) {
        const outsideLatest = !latestBackupPaths.has(candidate.path);
        const olderThanMaxAge = candidate.timestamp < cutoff;
        if (!outsideLatest && !olderThanMaxAge) {
          continue;
        }

        try {
          fs.unlinkSync(candidate.path);
          result.deletedPaths.push(candidate.path);
        } catch (error) {
          result.warnings.push(
            `Failed to delete config backup ${candidate.path}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      result.warnings.push(
        `Failed to apply config backup retention: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }

  private loadBackupRetentionPolicy(configPath: string): BackupRetentionPolicy {
    const tomlPath = path.join(path.dirname(configPath), 'config.toml');
    if (!fs.existsSync(tomlPath)) {
      return DEFAULT_BACKUP_RETENTION;
    }

    try {
      const parsed = parseToml(fs.readFileSync(tomlPath, 'utf8')) as Record<string, unknown>;
      const configured =
        getNestedRecord(parsed, ['configChange', 'backupRetention']) ?? getNestedRecord(parsed, ['backupRetention']);

      return {
        keepLatest: readPositiveInteger(configured?.keepLatest, DEFAULT_BACKUP_RETENTION.keepLatest),
        maxAgeDays: readPositiveInteger(configured?.maxAgeDays, DEFAULT_BACKUP_RETENTION.maxAgeDays),
      };
    } catch (error) {
      logger.warn(
        `Failed to read config backup retention from ${tomlPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return DEFAULT_BACKUP_RETENTION;
    }
  }

  private validateConfig(configPath: string, config: MutableConfigDocument): void {
    const loader = new ConfigLoader(configPath, { ensureConfigExists: false });

    for (const [serverName, serverConfig] of Object.entries(config.mcpServers ?? {})) {
      loader.validateServerConfig(serverName, serverConfig);
    }

    for (const [serverName, serverConfig] of Object.entries(config.mcpTemplates ?? {})) {
      loader.validateServerConfig(serverName, serverConfig);
    }
  }

  private writeConfig(configPath: string, config: MutableConfigDocument): void {
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  private reloadConfig(configPath: string): ConfigReloadResult {
    try {
      if (this.ports.reloadConfig) {
        this.ports.reloadConfig(configPath);
      } else {
        McpConfigManager.getInstance(configPath).reloadConfig();
      }

      return { status: 'observed' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to reload MCP configuration after config change', { configPath, error });
      return {
        status: 'failed',
        error: errorMessage,
      };
    }
  }
}

function backupPolicyFor(operation: ConfigChangeReason): ConfigBackupPolicy {
  return operation === 'uninstall' || operation === 'remove' ? 'required' : 'skip';
}

function normalizeServerRecord(value: unknown): Record<string, MCPServerParams> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, MCPServerParams>;
}

function resolveConfiguredServerTarget(config: MutableConfigDocument, targetName: string): ConfiguredServerTargetRef {
  if (config.mcpTemplates?.[targetName]) {
    return {
      name: targetName,
      source: 'mcpTemplates',
    };
  }

  if (config.mcpServers?.[targetName]) {
    return {
      name: targetName,
      source: 'mcpServers',
    };
  }

  return { name: targetName };
}

function removeTarget(config: MutableConfigDocument, target: Required<ConfiguredServerTargetRef>): void {
  const section = target.source === 'mcpTemplates' ? config.mcpTemplates : config.mcpServers;
  if (!section) {
    return;
  }

  delete section[target.name];
}

function cloneConfig(config: MutableConfigDocument): MutableConfigDocument {
  return JSON.parse(JSON.stringify(config)) as MutableConfigDocument;
}

function failedEditResult(configPath: string, targetName: string, error: string): ConfigChangeResult {
  return editConflictResult('failed', configPath, { name: targetName }, error);
}

function editConflictResult(
  status: Extract<
    ConfigChangeResult['status'],
    'not_found' | 'template_conflict' | 'source_conflict' | 'destination_conflict' | 'unchanged' | 'failed'
  >,
  configPath: string,
  target: ConfiguredServerTargetRef,
  error?: string,
): ConfigChangeResult {
  return {
    status,
    operation: 'edit',
    configPath,
    target,
    changed: false,
    backup: { created: false },
    retentionCleanup: retentionSkipped(),
    reload: { status: 'skipped' },
    warnings: [],
    ...(error ? { error } : {}),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function keyedConfiguredServerFingerprint(domain: string, value: string): string {
  return createHmac('sha256', CONFIGURED_SERVER_FINGERPRINT_KEY)
    .update(domain)
    .update('\0')
    .update(value)
    .digest('hex');
}

function getNestedRecord(root: Record<string, unknown>, pathSegments: string[]): Record<string, unknown> | undefined {
  let current: unknown = root;
  for (const segment of pathSegments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return undefined;
  }

  return current as Record<string, unknown>;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}
