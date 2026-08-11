import { ConfigManager } from '@src/config/configManager.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import {
  type ConfiguredServerInstructionTarget,
  hasConfiguredInstructionOverride,
  resolveEffectiveServerInstructions,
} from '@src/core/instructions/effectiveServerInstructions.js';
import type { InstructionRenderMetadata } from '@src/core/instructions/instructionAggregator.js';
import { instructionsRenderResponseSchema } from '@src/core/instructions/instructionsDistribution.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus, type OutboundConnection, type OutboundConnections } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import type { Request, RequestHandler, Response } from 'express';

import { buildFilterConfig } from './inspectHelpers.js';
import { ensureRequestContextInitialized } from './inspectRequestContext.js';
import { buildServerSummaries } from './inspectRoutes.js';

export function createInstructionsHandler(serverManager: ServerManager): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const activeAggregator = serverManager.getInstructionAggregator();
      if (!activeAggregator) {
        res.status(503).json({ error: 'Runtime instructions are not available' });
        return;
      }

      const filterConfig = buildFilterConfig(res);
      await ensureRequestContextInitialized(serverManager, req, res, filterConfig);

      const configManager = ConfigManager.getInstance();
      const declaredServers = configManager.loadDeclaredServerConfigs();
      const filteredConnections = FilteringService.getFilteredConnections(serverManager.getClients(), filterConfig);
      const summaries = await buildServerSummaries(
        filteredConnections,
        serverManager.getLazyLoadingOrchestrator()?.getToolRegistry(),
        serverManager.getLazyLoadingOrchestrator()?.getCapabilityAggregator(),
        serverManager.getServerRegistry(),
        activeAggregator,
        declaredServers,
        filterConfig,
        { includeTemplateInstances: false },
      );
      const runtimeConfiguration = configManager.getRuntimeInstructionConfiguration();

      const connections: OutboundConnections = new Map();
      const metadata: Record<string, InstructionRenderMetadata> = {};
      const representedServers = new Set<string>();
      const summariesByName = new Map(summaries.map((summary) => [summary.server, summary]));

      for (const [outboundKey, connection] of filteredConnections) {
        const summary = summariesByName.get(connection.name);
        if (!summary) continue;
        representedServers.add(summary.server);
        connections.set(outboundKey, connection);
        metadata[outboundKey] = createRenderMetadata(
          summary,
          inferTarget(summary.server, outboundKey, declaredServers),
          activeAggregator.getServerInstructions(summary.server),
          runtimeConfiguration,
        );
      }

      for (const summary of summaries) {
        if (representedServers.has(summary.server)) continue;
        const target = inferTarget(summary.server, summary.server, declaredServers);
        const upstreamInstructions = activeAggregator.getServerInstructions(summary.server);
        metadata[summary.server] = createRenderMetadata(summary, target, upstreamInstructions, runtimeConfiguration);

        const declaredConfig =
          target.source === 'mcpTemplates'
            ? declaredServers.templateServers[summary.server]
            : declaredServers.staticServers[summary.server];
        connections.set(summary.server, asRenderableConnection(summary.server, declaredConfig?.tags));
      }

      const rendered = activeAggregator.renderInstructions('cli', filterConfig, connections, metadata);
      const failure = activeAggregator.getRenderFailures().cli;
      const response = instructionsRenderResponseSchema.parse({
        rendered,
        templateIdentity: activeAggregator.getActiveInstructionTemplate() ?? 'default',
        fallback: Boolean(failure),
        fallbackReason: failure?.error,
      });
      res.json(response);
    } catch (error) {
      logger.error('API instructions handler error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

function asRenderableConnection(name: string, tags: string[] | undefined): OutboundConnection {
  return {
    name,
    status: ClientStatus.Connected,
    transport: { tags: tags ?? [] },
    client: {},
  } as OutboundConnection;
}

function inferTarget(
  serverName: string,
  outboundKey: string,
  declaredServers: ReturnType<ConfigManager['loadDeclaredServerConfigs']>,
): ConfiguredServerInstructionTarget {
  const isTemplateInstance = outboundKey !== serverName && outboundKey.startsWith(`${serverName}:`);
  return {
    source:
      isTemplateInstance || Object.hasOwn(declaredServers.templateServers, serverName) ? 'mcpTemplates' : 'mcpServers',
    name: serverName,
  };
}

function createRenderMetadata(
  summary: Awaited<ReturnType<typeof buildServerSummaries>>[number],
  target: ConfiguredServerInstructionTarget,
  upstreamInstructions: string | undefined,
  runtimeConfiguration: ReturnType<ConfigManager['getRuntimeInstructionConfiguration']>,
): InstructionRenderMetadata {
  const effectiveInstructions = resolveEffectiveServerInstructions({
    target,
    upstreamInstructions,
    configuredTargets: runtimeConfiguration.configuredTargets,
  });
  const hasOverride = hasConfiguredInstructionOverride(target, runtimeConfiguration.configuredTargets);
  const hasInstructions = hasOverride
    ? (effectiveInstructions?.length ?? 0) > 0
    : Boolean(effectiveInstructions?.trim());
  const note = hasInstructions
    ? undefined
    : summary.type === 'template' && !summary.available
      ? '(unavailable: template server could not be initialized with the current context)'
      : !summary.available
        ? '(unavailable: server is not currently connected)'
        : '(none provided)';

  return {
    type: summary.type,
    status: summary.status,
    available: summary.available,
    loadTracked: summary.loadTracked,
    toolCount: summary.toolCount,
    hasInstructions,
    note,
    summary: { ...summary, hasInstructions },
  };
}
