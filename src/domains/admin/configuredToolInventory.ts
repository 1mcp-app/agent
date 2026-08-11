import { createHash } from 'node:crypto';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { TokenEstimationService } from '@src/application/services/tokenEstimationService.js';
import {
  publishLastConfiguredToolSnapshot,
  readConfiguredToolSnapshot,
  readLastConfiguredToolSnapshot,
} from '@src/core/capabilities/configuredToolSnapshot.js';
import { getDisabledTools, isToolDisabled } from '@src/core/server/disabledTools.js';
import {
  applyEffectiveToolDescription,
  getToolDescriptionOverrides,
} from '@src/core/server/toolDescriptionOverrides.js';
import { ClientStatus, type MCPServerParams, type OutboundConnections } from '@src/core/types/index.js';
import { isConfiguredServerTargetDisabled } from '@src/domains/config-change/configChange.js';

export type ConfiguredToolTargetSource = 'mcpServers' | 'mcpTemplates';

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
}): Promise<ConfiguredToolInventory> {
  const model = input.model?.trim() || 'gpt-4o';
  const matchingConnections = Array.from(input.connections.entries()).filter(([, connection]) => {
    const logicalName = connection.name;
    return connection.status === ClientStatus.Connected && logicalName === input.targetName;
  });
  const activeInstanceCount = matchingConnections.length;
  const toolsByName = new Map<string, { tool: Tool; instances: Set<string>; live: boolean }>();
  let successfulInstances = 0;
  const snapshotAvailability: Array<{ connectionKey: string; available: boolean }> = [];

  for (const [connectionKey, connection] of matchingConnections) {
    const tools = readConfiguredToolSnapshot(connection);
    snapshotAvailability.push({ connectionKey, available: tools !== undefined });
    if (!tools) continue;
    successfulInstances += 1;
    for (const tool of tools) {
      const existing = toolsByName.get(tool.name);
      if (existing) existing.instances.add(connectionKey);
      else toolsByName.set(tool.name, { tool, instances: new Set([connectionKey]), live: true });
    }
  }
  if (activeInstanceCount > 0 && successfulInstances === activeInstanceCount) {
    publishLastConfiguredToolSnapshot(
      input.targetName,
      Array.from(toolsByName.values(), ({ tool }) => tool),
    );
  }
  for (const tool of readLastConfiguredToolSnapshot(input.targetName)) {
    if (!toolsByName.has(tool.name)) toolsByName.set(tool.name, { tool, instances: new Set(), live: false });
  }

  const overrides = getToolDescriptionOverrides(input.config);
  const configuredNames = new Set([...getDisabledTools(input.config), ...Object.keys(overrides)]);
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
        return {
          name,
          ...(observed?.tool.description !== undefined ? { upstreamDescription: observed.tool.description } : {}),
          ...(effectiveTool?.description !== undefined
            ? { effectiveDescription: effectiveTool.description }
            : overrides[name]
              ? { effectiveDescription: overrides[name] }
              : {}),
          ...(overrides[name] ? { descriptionOverride: overrides[name] } : {}),
          descriptionOverridden: overrides[name] !== undefined,
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
  const generation = createHash('sha256')
    .update(
      JSON.stringify({
        targetName: input.targetName,
        source: input.source,
        instances: snapshotAvailability.sort((left, right) => left.connectionKey.localeCompare(right.connectionKey)),
        tools: Array.from(toolsByName.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, observed]) => ({
            name,
            tool: normalizeGenerationValue(observed.tool),
            instances: Array.from(observed.instances).sort(),
          })),
      }),
    )
    .digest('base64url');

  return {
    targetName: input.targetName,
    source: input.source,
    targetEnabled: !isConfiguredServerTargetDisabled(input.config.disabled),
    freshness: activeInstanceCount > 0 && successfulInstances === activeInstanceCount ? 'live' : 'unavailable',
    model,
    generation,
    activeInstanceCount,
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

function normalizeGenerationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeGenerationValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeGenerationValue(nested)]),
  );
}
