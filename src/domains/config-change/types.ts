import type { MCPServerParams } from '@src/core/types/index.js';

export type ConfiguredServerTargetSource = 'mcpServers' | 'mcpTemplates';
export type ConfigChangeOperation = 'remove' | 'set_static' | 'enable' | 'disable';
export type ConfigChangeReason = 'install' | 'uninstall' | 'remove' | 'config_change' | 'enable' | 'disable';
export type ConfigChangeStatus = 'changed' | 'unchanged' | 'not_found' | 'template_conflict' | 'failed';
export type ConfigReloadStatus = 'observed' | 'runtime_not_running' | 'reload_disabled' | 'failed' | 'skipped';
export type ConfigBackupPolicy = 'required' | 'skip';

export interface ConfiguredServerTargetRef {
  name: string;
  source?: ConfiguredServerTargetSource;
}

export interface ConfigBackupResult {
  created: boolean;
  path?: string;
  error?: string;
}

export interface ConfigReloadResult {
  status: ConfigReloadStatus;
  error?: string;
}

export interface ConfigRetentionCleanupResult {
  attempted: boolean;
  deletedPaths: string[];
  warnings: string[];
}

export interface ConfigChangeResult {
  status: ConfigChangeStatus;
  operation: ConfigChangeOperation;
  configPath: string;
  target: ConfiguredServerTargetRef;
  changed: boolean;
  backup: ConfigBackupResult;
  retentionCleanup: ConfigRetentionCleanupResult;
  reload: ConfigReloadResult;
  warnings: string[];
  error?: string;
}

export interface RemoveConfiguredServerTargetInput {
  targetName: string;
  operation?: ConfigChangeReason;
  backup?: ConfigBackupPolicy;
}

export interface SetStaticConfiguredServerTargetInput {
  targetName: string;
  serverConfig: MCPServerParams;
  operation?: ConfigChangeReason;
  backup?: ConfigBackupPolicy;
}

export interface SetConfiguredServerTargetEnabledStateInput {
  targetName: string;
  enabled: boolean;
  backup?: ConfigBackupPolicy;
}

export interface ConfigChangePorts {
  getConfigPath?: () => string;
  reloadConfig?: (configPath: string) => void;
  now?: () => number;
  lockTimeoutMs?: number;
}

export interface ConfigChangeService {
  removeConfiguredServerTarget(input: RemoveConfiguredServerTargetInput): Promise<ConfigChangeResult>;
  setStaticConfiguredServerTarget(input: SetStaticConfiguredServerTargetInput): Promise<ConfigChangeResult>;
  previewConfiguredServerTargetEnabledState(
    input: SetConfiguredServerTargetEnabledStateInput,
  ): Promise<ConfigChangeResult>;
  setConfiguredServerTargetEnabledState(input: SetConfiguredServerTargetEnabledStateInput): Promise<ConfigChangeResult>;
  acquireConfigLockForTest(configPath: string): Promise<() => void>;
}

export interface MutableConfigDocument extends Record<string, unknown> {
  mcpServers?: Record<string, MCPServerParams>;
  mcpTemplates?: Record<string, MCPServerParams>;
}
