import { ClientManager } from '@src/core/client/clientManager.js';
import type { PooledClientInstance } from '@src/core/server/clientInstancePool.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import {
  AmbiguousTemplateInstanceIdError,
  formatTemplateInstanceId,
  resolveTemplateInstanceId,
} from '@src/core/server/templateIdentity.js';
import type { MCPServerParams } from '@src/core/types/index.js';

import type {
  BackendRestartSelection,
  RuntimeBackendRestartResult,
  RuntimeBackendRestartService,
} from './adminBackendRestartService.js';

export class RuntimeServerManagerBackendRestartService implements RuntimeBackendRestartService {
  constructor(
    private readonly options: {
      serverManager: ServerManager;
      resolveTarget: (targetName: string) => {
        source: 'mcpServers' | 'mcpTemplates';
        serverConfig: MCPServerParams;
      } | null;
    },
  ) {}

  async restart(input: {
    targetName: string;
    selection: BackendRestartSelection;
  }): Promise<RuntimeBackendRestartResult> {
    const target = this.options.resolveTarget(input.targetName);
    const templateManager = this.options.serverManager.getTemplateServerManager();
    const instances = templateManager
      .getTemplateInstances(input.targetName)
      .filter((instance) => instance.referenceCount > 0);
    const isTemplate = target?.source === 'mcpTemplates';

    if (isTemplate) {
      return this.restartTemplate(input.targetName, input.selection, instances);
    }

    if (!target) {
      return this.result(input.targetName, 'target_not_found');
    }
    if (input.selection.mode !== 'target_default') {
      return this.result(input.targetName, 'instance_not_found', 'static');
    }
    if (target.serverConfig.disabled) {
      return this.result(input.targetName, 'target_disabled', 'static');
    }

    const connection = this.options.serverManager.getClient(input.targetName);
    if (connection?.transport.stdioSupervision) {
      await ClientManager.current.restartBackend(input.targetName);
    } else {
      await this.options.serverManager.loadMcpServer(input.targetName, target.serverConfig);
    }

    return this.result(input.targetName, 'restarted', 'static');
  }

  private async restartTemplate(
    targetName: string,
    selection: BackendRestartSelection,
    instances: PooledClientInstance[],
  ): Promise<RuntimeBackendRestartResult> {
    if (instances.length === 0) {
      return this.result(targetName, 'no_active_instances', 'template');
    }

    let selected = instances;
    if (selection.mode === 'target_default') {
      selected = instances.filter(
        (instance) => instance.supervision?.state === 'restarting' || instance.supervision?.state === 'crash-loop',
      );
    } else if (selection.mode === 'instance') {
      try {
        const resolvedId = resolveTemplateInstanceId(
          selection.instanceIdOrPrefix,
          instances.map((instance) => instance.id),
        );
        const instance = instances.find((candidate) => candidate.id === resolvedId);
        if (!instance) {
          return this.result(targetName, 'instance_not_found', 'template');
        }
        selected = [instance];
      } catch (error) {
        if (error instanceof AmbiguousTemplateInstanceIdError) {
          return {
            ...this.result(targetName, 'instance_ambiguous', 'template'),
            candidateInstanceIds: error.matchingShortIds,
          };
        }
        throw error;
      }
    }

    if (selected.length === 0) {
      return this.result(targetName, 'no_unhealthy_instances', 'template');
    }

    for (const instance of selected) {
      await this.options.serverManager.getTemplateServerManager().restartTemplateInstance(instance);
    }

    return {
      ...this.result(targetName, 'restarted', 'template'),
      restartedInstanceIds: selected.map((instance) => formatTemplateInstanceId(instance.id)),
    };
  }

  private result(
    targetName: string,
    outcome: RuntimeBackendRestartResult['outcome'],
    targetType?: RuntimeBackendRestartResult['targetType'],
  ): RuntimeBackendRestartResult {
    return { targetName, targetType, outcome, restartedInstanceIds: [] };
  }
}
