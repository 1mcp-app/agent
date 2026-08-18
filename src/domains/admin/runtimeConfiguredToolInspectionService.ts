import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  collectConfiguredToolPages,
  publishCompleteConfiguredToolInspection,
  readConfiguredToolSnapshot,
} from '@src/core/capabilities/configuredToolSnapshot.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus, type MCPServerParams, type OutboundConnection } from '@src/core/types/index.js';
import { isConfiguredServerTargetDisabled } from '@src/domains/config-change/configChange.js';
import { getRequestTimeout } from '@src/utils/core/timeoutUtils.js';

import {
  type ConfiguredToolInspectionOutcome,
  type ConfiguredToolInventory,
  type ConfiguredToolTargetSource,
  createConfiguredToolInventory,
} from './configuredToolInventory.js';

interface InspectionCandidate {
  instanceId: string;
  connection: OutboundConnection;
  connections: OutboundConnection[];
}

interface CandidateResolution {
  candidates: InspectionCandidate[];
  activeInstanceIds: string[];
  unavailable: Array<{ instanceId: string; status: 'unavailable'; error: string }>;
}

interface InspectionResult {
  inspection: ConfiguredToolInspectionOutcome;
  instances: Array<{ instanceId: string; connection: OutboundConnection }>;
}

export interface RefreshConfiguredToolInventoryInput {
  targetName: string;
  source: ConfiguredToolTargetSource;
  config: MCPServerParams;
  model?: string;
}

export class RuntimeConfiguredToolInspectionService {
  private readonly inFlight = new Map<string, Promise<InspectionResult>>();

  constructor(private readonly serverManager: ServerManager) {}

  async read(input: RefreshConfiguredToolInventoryInput): Promise<ConfiguredToolInventory> {
    const resolution = this.resolveCandidates(input.source, input.targetName);
    let inspection: ConfiguredToolInspectionOutcome;
    if (isConfiguredServerTargetDisabled(input.config.disabled)) {
      inspection = { status: 'unavailable', reason: 'target_disabled', retryable: false, instances: [] };
    } else if (resolution.activeInstanceIds.length === 0) {
      inspection = {
        status: 'unavailable',
        reason: input.source === 'mcpTemplates' ? 'no_active_instances' : 'target_disconnected',
        retryable: true,
        instances: [],
      };
    } else if (resolution.unavailable.length > 0) {
      inspection = {
        status: 'unavailable',
        reason: 'active_instance_unavailable',
        retryable: true,
        instances: [
          ...resolution.candidates.map(({ instanceId }) => ({ instanceId, status: 'unavailable' as const })),
          ...resolution.unavailable,
        ],
      };
    } else {
      const instanceFacts = resolution.candidates.map(({ instanceId, connection }) => ({
        instanceId,
        status: readConfiguredToolSnapshot(connection) === undefined ? ('unavailable' as const) : ('complete' as const),
      }));
      const complete =
        instanceFacts.length === resolution.activeInstanceIds.length &&
        instanceFacts.every((fact) => fact.status === 'complete');
      inspection = complete
        ? { status: 'complete', retryable: false, instances: instanceFacts }
        : {
            status: 'unavailable',
            reason: 'snapshot_unavailable',
            retryable: true,
            instances: instanceFacts,
          };
    }

    return createConfiguredToolInventory({
      ...input,
      connections: this.serverManager.getClients(),
      instances: resolution.candidates.map(({ instanceId, connection }) => ({ instanceId, connection })),
      inspection,
    });
  }

  async refresh(input: RefreshConfiguredToolInventoryInput): Promise<ConfiguredToolInventory> {
    const key = `${input.source}\0${input.targetName}`;
    let inspection = this.inFlight.get(key);
    if (!inspection) {
      inspection = this.inspect(input);
      this.inFlight.set(key, inspection);
      void inspection
        .finally(() => {
          if (this.inFlight.get(key) === inspection) this.inFlight.delete(key);
        })
        .catch(() => undefined);
    }

    const result = await inspection;
    return createConfiguredToolInventory({
      ...input,
      connections: this.serverManager.getClients(),
      instances: result.instances,
      inspection: result.inspection,
    });
  }

