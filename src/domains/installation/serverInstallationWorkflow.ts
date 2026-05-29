import { resolveServerTarget } from '@src/commands/mcp/utils/mcpServerConfig.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import {
  type ConfigBackupPolicy,
  type ConfigChangeResult,
  type ConfiguredServerTargetRef,
  createConfigChangeService,
} from '@src/domains/config-change/configChange.js';
import { createRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import type { RegistryServer, ServerPackage, ServerRemote } from '@src/domains/registry/types.js';

import { deriveLocalName, isValidServerName } from './validators/serverNameValidator.js';

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

interface ResolvedInstallTarget {
  sourceType: ServerInstallationWorkflowSourceType;
  targetName: string;
  registryId?: string;
  version?: string;
  config: MCPServerParams;
  selectedEndpoint?: SelectedRegistryEndpoint;
  warnings: string[];
  metadata: ServerInstallationMetadata;
}

interface InvalidResolvedInstallTarget {
  status: 'invalid_input' | 'not_found' | 'registry_unavailable';
  sourceType: ServerInstallationWorkflowSourceType;
  registryId?: string;
  targetName?: string;
  fieldErrors?: Record<string, string[]>;
  error?: string;
  warnings: string[];
}

type TargetResolution = ResolvedInstallTarget | InvalidResolvedInstallTarget;

export function createServerInstallationWorkflow(
  ports: ServerInstallationWorkflowPorts = {},
): ServerInstallationWorkflow {
  return new DefaultServerInstallationWorkflow(ports);
}

class DefaultServerInstallationWorkflow implements ServerInstallationWorkflow {
  constructor(private readonly ports: ServerInstallationWorkflowPorts) {}

  async run(input: ServerInstallationWorkflowInput): Promise<ServerInstallationWorkflowResult> {
    const resolved = await this.resolveInstallTarget(input.source);
    if (!isResolvedTarget(resolved)) {
      return {
        status: resolved.status,
        mode: input.mode,
        sourceType: resolved.sourceType,
        targetName: resolved.targetName,
        registryId: resolved.registryId,
        warnings: resolved.warnings,
        fieldErrors: resolved.fieldErrors,
        error: resolved.error,
      };
    }

    const conflict = this.findConfiguredTarget(resolved.targetName);
    if (conflict?.source === 'mcpTemplates') {
      return {
        ...resultFromResolved(input.mode, resolved),
        status: 'template_conflict',
        error: `Configured server target '${resolved.targetName}' exists in mcpTemplates and cannot be replaced by install`,
      };
    }

    if (conflict?.source === 'mcpServers' && !input.force) {
      return {
        ...resultFromResolved(input.mode, resolved),
        status: 'exists',
        error: `Server '${resolved.targetName}' already exists. Use force to replace it.`,
      };
    }

    if (input.mode === 'preview') {
      return {
        ...resultFromResolved(input.mode, resolved),
        status: 'preview',
      };
    }

    const backup = input.backup ?? (conflict?.source === 'mcpServers' ? 'required' : 'skip');
    const configChange = await this.applyConfigChange({
      targetName: resolved.targetName,
      serverConfig: resolved.config,
      operation: 'install',
      backup,
    });

    if (configChange.status === 'changed') {
      return {
        ...resultFromResolved(input.mode, resolved),
        status: 'applied',
        configChange,
        warnings: [...resolved.warnings, ...configChange.warnings],
      };
    }

    return {
      ...resultFromResolved(input.mode, resolved),
      status: configChange.status === 'template_conflict' ? 'template_conflict' : 'failed',
      configChange,
      warnings: [...resolved.warnings, ...configChange.warnings],
      error: configChange.error ?? `Config Change returned ${configChange.status}`,
    };
  }

  private async resolveInstallTarget(source: ServerInstallationWorkflowSource): Promise<TargetResolution> {
    if (source.type === 'direct') {
      return resolveDirectInstallTarget(source);
    }

    return this.resolveRegistryInstallTarget(source);
  }

  private async resolveRegistryInstallTarget(source: RegistryInstallationSource): Promise<TargetResolution> {
    const fieldErrors = validateRegistrySource(source);
    if (Object.keys(fieldErrors).length > 0) {
      return {
        status: 'invalid_input',
        sourceType: 'registry',
        registryId: source.registryId,
        fieldErrors,
        warnings: [],
      };
    }

    let registryServer: RegistryServer | null;
    try {
      registryServer = await this.getRegistryServer(source.registryId, source.version);
    } catch (error) {
      return {
        status: 'registry_unavailable',
        sourceType: 'registry',
        registryId: source.registryId,
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (!registryServer) {
      return {
        status: 'not_found',
        sourceType: 'registry',
        registryId: source.registryId,
        warnings: [],
        error: `Server '${source.registryId}' not found in registry`,
      };
    }

    const endpoint = selectRegistryEndpoint(registryServer);
    if (!endpoint) {
      return {
        status: 'invalid_input',
        sourceType: 'registry',
        registryId: source.registryId,
        fieldErrors: {
          registryId: [`No compatible installation endpoint found for ${source.registryId}`],
        },
        warnings: [],
      };
    }

    const targetName = source.localName ?? deriveLocalName(source.registryId);
    if (!isValidServerName(targetName)) {
      return {
        status: 'invalid_input',
        sourceType: 'registry',
        registryId: source.registryId,
        targetName,
        fieldErrors: {
          localName: [`Local server name '${targetName}' is invalid`],
        },
        warnings: [],
      };
    }

    const config = createRegistryServerConfig({
      endpoint,
      registryId: source.registryId,
      targetName,
      tags: source.tags,
      env: source.env,
      args: source.args,
    });

    return {
      sourceType: 'registry',
      targetName,
      registryId: source.registryId,
      version: registryServer.version,
      config,
      selectedEndpoint: endpoint,
      warnings: [],
      metadata: {
        registryId: source.registryId,
        localName: targetName,
        version: registryServer.version,
        selectedEndpoint: endpoint,
      },
    };
  }

  private async getRegistryServer(registryId: string, version?: string): Promise<RegistryServer | null> {
    if (this.ports.getRegistryServer) {
      return this.ports.getRegistryServer(registryId, version);
    }

    return createRegistryClient().getServerById(registryId, version);
  }

  private findConfiguredTarget(targetName: string): ConfiguredServerTargetRef | null {
    if (this.ports.findConfiguredTarget) {
      return this.ports.findConfiguredTarget(targetName);
    }

    const target = resolveServerTarget(targetName);
    return target ? { name: target.serverName, source: target.source } : null;
  }

  private applyConfigChange(input: {
    targetName: string;
    serverConfig: MCPServerParams;
    operation: 'install';
    backup: ConfigBackupPolicy;
  }): Promise<ConfigChangeResult> {
    if (this.ports.applyConfigChange) {
      return this.ports.applyConfigChange(input);
    }

    return createConfigChangeService().setStaticConfiguredServerTarget(input);
  }
}

function resolveDirectInstallTarget(source: DirectInstallationSource): TargetResolution {
  const fieldErrors = validateDirectSource(source);
  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: 'invalid_input',
      sourceType: 'direct',
      targetName: source.localName,
      fieldErrors,
      warnings: [],
    };
  }

  const config = createDirectServerConfig(source);
  return {
    sourceType: 'direct',
    targetName: source.localName,
    config,
    warnings: [],
    metadata: {
      localName: source.localName,
    },
  };
}

function validateRegistrySource(source: RegistryInstallationSource): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (!source.registryId?.trim()) {
    pushFieldError(errors, 'registryId', 'Registry ID is required');
  }
  if (source.localName && !isValidServerName(source.localName)) {
    pushFieldError(errors, 'localName', `Local server name '${source.localName}' is invalid`);
  }
  return errors;
}

