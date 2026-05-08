import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { MCP_URI_SEPARATOR } from '@src/constants.js';
import type { MCPServerParams } from '@src/core/types/index.js';

function normalizeToolName(toolName: string): string {
  return toolName.trim();
}

function getRawToolName(logicalServerName: string, toolName: string): string {
  const normalizedToolName = normalizeToolName(toolName);
  const qualifiedPrefix = `${logicalServerName}${MCP_URI_SEPARATOR}`;

  if (normalizedToolName.startsWith(qualifiedPrefix)) {
    return normalizedToolName.slice(qualifiedPrefix.length).trim();
  }

  return normalizedToolName;
}

function getComparableToolNames(logicalServerName: string, toolName: string): string[] {
  const normalizedToolName = normalizeToolName(toolName);
  if (!normalizedToolName) {
    return [];
  }

  const names = new Set<string>([normalizedToolName]);
  const rawToolName = getRawToolName(logicalServerName, normalizedToolName);
  if (rawToolName) {
    names.add(rawToolName);
    names.add(`${logicalServerName}${MCP_URI_SEPARATOR}${rawToolName}`);
  }

  return Array.from(names);
}

export function getDisabledToolMessage(logicalServerName: string, toolName: string): string {
  const displayToolName = getRawToolName(logicalServerName, toolName);
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

  const disabledTools = new Set(getDisabledToolsForServer(serverConfigs, logicalServerName));
  return getComparableToolNames(logicalServerName, normalizedToolName).some((toolNameVariant) =>
    disabledTools.has(toolNameVariant),
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

export function filterDisabledTools<T extends Pick<Tool, 'name'>>(
  tools: T[],
  serverConfigs: Record<string, MCPServerParams>,
  logicalServerName: string,
): T[] {
  if (getDisabledToolsForServer(serverConfigs, logicalServerName).length === 0) {
    return tools;
  }

  return tools.filter((tool) => !isToolDisabled(serverConfigs, logicalServerName, tool.name));
}

export function withToolDisabledState(
  serverConfig: MCPServerParams,
  toolName: string,
  disabled: boolean,
  logicalServerName?: string,
): MCPServerParams {
  const normalizedToolName = normalizeToolName(toolName);
  const comparableNames = logicalServerName
    ? new Set(getComparableToolNames(logicalServerName, normalizedToolName))
    : new Set([normalizedToolName]);
  const disabledTools = new Set(
    getDisabledTools(serverConfig).filter((disabledTool) => !comparableNames.has(disabledTool)),
  );

  if (disabled && normalizedToolName) {
    disabledTools.add(logicalServerName ? getRawToolName(logicalServerName, normalizedToolName) : normalizedToolName);
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
