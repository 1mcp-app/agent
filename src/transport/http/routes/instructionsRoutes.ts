import { ConfigManager } from '@src/config/configManager.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import {
  type ConfiguredServerInstructionTarget,
  hasConfiguredInstructionOverride,
  resolveEffectiveServerInstructions,
} from '@src/core/instructions/effectiveServerInstructions.js';
import type { InstructionRenderMetadata } from '@src/core/instructions/instructionAggregator.js';
import { instructionsRenderResponseSchema } from '@src/core/instructions/instructionsDistribution.js';
import { createConnectionResolver } from '@src/core/server/connectionResolver.js';
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
      const sessionId = await ensureRequestContextInitialized(serverManager, req, res, filterConfig);

      const configManager = ConfigManager.getInstance();
      const declaredServers = configManager.loadDeclaredServerConfigs();
      const sessionConnections = createConnectionResolver(
        serverManager.getClients(),
        serverManager.getTemplateServerManager(),
      ).filterForSession(sessionId);
      const filteredConnections = FilteringService.getFilteredConnections(sessionConnections, filterConfig);
      const summaries = await buildServerSummaries(
        filteredConnections,
        serverManager.getLazyLoadingOrchestrator()?.getToolRegistry(),
        serverManager.getLazyLoadingOrchestrator()?.getCapabilityAggregator(),
        serverManager.getServerRegistry(),
        activeAggregator,
        declaredServers,
        filterConfig,
      );
      const runtimeConfiguration = configManager.getRuntimeInstructionConfiguration();

      const connections: OutboundConnections = new Map();
      const metadata: Record<string, InstructionRenderMetadata> = {};
      const presentations = new Map<string, ReturnType<typeof resolveInstructionPresentation>>();
      const representedServers = new Set<string>();
      const summariesByName = new Map(summaries.map((summary) => [summary.server, summary]));

      for (const [outboundKey, connection] of filteredConnections) {
        const summary = summariesByName.get(connection.name);
        if (!summary) continue;
        representedServers.add(summary.server);
        connections.set(outboundKey, connection);
        const target = inferTarget(summary.server, outboundKey, declaredServers);
        presentations.set(
          `${target.source}:${target.name}`,
          resolveInstructionPresentation(
            summary,
            target,
            activeAggregator.getEffectiveServerInstructions(outboundKey, summary.server),
            runtimeConfiguration,
          ),
        );
        metadata[outboundKey] = createRenderMetadata(
          summary,
          target,
          activeAggregator.getServerInstructions(summary.server),
          runtimeConfiguration,
          false,
        );
      }

      for (const summary of summaries) {
        if (representedServers.has(summary.server)) continue;
        const target = inferTarget(summary.server, summary.server, declaredServers, summary.type === 'template');
        const upstreamInstructions =
          target.source === 'mcpTemplates' ? undefined : activeAggregator.getServerInstructions(summary.server);
        metadata[summary.server] = createRenderMetadata(
          summary,
          target,
          upstreamInstructions,
          runtimeConfiguration,
          true,
        );

        const declaredConfig =
          target.source === 'mcpTemplates'
            ? declaredServers.templateServers[summary.server]
            : declaredServers.staticServers[summary.server];
        connections.set(summary.server, asRenderableConnection(summary.server, declaredConfig?.tags));
      }

      const rendered = activeAggregator.renderInstructions('cli', filterConfig, connections, metadata);
      const failure = activeAggregator.getRenderFailures().cli;
      const templateIdentity = activeAggregator.getActiveInstructionTemplate() ?? 'default';
      const response = instructionsRenderResponseSchema.parse({
        rendered,
        templateIdentity,
        fallback: Boolean(failure),
        fallbackReason: failure ? 'managed_template_render_failed' : undefined,
        formatting:
          templateIdentity === 'default' || failure
            ? createFormattingPayload(summaries, declaredServers, presentations, activeAggregator, runtimeConfiguration)
            : undefined,
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
  preferDeclaredTemplate = false,
): ConfiguredServerInstructionTarget {
  const isTemplateInstance = outboundKey !== serverName && outboundKey.startsWith(`${serverName}:`);
  const hasStaticTarget = Object.hasOwn(declaredServers.staticServers, serverName);
  return {
    source:
      isTemplateInstance ||
      (Object.hasOwn(declaredServers.templateServers, serverName) && (preferDeclaredTemplate || !hasStaticTarget))
        ? 'mcpTemplates'
        : 'mcpServers',
    name: serverName,
  };
}

function createRenderMetadata(
  summary: Awaited<ReturnType<typeof buildServerSummaries>>[number],
  target: ConfiguredServerInstructionTarget,
  upstreamInstructions: string | undefined,
  runtimeConfiguration: ReturnType<ConfigManager['getRuntimeInstructionConfiguration']>,
  includeUpstreamInstructions: boolean,
): InstructionRenderMetadata {
  const presentation = resolveInstructionPresentation(summary, target, upstreamInstructions, runtimeConfiguration);

  return {
    type: summary.type,
    status: summary.status,
    available: summary.available,
    loadTracked: summary.loadTracked,
    toolCount: summary.toolCount,
    hasInstructions: presentation.hasInstructions,
    note: presentation.note,
    summary: { ...summary, hasInstructions: presentation.hasInstructions },
    target,
    ...(includeUpstreamInstructions ? { upstreamInstructions } : {}),
  };
}

function resolveInstructionPresentation(
  summary: Awaited<ReturnType<typeof buildServerSummaries>>[number],
  target: ConfiguredServerInstructionTarget,
  upstreamInstructions: string | undefined,
  runtimeConfiguration: ReturnType<ConfigManager['getRuntimeInstructionConfiguration']>,
): { instructions: string | undefined; hasInstructions: boolean; note?: string } {
  const instructions = resolveEffectiveServerInstructions({
    target,
    upstreamInstructions,
    configuredTargets: runtimeConfiguration.configuredTargets,
  });
  const hasOverride = hasConfiguredInstructionOverride(target, runtimeConfiguration.configuredTargets);
  const hasInstructions = hasOverride ? (instructions?.length ?? 0) > 0 : Boolean(instructions?.trim());
  const note = hasInstructions
    ? undefined
    : summary.type === 'template' && !summary.available
      ? '(unavailable: template server could not be initialized with the current context)'
      : !summary.available
        ? '(unavailable: server is not currently connected)'
        : '(none provided)';

  return { instructions, hasInstructions, note };
}

function createFormattingPayload(
  summaries: Awaited<ReturnType<typeof buildServerSummaries>>,
  declaredServers: ReturnType<ConfigManager['loadDeclaredServerConfigs']>,
  presentations: ReadonlyMap<string, ReturnType<typeof resolveInstructionPresentation>>,
  activeAggregator: NonNullable<ReturnType<ServerManager['getInstructionAggregator']>>,
  runtimeConfiguration: ReturnType<ConfigManager['getRuntimeInstructionConfiguration']>,
) {
  const entries = summaries.map((summary) => {
    const target = inferTarget(summary.server, summary.server, declaredServers, summary.type === 'template');
    const presentation =
      presentations.get(`${target.source}:${target.name}`) ??
      resolveInstructionPresentation(
        summary,
        target,
        activeAggregator.getServerInstructions(summary.server),
        runtimeConfiguration,
      );
    return {
      summary,
      presentation,
    };
  });

  return {
    servers: entries.map(({ summary, presentation }) => ({
      ...summary,
      hasInstructions: presentation.hasInstructions,
    })),
    details: entries.map(({ summary, presentation }) => ({
      ...summary,
      hasInstructions: presentation.hasInstructions,
      instructions: presentation.hasInstructions ? presentation.instructions : undefined,
      note: presentation.note,
    })),
  };
}