function validateDirectSource(source: DirectInstallationSource): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  if (!isValidServerName(source.localName)) {
    pushFieldError(errors, 'localName', `Local server name '${source.localName}' is invalid`);
  }

  if (source.transport === 'stdio') {
    if (!source.command?.trim()) {
      pushFieldError(errors, 'command', 'Direct stdio installs require command');
    }
    if (source.url) {
      pushFieldError(errors, 'url', 'Direct stdio installs cannot include url');
    }
    if (source.headers) {
      pushFieldError(errors, 'headers', 'Direct stdio installs cannot include headers');
    }
    return errors;
  }

  if (!source.url?.trim()) {
    pushFieldError(errors, 'url', `Direct ${source.transport} installs require url`);
  }
  if (source.command) {
    pushFieldError(errors, 'command', `Direct ${source.transport} installs cannot include command`);
  }
  if (source.args?.length) {
    pushFieldError(errors, 'args', `Direct ${source.transport} installs cannot include args`);
  }
  if (source.env && Object.keys(source.env).length > 0) {
    pushFieldError(errors, 'env', `Direct ${source.transport} installs cannot include env`);
  }
  if (source.cwd) {
    pushFieldError(errors, 'cwd', `Direct ${source.transport} installs cannot include cwd`);
  }

  return errors;
}

