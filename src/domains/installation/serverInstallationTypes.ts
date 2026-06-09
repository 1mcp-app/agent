import type { MCPServerParams } from '@src/core/types/index.js';
import type {
  ConfigBackupPolicy,
  ConfigChangeResult,
  ConfiguredServerTargetRef,
} from '@src/domains/config-change/configChange.js';
import type { RegistryServer } from '@src/domains/registry/types.js';

export type ServerInstallationWorkflowMode = 'preview' | 'apply';
export type ServerInstallationWorkflowSourceType = 'registry' | 'direct';
export type DirectInstallTransport = 'stdio' | 'http' | 'sse';
export type ServerInstallationWorkflowStatus =
  | 'preview'
  | 'applied'
  | 'exists'
  | 'template_conflict'
  | 'invalid_input'
  | 'not_found'
  | 'registry_unavailable'
  | 'failed';

export interface RegistryInstallationSource {
  type: 'registry';
  registryId: string;
  version?: string;
  localName?: string;
  tags?: string[];
  env?: Record<string, string>;
  args?: string[];
}

export interface DirectInstallationSource {
  type: 'direct';
  localName: string;
  transport: DirectInstallTransport;
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  tags?: string[];
  timeout?: number;
  enabled?: boolean;
  cwd?: string;
  autoRestart?: boolean;
  maxRestarts?: number;
  restartDelay?: number;
  package?: string;
}

export type ServerInstallationWorkflowSource = RegistryInstallationSource | DirectInstallationSource;

export interface ServerInstallationWorkflowInput {
  mode: ServerInstallationWorkflowMode;
  source: ServerInstallationWorkflowSource;
  force?: boolean;
  backup?: ConfigBackupPolicy;
}

export type SelectedRegistryEndpoint =
  | {
      kind: 'package';
      type: string;
      identifier: string;
    }
  | {
      kind: 'remote';
      type: string;
      url: string;
    };

export interface ServerInstallationMetadata {
  registryId?: string;
  localName: string;
  version?: string;
  selectedEndpoint?: SelectedRegistryEndpoint;
}

export interface ServerInstallationWorkflowResult {
  status: ServerInstallationWorkflowStatus;
  mode: ServerInstallationWorkflowMode;
  sourceType: ServerInstallationWorkflowSourceType;
  targetName?: string;
  registryId?: string;
  version?: string;
  config?: MCPServerParams;
  selectedEndpoint?: SelectedRegistryEndpoint;
  metadata?: ServerInstallationMetadata;
  configChange?: ConfigChangeResult;
  warnings: string[];
  fieldErrors?: Record<string, string[]>;
  error?: string;
}

export interface ServerInstallationWorkflowPorts {
  getRegistryServer?: (registryId: string, version?: string) => Promise<RegistryServer | null>;
  findConfiguredTarget?: (targetName: string) => ConfiguredServerTargetRef | null;
  applyConfigChange?: (input: {
    targetName: string;
    serverConfig: MCPServerParams;
    operation: 'install';
    backup: ConfigBackupPolicy;
  }) => Promise<ConfigChangeResult>;
}

export interface ServerInstallationWorkflow {
  run(input: ServerInstallationWorkflowInput): Promise<ServerInstallationWorkflowResult>;
}

export interface ResolvedInstallTarget {
  sourceType: ServerInstallationWorkflowSourceType;
  targetName: string;
  registryId?: string;
  version?: string;
  config: MCPServerParams;
  selectedEndpoint?: SelectedRegistryEndpoint;
  warnings: string[];
  metadata: ServerInstallationMetadata;
}

export interface InvalidResolvedInstallTarget {
  status: 'invalid_input' | 'not_found' | 'registry_unavailable';
  sourceType: ServerInstallationWorkflowSourceType;
  registryId?: string;
  targetName?: string;
  fieldErrors?: Record<string, string[]>;
  error?: string;
  warnings: string[];
}

export type TargetResolution = ResolvedInstallTarget | InvalidResolvedInstallTarget;
