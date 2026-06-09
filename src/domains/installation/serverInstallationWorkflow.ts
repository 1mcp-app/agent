import { resolveServerTarget } from '@src/commands/mcp/utils/mcpServerConfig.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import {
  type ConfigBackupPolicy,
  type ConfigChangeResult,
  type ConfiguredServerTargetRef,
  createConfigChangeService,
} from '@src/domains/config-change/configChange.js';
import { createRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import type { RegistryServer } from '@src/domains/registry/types.js';

import {
  resolveDirectInstallTarget,
  resolveRegistryInstallTarget,
  validateRegistrySource,
} from './serverInstallationSourceResolution.js';
import type {
  RegistryInstallationSource,
  ResolvedInstallTarget,
  ServerInstallationWorkflow,
  ServerInstallationWorkflowInput,
  ServerInstallationWorkflowMode,
  ServerInstallationWorkflowPorts,
  ServerInstallationWorkflowResult,
  ServerInstallationWorkflowSource,
  TargetResolution,
} from './serverInstallationTypes.js';

export type {
  DirectInstallationSource,
  DirectInstallTransport,
  RegistryInstallationSource,
  SelectedRegistryEndpoint,
  ServerInstallationMetadata,
  ServerInstallationWorkflow,
  ServerInstallationWorkflowInput,
  ServerInstallationWorkflowMode,
  ServerInstallationWorkflowPorts,
  ServerInstallationWorkflowResult,
  ServerInstallationWorkflowSource,
  ServerInstallationWorkflowSourceType,
  ServerInstallationWorkflowStatus,
} from './serverInstallationTypes.js';

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

    return resolveRegistryInstallTarget(source, registryServer);
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
