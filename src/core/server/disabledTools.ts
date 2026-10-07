import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { readPublicCapabilityRoute } from '@src/core/capabilities/catalogGeneration.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import type { Tool } from '@src/sdk/contracts/index.js';
import { getSourceToolConfigReferences, matchesToolConfigReference } from '@src/utils/core/toolNames.js';

function normalizeToolName(toolName: string): string {
  return toolName.trim();
}

export function getLogicalToolName(logicalServerName: string, toolName: string): string {
  const normalizedToolName = normalizeToolName(toolName);
  const qualifiedPrefix = `${logicalServerName}${MCP_URI_SEPARATOR}`;

  if (normalizedToolName.startsWith(qualifiedPrefix)) {
    return normalizedToolName.slice(qualifiedPrefix.length).trim();
  }

  return normalizedToolName;
}

export function getDisabledToolMessage(logicalServerName: string, toolName: string): string {
  const displayToolName = normalizeToolName(toolName);
  return `Tool is disabled: ${logicalServerName}:${displayToolName}. Use '1mcp mcp tools enable ${logicalServerName} ${displayToolName}' to re-enable it.`;
}

export function getDisabledTools(serverConfig?: Pick<MCPServerParams, 'disabledTools'>): string[] {
  if (!serverConfig?.disabledTools) {
    return [];
  }

  const seen = new Set<string>();
  const disabledTools: string[] = [];

  for (const rawToolName of serverConfig.disabledTools) {
    const toolName = normalizeToolName(rawToolName);
    if (!toolName || seen.has(toolName)) {
      continue;
    }

    seen.add(toolName);
    disabledTools.push(toolName);
  }

  return disabledTools;
}

export function normalizeDisabledToolsForServer(_logicalServerName: string, toolNames: readonly string[]): string[] {
  return Array.from(new Set(toolNames.map(normalizeToolName).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function getDisabledToolsForServer(
  serverConfigs: Record<string, MCPServerParams>,
  logicalServerName: string,
): string[] {
  return getDisabledTools(serverConfigs[logicalServerName]);
}

export function isToolDisabled(
  serverConfigs: Record<string, MCPServerParams>,
  logicalServerName: string,
  toolName: string,
): boolean {
  const normalizedToolName = normalizeToolName(toolName);
  if (!normalizedToolName) {
    return false;
  }

  return getDisabledToolsForServer(serverConfigs, logicalServerName).some((disabledTool) =>
    matchesToolConfigReference(logicalServerName, normalizedToolName, disabledTool),
  );
}

export function getDisabledToolError(
  serverConfigs: Record<string, MCPServerParams>,
  logicalServerName: string,
  toolName: string,
): { type: 'not_found'; message: string } | undefined {
  if (!isToolDisabled(serverConfigs, logicalServerName, toolName)) {
    return undefined;
  }

  return {
    type: 'not_found',
    message: getDisabledToolMessage(logicalServerName, toolName),
  };
}

/** Match a catalog source identity without interpreting its display-like text. */
export function isSourceToolDisabled(
  serverConfigs: Record<string, MCPServerParams>,
  server: string,
  upstreamIdentity: string,
): boolean {
  const disabled = getDisabledToolsForServer(serverConfigs, server);
  return getSourceToolConfigReferences(server, upstreamIdentity).some((reference) => disabled.includes(reference));
}

export function getDisabledSourceToolError(
  serverConfigs: Record<string, MCPServerParams>,
  server: string,
  upstreamIdentity: string,
): { type: 'not_found'; message: string } | undefined {
  if (!isSourceToolDisabled(serverConfigs, server, upstreamIdentity)) return undefined;
  return {
    type: 'not_found',
    message: `Tool is disabled: ${server}:${upstreamIdentity}. Use '1mcp mcp tools enable ${server} ${upstreamIdentity}' to re-enable it.`,
  };
}

export function filterDisabledTools<T extends Pick<Tool, 'name'>>(
  tools: T[],
  serverConfigs: Record<string, MCPServerParams>,
  logicalServerName: string,
): T[] {
  if (getDisabledToolsForServer(serverConfigs, logicalServerName).length === 0) {
    return tools;
  }

  return tools.filter((tool) => {
    const route = readPublicCapabilityRoute(tool);
    if (route?.kind === 'tools' && route.server === logicalServerName)
      return !isSourceToolDisabled(serverConfigs, logicalServerName, route.upstreamIdentity);
    return !isToolDisabled(serverConfigs, logicalServerName, tool.name);
  });
}

export function withToolDisabledState(
  serverConfig: MCPServerParams,
  toolName: string,
  disabled: boolean,
  logicalServerName?: string,
): MCPServerParams {
  const normalizedToolName = normalizeToolName(toolName);
  const disabledTools = new Set(
    getDisabledTools(serverConfig).filter((disabledTool) =>
      logicalServerName
        ? !matchesToolConfigReference(logicalServerName, normalizedToolName, disabledTool)
        : disabledTool !== normalizedToolName,
    ),
  );

  if (disabled && normalizedToolName) {
    // A config-only caller has no source route from which to recover a compact identity.
    disabledTools.add(normalizedToolName);
  }

  const nextDisabledTools = Array.from(disabledTools).sort((left, right) => left.localeCompare(right));
  const nextConfig: MCPServerParams = {
    ...serverConfig,
  };

  if (nextDisabledTools.length === 0) {
    delete nextConfig.disabledTools;
  } else {
    nextConfig.disabledTools = nextDisabledTools;
  }

  return nextConfig;
}
