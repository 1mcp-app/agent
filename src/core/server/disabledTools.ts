import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { MCPServerParams } from '@src/core/types/index.js';

function normalizeToolName(toolName: string): string {
  return toolName.trim();
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

  return getDisabledToolsForServer(serverConfigs, logicalServerName).includes(normalizedToolName);
}

export function filterDisabledTools<T extends Pick<Tool, 'name'>>(
  tools: T[],
  serverConfigs: Record<string, MCPServerParams>,
  logicalServerName: string,
): T[] {
  const disabledTools = new Set(getDisabledToolsForServer(serverConfigs, logicalServerName));
  if (disabledTools.size === 0) {
    return tools;
  }

  return tools.filter((tool) => !disabledTools.has(normalizeToolName(tool.name)));
}

export function withToolDisabledState(
  serverConfig: MCPServerParams,
  toolName: string,
  disabled: boolean,
): MCPServerParams {
  const normalizedToolName = normalizeToolName(toolName);
  const disabledTools = new Set(getDisabledTools(serverConfig));

  if (disabled && normalizedToolName) {
    disabledTools.add(normalizedToolName);
  } else {
    disabledTools.delete(normalizedToolName);
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
