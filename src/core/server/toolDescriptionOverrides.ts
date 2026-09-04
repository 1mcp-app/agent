import { MCP_URI_SEPARATOR } from '@src/constants.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import type { Tool } from '@src/sdk/contracts/index.js';

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
  return overrides[logicalName] ?? overrides[toolName.trim()] ?? upstreamDescription;
}

export function applyEffectiveToolDescription<T extends Pick<Tool, 'name'> & { description?: string }>(
  tool: T,
  serverConfig: Pick<MCPServerParams, 'toolDescriptionOverrides'> | undefined,
  serverName: string,
): T {
  const description = getEffectiveToolDescription(serverConfig, serverName, tool.name, tool.description);
  if (description === tool.description) return tool;
  if (description === undefined) {
    const { description: _description, ...withoutDescription } = tool;
    return withoutDescription as T;
  }
  return { ...tool, description };
}

export function withToolDescriptionOverride(
  serverConfig: MCPServerParams,
  toolName: string,
  description: string | undefined,
  serverName?: string,
): MCPServerParams {
  const overrides = getToolDescriptionOverrides(serverConfig);
  const name = serverName ? logicalToolName(serverName, toolName) : toolName.trim();
  const normalizedDescription = description?.trim() ?? '';

  if (name) {
    if (normalizedDescription) overrides[name] = normalizedDescription;
    else delete overrides[name];
  }

  const nextConfig = { ...serverConfig };
  if (Object.keys(overrides).length === 0) delete nextConfig.toolDescriptionOverrides;
  else nextConfig.toolDescriptionOverrides = overrides;
  return nextConfig;
}
