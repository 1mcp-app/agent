import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { readPublicCapabilityRoute } from '@src/core/capabilities/catalogGeneration.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import type { Tool } from '@src/sdk/contracts/index.js';
import {
  buildPublicToolName,
  getSourceToolConfigReferences,
  matchesToolConfigReference,
} from '@src/utils/core/toolNames.js';

function logicalToolName(serverName: string, toolName: string): string {
  const normalized = toolName.trim();
  const prefix = `${serverName}${MCP_URI_SEPARATOR}`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length).trim() : normalized;
}

export function getToolDescriptionOverrides(
  serverConfig?: Pick<MCPServerParams, 'toolDescriptionOverrides'>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(serverConfig?.toolDescriptionOverrides ?? {})
      .map(([name, description]) => [name.trim(), description.trim()] as const)
      .filter(([name, description]) => name.length > 0 && description.length > 0),
  );
}

export function getEffectiveToolDescription(
  serverConfig: Pick<MCPServerParams, 'toolDescriptionOverrides'> | undefined,
  serverName: string,
  toolName: string,
  upstreamDescription?: string,
): string | undefined {
  const overrides = getToolDescriptionOverrides(serverConfig);
  const logicalName = logicalToolName(serverName, toolName);
  return (
    overrides[logicalName] ??
    overrides[toolName.trim()] ??
    overrides[buildPublicToolName(serverName, toolName)] ??
    upstreamDescription
  );
}

export function applyEffectiveToolDescription<T extends Pick<Tool, 'name'> & { description?: string }>(
  tool: T,
  serverConfig: Pick<MCPServerParams, 'toolDescriptionOverrides'> | undefined,
  serverName: string,
): T {
  const route = readPublicCapabilityRoute(tool);
  const description =
    route?.kind === 'tools' && route.server === serverName
      ? (getSourceToolDescription(serverConfig, serverName, route.upstreamIdentity) ?? tool.description)
      : getEffectiveToolDescription(serverConfig, serverName, tool.name, tool.description);
  if (description === tool.description) return tool;
  if (description === undefined) {
    const { description: _description, ...withoutDescription } = tool;
    return withoutDescription as T;
  }
  return { ...tool, description };
}

export function getSourceToolDescription(
  serverConfig: Pick<MCPServerParams, 'toolDescriptionOverrides'> | undefined,
  server: string,
  upstreamIdentity: string,
): string | undefined {
  const overrides = getToolDescriptionOverrides(serverConfig);
  for (const reference of getSourceToolConfigReferences(server, upstreamIdentity)) {
    if (overrides[reference] !== undefined) return overrides[reference];
  }
  return undefined;
}

/** Apply configuration to an exact source name, including names containing the routing separator. */
export function applySourceToolDescription<T extends Pick<Tool, 'name'> & { description?: string }>(
  tool: T,
  serverConfig: Pick<MCPServerParams, 'toolDescriptionOverrides'> | undefined,
  server: string,
): T {
  const description = getSourceToolDescription(serverConfig, server, tool.name);
  return description === undefined || description === tool.description ? tool : { ...tool, description };
}

export function withToolDescriptionOverride(
  serverConfig: MCPServerParams,
  toolName: string,
  description: string | undefined,
  serverName?: string,
): MCPServerParams {
  const overrides = getToolDescriptionOverrides(serverConfig);
  const name = toolName.trim();
  const normalizedDescription = description?.trim() ?? '';

  for (const configuredName of Object.keys(overrides)) {
    if (configuredName === name) {
      delete overrides[configuredName];
      continue;
    }
    if (!serverName) continue;
    if (matchesToolConfigReference(serverName, name, configuredName)) delete overrides[configuredName];
  }

  if (name) {
    if (normalizedDescription) overrides[name] = normalizedDescription;
    else delete overrides[name];
  }

  const nextConfig = { ...serverConfig };
  if (Object.keys(overrides).length === 0) delete nextConfig.toolDescriptionOverrides;
  else nextConfig.toolDescriptionOverrides = overrides;
  return nextConfig;
}