  private async inspect(input: RefreshConfiguredToolInventoryInput): Promise<InspectionResult> {
    if (isConfiguredServerTargetDisabled(input.config.disabled)) {
      return this.terminal('unavailable', 'target_disabled', false, []);
    }

    const initial = this.resolveCandidates(input.source, input.targetName);
    if (initial.activeInstanceIds.length === 0) {
      return this.terminal(
        'unavailable',
        input.source === 'mcpTemplates' ? 'no_active_instances' : 'target_disconnected',
        true,
        [],
      );
    }
    if (initial.unavailable.length > 0 || initial.candidates.length !== initial.activeInstanceIds.length) {
      return {
        inspection: {
          status: 'failed',
          reason: 'active_instance_unavailable',
          retryable: true,
          instances: [
            ...initial.candidates.map(({ instanceId }) => ({ instanceId, status: 'unavailable' as const })),
            ...initial.unavailable,
          ],
        },
        instances: initial.candidates.map(({ instanceId, connection }) => ({ instanceId, connection })),
      };
    }

    const settled = await Promise.allSettled(
      initial.candidates.map(async (candidate) => ({
        candidate,
        tools: (
          await collectConfiguredToolPages((cursor) =>
            candidate.connection.client.listTools(cursor === undefined ? undefined : { cursor }, {
              timeout: getRequestTimeout(candidate.connection.transport),
            }),
          )
        ).tools,
      })),
    );
    const failures = settled.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            {
              instanceId: initial.candidates[index]!.instanceId,
              status: 'failed' as const,
              error: errorMessage(result.reason),
            },
          ]
        : [],
    );
    if (failures.length > 0) {
      return {
        inspection: {
          status: 'failed',
          reason: 'inspection_failed',
          retryable: true,
          instances: [
            ...settled.flatMap((result, index) =>
              result.status === 'fulfilled'
                ? [{ instanceId: initial.candidates[index]!.instanceId, status: 'complete' as const }]
                : [],
            ),
            ...failures,
          ],
        },
        instances: initial.candidates.map(({ instanceId, connection }) => ({ instanceId, connection })),
      };
    }

    const current = this.resolveCandidates(input.source, input.targetName);
    if (!sameCandidates(initial, current)) {
      return this.terminal(
        'failed',
        'active_instances_changed',
        true,
        current.activeInstanceIds.map((instanceId) => ({
          instanceId,
          status: 'failed',
          error: 'Instance set changed',
        })),
        current.candidates,
      );
    }

    const complete = settled.map(
      (result) => (result as PromiseFulfilledResult<{ candidate: InspectionCandidate; tools: Tool[] }>).value,
    );
    publishCompleteConfiguredToolInspection({
      source: input.source,
      targetName: input.targetName,
      instances: complete.map(({ candidate, tools }) => ({
        instanceId: candidate.instanceId,
        connections: candidate.connections,
        tools,
      })),
    });

    return {
      inspection: {
        status: 'complete',
        retryable: false,
        instances: complete.map(({ candidate }) => ({ instanceId: candidate.instanceId, status: 'complete' })),
      },
      instances: complete.map(({ candidate }) => ({
        instanceId: candidate.instanceId,
        connection: candidate.connection,
      })),
    };
  }

  private resolveCandidates(source: ConfiguredToolTargetSource, targetName: string): CandidateResolution {
    const connections = this.serverManager.getClients();
    if (source === 'mcpServers') {
      const connection = connections.get(targetName);
      if (!connection || connection.name !== targetName || connection.status !== ClientStatus.Connected) {
        return { candidates: [], activeInstanceIds: [], unavailable: [] };
      }
      return {
        candidates: [{ instanceId: 'static', connection, connections: [connection] }],
        activeInstanceIds: ['static'],
        unavailable: [],
      };
    }

    const instances = this.serverManager
      .getTemplateServerManager()
      .getTemplateInstances(targetName)
      .filter((instance) => instance.referenceCount > 0);
    const candidates: InspectionCandidate[] = [];
    const unavailable: CandidateResolution['unavailable'] = [];
    for (const instance of instances) {
      const instanceConnections = Array.from(instance.outboundKeys)
        .map((key) => connections.get(key))
        .filter(
          (connection): connection is OutboundConnection =>
            connection !== undefined &&
            connection.name === targetName &&
            connection.client === instance.client &&
            connection.status === ClientStatus.Connected,
        );
      const uniqueConnections = Array.from(new Set(instanceConnections));
      if (instance.status !== 'active' || uniqueConnections.length === 0) {
        unavailable.push({
          instanceId: instance.id,
          status: 'unavailable',
          error:
            instance.status !== 'active' ? `Instance is ${instance.status}` : 'Connected outbound instance not found',
        });
        continue;
      }
      candidates.push({
        instanceId: instance.id,
        connection: uniqueConnections[0]!,
        connections: uniqueConnections,
      });
    }
    return {
      candidates,
      activeInstanceIds: instances.map((instance) => instance.id).sort(),
      unavailable,
    };
  }

  private terminal(
    status: 'unavailable' | 'failed',
    reason: string,
    retryable: boolean,
    instances: ConfiguredToolInspectionOutcome['instances'],
    candidates: InspectionCandidate[] = [],
  ): InspectionResult {
    return {
      inspection: { status, reason, retryable, instances },
      instances: candidates.map(({ instanceId, connection }) => ({ instanceId, connection })),
    };
  }
}

function sameCandidates(left: CandidateResolution, right: CandidateResolution): boolean {
  if (left.unavailable.length > 0 || right.unavailable.length > 0) return false;
  if (left.activeInstanceIds.join('\0') !== right.activeInstanceIds.join('\0')) return false;
  if (left.candidates.length !== right.candidates.length) return false;
  return left.candidates.every((candidate, index) => {
    const other = right.candidates[index];
    return (
      other?.instanceId === candidate.instanceId &&
      other.connection === candidate.connection &&
      other.connections.length === candidate.connections.length &&
      other.connections.every((connection, connectionIndex) => connection === candidate.connections[connectionIndex])
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
