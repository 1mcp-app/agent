import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { InboundConnectionConfig } from '@src/core/types/index.js';
import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import {
  getPresetName,
  getTagExpression,
  getTagFilterMode,
  getTagQuery,
  getValidatedTags,
} from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import { buildUri, parseUri } from '@src/utils/core/parsing.js';
import { normalizeTag } from '@src/utils/validation/sanitization.js';

import { Response } from 'express';

// ---- Response payload types ----

export interface ServerSummary {
  server: string;
  type: string;
  status: string;
  available: boolean;
  toolCount: number;
  hasInstructions: boolean;
}

export interface InspectServersPayload {
  kind: 'servers';
  servers: ServerSummary[];
}

export interface InspectServerPayload {
  kind: 'server';
  server: string;
  type: string;
  status: string;
  available: boolean;
  instructions: string | null;
  tools: Array<{
    tool: string;
    qualifiedName: string;
    description: string;
    requiredArgs: number;
    optionalArgs: number;
  }>;
  totalTools: number;
  hasMore: boolean;
  nextCursor?: string;
}

export interface InspectToolPayload {
  kind: 'tool';
  server: string;
  tool: string;
  qualifiedName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export type ToolSummary = InspectServerPayload['tools'][number];

// ---- Helpers ----

export function buildFilterConfig(res: Response): InboundConnectionConfig {
  return {
    tags: getValidatedTags(res),
    tagExpression: getTagExpression(res),
    tagQuery: getTagQuery(res),
    tagFilterMode: getTagFilterMode(res),
    presetName: getPresetName(res),
  };
}

export function parseTarget(
  raw: string,
):
  | { kind: 'server'; serverName: string }
  | { kind: 'tool'; serverName: string; toolName: string; qualifiedName: string }
  | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.includes('/')) {
    return { kind: 'server', serverName: trimmed };
  }
  const parts = trimmed.split('/');
  if (parts.length !== 2 || parts.some((p) => p.trim().length === 0)) return null;
  const [serverName, toolName] = parts.map((p) => p.trim());
  return {
    kind: 'tool',
    serverName,
    toolName,
    qualifiedName: `${serverName}${MCP_URI_SEPARATOR}${toolName}`,
  };
}

export function getServerName(qualifiedName: string): string {
  try {
    return parseUri(qualifiedName, MCP_URI_SEPARATOR).clientName;
  } catch {
    return '';
  }
}

export function getToolName(qualifiedName: string): string {
  try {
    return parseUri(qualifiedName, MCP_URI_SEPARATOR).resourceName;
  } catch {
    return qualifiedName;
  }
}

export function qualifyToolName(serverName: string, toolName: string): string {
  return buildUri(serverName, toolName, MCP_URI_SEPARATOR);
}

export function summarizeToolSchema(tool: Tool): ToolSummary {
  const inputSchema =
    tool.inputSchema && typeof tool.inputSchema === 'object' ? (tool.inputSchema as Record<string, unknown>) : {};
  const properties =
    inputSchema.properties && typeof inputSchema.properties === 'object'
      ? (inputSchema.properties as Record<string, unknown>)
      : {};
  const required =
    Array.isArray(inputSchema.required) &&
    inputSchema.required.every((value): value is string => typeof value === 'string' && value.length > 0)
      ? inputSchema.required
      : [];

  return {
    tool: getToolName(tool.name),
    qualifiedName: tool.name,
    description: tool.description ?? '',
    requiredArgs: required.length,
    optionalArgs: Math.max(Object.keys(properties).length - required.length, 0),
  };
}

export function summarizeDirectServerTool(serverName: string, tool: Tool): ToolSummary {
  return summarizeToolSchema({
    ...tool,
    name: getServerName(tool.name) === serverName ? tool.name : qualifyToolName(serverName, tool.name),
  });
}

export function resolveConnectionByServerName(
  connections: ReturnType<typeof FilteringService.getFilteredConnections>,
  serverName: string,
) {
  const direct = connections.get(serverName);
  if (direct) return direct;

  for (const [key, connection] of connections) {
    const cleanKey = key.includes(':') ? key.split(':')[0] : key;
    if (cleanKey === serverName || connection.name === serverName) {
      return connection;
    }
  }

  return undefined;
}

export function matchesFilterConfig(tags: string[] | undefined, filterConfig: InboundConnectionConfig): boolean {
  const serverTags = tags ?? [];

  if (!filterConfig.tagFilterMode || filterConfig.tagFilterMode === 'none') {
    return true;
  }

  if (filterConfig.tagFilterMode === 'preset' && filterConfig.tagQuery) {
    return TagQueryEvaluator.evaluate(filterConfig.tagQuery, serverTags);
  }

  if (filterConfig.tagFilterMode === 'advanced' && filterConfig.tagExpression) {
    return TagQueryParser.evaluate(filterConfig.tagExpression, serverTags);
  }

  if (filterConfig.tags?.length) {
    const normalizedServerTags = serverTags.map((tag) => normalizeTag(tag));
    const normalizedFilterTags = filterConfig.tags.map((tag) => normalizeTag(tag));
    return normalizedServerTags.some((tag) => normalizedFilterTags.includes(tag));
  }

  return true;
}
