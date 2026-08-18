import { createHash } from 'node:crypto';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { TokenEstimationService } from '@src/application/services/tokenEstimationService.js';
import {
  publishCompleteConfiguredToolInspection,
  readCompleteConfiguredToolTargetSnapshot,
  readConfiguredToolSnapshot,
} from '@src/core/capabilities/configuredToolSnapshot.js';
import { getDisabledTools, getLogicalToolName, isToolDisabled } from '@src/core/server/disabledTools.js';
import {
  applyEffectiveToolDescription,
  getToolDescriptionOverrides,
} from '@src/core/server/toolDescriptionOverrides.js';
import {
  ClientStatus,
  type MCPServerParams,
  type OutboundConnection,
  type OutboundConnections,
} from '@src/core/types/index.js';
import { isConfiguredServerTargetDisabled } from '@src/domains/config-change/configChange.js';

export type ConfiguredToolTargetSource = 'mcpServers' | 'mcpTemplates';

export type ConfiguredToolInspectionStatus = 'unavailable' | 'in_progress' | 'failed' | 'complete';

export interface ConfiguredToolInspectionFact {
  instanceId: string;
  status: 'unavailable' | 'failed' | 'complete';
  error?: string;
}

export interface ConfiguredToolInspectionOutcome {
  status: ConfiguredToolInspectionStatus;
  reason?: string;
  retryable: boolean;
  instances: ConfiguredToolInspectionFact[];
}

export interface ConfiguredToolInventoryRow {
  name: string;
  upstreamDescription?: string;
  effectiveDescription?: string;
  descriptionOverride?: string;
  descriptionOverridden: boolean;
  enabled: boolean;
  observed: boolean;
  stale?: boolean;
  unresolved: boolean;
  observedInstanceCount: number;
  activeInstanceCount: number;
  observedInSomeInstances: boolean;
  approximateTokens: number;
}

export interface ConfiguredToolInventory {
  targetName: string;
  source: ConfiguredToolTargetSource;
  targetEnabled: boolean;
  freshness: 'live' | 'unavailable';
  model: string;
  generation: string;
  activeInstanceCount: number;
  inspection?: ConfiguredToolInspectionOutcome;
  rows: ConfiguredToolInventoryRow[];
  counts: { observed: number; enabled: number; disabled: number; unresolved: number };
  approximateTokens: { enabled: number; allObserved: number; savings: number };
}

