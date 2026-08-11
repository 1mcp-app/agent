import type { InstructionTemplateConfig, MCPServerParams } from '@src/core/types/transport.js';

export type ConfiguredServerTargetSource = 'mcpServers' | 'mcpTemplates';
export type InstructionTemplateConfigChangeOperation =
  | 'template_create'
  | 'template_clone'
  | 'template_update'
  | 'template_delete'
  | 'template_import'
  | 'template_activate';
export type ConfigChangeOperation =
  | 'remove'
  | 'set_static'
  | 'create_static'
  | 'edit'
  | 'enable'
  | 'disable'
  | InstructionTemplateConfigChangeOperation
  | 'instruction_override_set'
  | 'instruction_override_remove';
export type ConfigChangeReason = 'install' | 'uninstall' | 'remove' | 'config_change' | 'enable' | 'disable';
export type ConfigChangeStatus =
  'changed' | 'unchanged' | 'not_found' | 'template_conflict' | 'source_conflict' | 'destination_conflict' | 'failed';
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

export interface CreateStaticConfiguredServerTargetInput extends SetStaticConfiguredServerTargetInput {
  expectedConfigFingerprint?: string;
}

export interface SetConfiguredServerTargetEnabledStateInput {
  targetName: string;
  targetSource?: ConfiguredServerTargetSource;
  enabled: boolean;
  backup?: ConfigBackupPolicy;
}

export interface EditConfiguredServerTargetInput {
  sourceName: string;
  targetSource?: ConfiguredServerTargetSource;
  targetName: string;
  serverConfig: MCPServerParams;
  expectedSourceFingerprint: string;
  expectedGlobalConfigFingerprint?: string;
}

export interface SetInstructionTemplateConfigurationInput {
  operation: InstructionTemplateConfigChangeOperation;
  identity: string;
  instructionTemplates?: Record<string, InstructionTemplateConfig>;
  publishedInstructionTemplates?: Record<string, InstructionTemplateConfig>;
  activeInstructionTemplate?: string;
  expectedConfigFingerprint: string;
}

export type InstructionOverrideMutation = { action: 'set'; value: string } | { action: 'remove' };

export interface ChangeConfiguredServerInstructionOverrideInput {
  target: Required<ConfiguredServerTargetRef>;
  mutation: InstructionOverrideMutation;
  expectedSourceFingerprint: string;
  expectedConfigFingerprint?: string;
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
  createStaticConfiguredServerTarget(input: CreateStaticConfiguredServerTargetInput): Promise<ConfigChangeResult>;
  previewConfiguredServerTargetEnabledState(
    input: SetConfiguredServerTargetEnabledStateInput,
  ): Promise<ConfigChangeResult>;
  setConfiguredServerTargetEnabledState(input: SetConfiguredServerTargetEnabledStateInput): Promise<ConfigChangeResult>;
  editConfiguredServerTarget(input: EditConfiguredServerTargetInput): Promise<ConfigChangeResult>;
  setInstructionTemplateConfiguration(input: SetInstructionTemplateConfigurationInput): Promise<ConfigChangeResult>;
  changeConfiguredServerInstructionOverride(
    input: ChangeConfiguredServerInstructionOverrideInput,
  ): Promise<ConfigChangeResult>;
  acquireConfigLockForTest(configPath: string): Promise<() => void>;
}

export interface MutableConfigDocument extends Record<string, unknown> {
  mcpServers?: Record<string, MCPServerParams>;
  mcpTemplates?: Record<string, MCPServerParams>;
  instructionTemplates?: Record<string, InstructionTemplateConfig>;
  publishedInstructionTemplates?: Record<string, InstructionTemplateConfig>;
  activeInstructionTemplate?: string;
}