function createDirectServerConfig(source: DirectInstallationSource): MCPServerParams {
  const common = {
    tags: source.tags,
    timeout: source.timeout,
    disabled: source.enabled === undefined ? undefined : !source.enabled,
  };

  if (source.transport === 'stdio') {
    return omitUndefined({
      ...common,
      type: 'stdio',
      command: source.command,
      args: source.args,
      env: source.env,
      cwd: source.cwd,
      restartOnExit: source.autoRestart,
      maxRestarts: source.maxRestarts,
      restartDelay: source.restartDelay,
    });
  }

  return omitUndefined({
    ...common,
    type: source.transport,
    url: source.url,
    headers: source.headers,
  });
}

function selectRegistryEndpoint(registryServer: RegistryServer): SelectedRegistryEndpoint | undefined {
  const packages = registryServer.packages ?? [];
  if (packages.length > 0) {
    const selectedPackage = packages.find((candidate) => candidate.registryType === 'npm') ?? packages[0];
    return packageEndpoint(selectedPackage);
  }

  const remotes = registryServer.remotes ?? [];
  if (remotes.length > 0) {
    const selectedRemote = remotes.find((candidate) => candidate.type === 'streamable-http') ?? remotes[0];
    return remoteEndpoint(selectedRemote);
  }

  return undefined;
}

function packageEndpoint(serverPackage: ServerPackage): SelectedRegistryEndpoint {
  return {
    kind: 'package',
    type: serverPackage.registryType,
    identifier: serverPackage.identifier,
  };
}

function remoteEndpoint(remote: ServerRemote): SelectedRegistryEndpoint {
  return {
    kind: 'remote',
    type: remote.type,
    url: remote.url,
  };
}

function createRegistryServerConfig(input: {
  endpoint: SelectedRegistryEndpoint;
  registryId: string;
  targetName: string;
  tags?: string[];
  env?: Record<string, string>;
  args?: string[];
}): MCPServerParams {
  const tags = Array.from(new Set([...(input.tags ?? []), input.targetName, input.registryId]));

  if (input.endpoint.kind === 'package') {
    return omitUndefined({
      type: 'stdio',
      command: 'npx',
      args: [input.endpoint.identifier, ...(input.args ?? [])],
      env: input.env,
      tags,
    });
  }

  return omitUndefined({
    type: input.endpoint.type === 'sse' ? 'sse' : 'http',
    url: input.endpoint.url,
    tags,
  });
}

function resultFromResolved(
  mode: ServerInstallationWorkflowMode,
  resolved: ResolvedInstallTarget,
): Omit<ServerInstallationWorkflowResult, 'status'> {
  return {
    mode,
    sourceType: resolved.sourceType,
    targetName: resolved.targetName,
    registryId: resolved.registryId,
    version: resolved.version,
    config: resolved.config,
    selectedEndpoint: resolved.selectedEndpoint,
    metadata: resolved.metadata,
    warnings: resolved.warnings,
  };
}

function isResolvedTarget(resolved: TargetResolution): resolved is ResolvedInstallTarget {
  return !('status' in resolved);
}

function pushFieldError(errors: Record<string, string[]>, field: string, message: string): void {
  errors[field] = [...(errors[field] ?? []), message];
}

function omitUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}