export async function createConfiguredToolInventory(input: {
  targetName: string;
  source: ConfiguredToolTargetSource;
  config: MCPServerParams;
  connections: OutboundConnections;
  model?: string;
  instances?: Array<{ instanceId: string; connection: OutboundConnection }>;
  inspection?: ConfiguredToolInspectionOutcome;
}): Promise<ConfiguredToolInventory> {
  const model = input.model?.trim() || 'gpt-4o';
  const matchingConnections = input.instances
    ? input.instances.map(({ instanceId, connection }) => [instanceId, connection] as const)
    : Array.from(input.connections.entries()).filter(([connectionKey, connection]) => {
        if (connection.status !== ClientStatus.Connected || connection.name !== input.targetName) return false;
        return input.source === 'mcpServers' ? connectionKey === input.targetName : connectionKey !== input.targetName;
      });
  const activeInstanceCount = input.inspection?.instances.length ?? matchingConnections.length;
  const toolsByName = new Map<string, { tool: Tool; instances: Set<string>; live: boolean }>();
  const canUseLiveSnapshots = input.inspection?.status !== 'failed' && input.inspection?.status !== 'unavailable';
  const currentInstanceSnapshots = (canUseLiveSnapshots ? matchingConnections : [])
    .map(([instanceId, connection]) => ({ instanceId, connection, tools: readConfiguredToolSnapshot(connection) }))
    .filter(
      (instance): instance is { instanceId: string; connection: OutboundConnection; tools: readonly Tool[] } =>
        instance.tools !== undefined,
    );
  const successfulInstances = currentInstanceSnapshots.length;

  for (const { instanceId, tools } of currentInstanceSnapshots) {
    for (const tool of tools) {
      const existing = toolsByName.get(tool.name);
      if (existing) existing.instances.add(instanceId);
      else toolsByName.set(tool.name, { tool, instances: new Set([instanceId]), live: true });
    }
  }
  let retainedSnapshot = readCompleteConfiguredToolTargetSnapshot(input.source, input.targetName);
  if (
    !input.inspection &&
    activeInstanceCount > 0 &&
    successfulInstances === activeInstanceCount &&
    !snapshotMatchesInstances(retainedSnapshot, currentInstanceSnapshots)
  ) {
    publishCompleteConfiguredToolInspection({
      source: input.source,
      targetName: input.targetName,
      instances: currentInstanceSnapshots.map(({ instanceId, connection, tools }) => ({
        instanceId,
        connections: [connection],
        tools,
      })),
    });
    retainedSnapshot = readCompleteConfiguredToolTargetSnapshot(input.source, input.targetName);
  }
  for (const instance of retainedSnapshot?.instances ?? []) {
    for (const tool of instance.tools) {
      if (!toolsByName.has(tool.name)) toolsByName.set(tool.name, { tool, instances: new Set(), live: false });
    }
  }

  const overrides = getToolDescriptionOverrides(input.config);
  const configuredNames = new Set([
    ...getDisabledTools(input.config).map((name) => getLogicalToolName(input.targetName, name)),
    ...Object.keys(overrides).map((name) => getLogicalToolName(input.targetName, name)),
  ]);
  const allNames = new Set([...toolsByName.keys(), ...configuredNames]);
  const tokenEstimator = new TokenEstimationService(model);
  const serverConfigs = { [input.targetName]: input.config };

  let rows: ConfiguredToolInventoryRow[];
  try {
    rows = Array.from(allNames)
      .sort((left, right) => left.localeCompare(right))
      .map((name): ConfiguredToolInventoryRow => {
        const observed = toolsByName.get(name);
        const effectiveTool = observed
          ? applyEffectiveToolDescription(observed.tool, input.config, input.targetName)
          : undefined;
        const approximateTokens = effectiveTool
          ? (tokenEstimator.estimateServerTokens(input.targetName, [effectiveTool], [], [], true).breakdown.tools[0]
              ?.tokens ?? 0)
          : 0;
        const observedInstanceCount = observed?.instances.size ?? 0;
        const descriptionOverride = overrides[name];
        return {
          name,
          ...(observed?.tool.description !== undefined ? { upstreamDescription: observed.tool.description } : {}),
          ...(effectiveTool?.description !== undefined
            ? { effectiveDescription: effectiveTool.description }
            : descriptionOverride !== undefined
              ? { effectiveDescription: descriptionOverride }
              : {}),
          ...(descriptionOverride !== undefined ? { descriptionOverride } : {}),
          descriptionOverridden: descriptionOverride !== undefined,
          enabled: !isToolDisabled(serverConfigs, input.targetName, name),
          observed: observed?.live ?? false,
          stale: observed !== undefined && !observed.live,
          unresolved: observed === undefined,
          observedInstanceCount,
          activeInstanceCount,
          observedInSomeInstances:
            successfulInstances === activeInstanceCount &&
            observedInstanceCount > 0 &&
            observedInstanceCount < activeInstanceCount,
          approximateTokens,
        };
      });
  } finally {
    tokenEstimator.dispose();
  }

  const allObservedTokens = rows.reduce((total, row) => total + row.approximateTokens, 0);
  const enabledTokens = rows.reduce((total, row) => total + (row.enabled ? row.approximateTokens : 0), 0);
  const generationInstances =
    retainedSnapshot &&
    (input.inspection?.status === 'failed' ||
      input.inspection?.status === 'unavailable' ||
      snapshotMatchesInstances(retainedSnapshot, currentInstanceSnapshots))
      ? (retainedSnapshot?.instances ?? [])
      : currentInstanceSnapshots;
  const generation = createHash('sha256')
    .update(
      JSON.stringify({
        targetName: input.targetName,
        source: input.source,
        instances: generationInstances
          .map(({ instanceId, tools }) => ({
            instanceId,
            tools: tools
              .map((tool) => normalizeGenerationValue(tool))
              .sort((left, right) =>
                String((left as { name?: unknown }).name).localeCompare(String((right as { name?: unknown }).name)),
              ),
          }))
          .sort((left, right) => left.instanceId.localeCompare(right.instanceId)),
      }),
    )
    .digest('base64url');

  const live = activeInstanceCount > 0 && successfulInstances === activeInstanceCount;
  const inspection =
    input.inspection ??
    (live
      ? {
          status: 'complete' as const,
          retryable: false,
          instances: matchingConnections.map(([instanceId]) => ({ instanceId, status: 'complete' as const })),
        }
      : {
          status: 'unavailable' as const,
          reason: isConfiguredServerTargetDisabled(input.config.disabled) ? 'target_disabled' : 'snapshot_unavailable',
          retryable: !isConfiguredServerTargetDisabled(input.config.disabled),
          instances: matchingConnections.map(([instanceId]) => ({ instanceId, status: 'unavailable' as const })),
        });

  return {
    targetName: input.targetName,
    source: input.source,
    targetEnabled: !isConfiguredServerTargetDisabled(input.config.disabled),
    freshness: live && inspection.status === 'complete' ? 'live' : 'unavailable',
    model,
    generation,
    activeInstanceCount,
    inspection,
    rows,
    counts: {
      observed: rows.filter((row) => row.observed).length,
      enabled: rows.filter((row) => row.enabled).length,
      disabled: rows.filter((row) => !row.enabled).length,
      unresolved: rows.filter((row) => row.unresolved).length,
    },
    approximateTokens: {
      enabled: enabledTokens,
      allObserved: allObservedTokens,
      savings: allObservedTokens - enabledTokens,
    },
  };
}

function snapshotMatchesInstances(
  snapshot: ReturnType<typeof readCompleteConfiguredToolTargetSnapshot>,
  instances: ReadonlyArray<{ instanceId: string; tools: readonly Tool[] }>,
): boolean {
  if (!snapshot) return false;
  return (
    JSON.stringify(normalizeInstanceLayout(snapshot.instances)) === JSON.stringify(normalizeInstanceLayout(instances))
  );
}

function normalizeInstanceLayout(instances: ReadonlyArray<{ instanceId: string; tools: readonly Tool[] }>): unknown {
  return instances
    .map(({ instanceId, tools }) => ({
      instanceId,
      tools: tools
        .map((tool) => normalizeGenerationValue(tool))
        .sort((left, right) =>
          String((left as { name?: unknown }).name).localeCompare(String((right as { name?: unknown }).name)),
        ),
    }))
    .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
}

function normalizeGenerationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeGenerationValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeGenerationValue(nested)]),
  );
}
