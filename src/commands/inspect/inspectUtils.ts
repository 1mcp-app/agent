import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { ParsedToolReference } from '@src/commands/run/runUtils.js';
import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { buildUri, parseUri } from '@src/utils/core/parsing.js';

export type InspectOutputFormat = 'text' | 'json';

interface JsonSchemaObject {
  type?: unknown;
  description?: unknown;
  default?: unknown;
  enum?: unknown;
  items?: unknown;
  properties?: Record<string, unknown>;
  required?: unknown;
}

export interface InspectArgumentInfo {
  name: string;
  required: boolean;
  type: string;
  description?: string;
  defaultValue?: unknown;
  enumValues?: unknown[];
}

export interface InspectToolInfo {
  kind: 'tool';
  server: string;
  tool: string;
  qualifiedName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  fromCache?: boolean;
  requiredArgs: InspectArgumentInfo[];
  optionalArgs: InspectArgumentInfo[];
  examples: unknown[];
}

export interface InspectServerToolSummary {
  tool: string;
  qualifiedName: string;
  description?: string;
  requiredArgs: number;
  optionalArgs: number;
}

export interface InspectServerInfo {
  kind: 'server';
  server: string;
  type?: string;
  status?: string;
  available?: boolean;
  instructions?: string | null;
  tools: InspectServerToolSummary[];
  totalTools?: number;
  hasMore?: boolean;
  nextCursor?: string;
  fromCache?: boolean;
}

export interface InspectServerSummary {
  server: string;
  type?: string;
  status?: string;
  available?: boolean;
  toolCount: number;
  hasInstructions: boolean;
}

export interface InspectServersInfo {
  kind: 'servers';
  servers: InspectServerSummary[];
}

export type InspectResult = InspectToolInfo | InspectServerInfo | InspectServersInfo;

export type InspectTarget =
  | {
      kind: 'tool';
      reference: ParsedToolReference;
    }
  | {
      kind: 'server';
      serverName: string;
    }
  | {
      kind: 'all';
    };

export class InspectCommandError extends Error {}

export function parseInspectTarget(value: string | undefined): InspectTarget {
  if (value === undefined || value.trim() === '') {
    return { kind: 'all' };
  }

  const trimmed = value.trim();

  if (!trimmed.includes('/')) {
    return {
      kind: 'server',
      serverName: trimmed,
    };
  }

  const parts = trimmed.split('/');
  if (parts.length !== 2 || parts.some((part) => part.trim().length === 0)) {
    throw new InspectCommandError('Inspect target must be <server> or <server>/<tool>.');
  }

  const [serverName, toolName] = parts.map((part) => part.trim());
  return {
    kind: 'tool',
    reference: {
      serverName,
      toolName,
      qualifiedName: buildUri(serverName, toolName, MCP_URI_SEPARATOR),
    },
  };
}

export function extractInspectToolInfo(
  tool: Tool,
  reference: ParsedToolReference,
  fromCache?: boolean,
): InspectToolInfo {
  const inputSchema = getSchemaObject(tool.inputSchema);
  const outputSchema = getOptionalSchemaObject(tool.outputSchema);
  const args = collectInspectArguments(inputSchema);

  return {
    kind: 'tool',
    server: reference.serverName,
    tool: reference.toolName,
    qualifiedName: reference.qualifiedName,
    description: tool.description,
    inputSchema,
    outputSchema,
    fromCache,
    requiredArgs: args.filter((arg) => arg.required),
    optionalArgs: args.filter((arg) => !arg.required),
    examples: getExamples(tool),
  };
}

export function extractInspectServerInfo(
  serverName: string,
  tools: Tool[],
  fromCache?: boolean,
  instructions?: string | null,
): InspectServerInfo {
  const summaries = tools
    .filter((tool) => getServerName(tool) === serverName)
    .map((tool) => {
      const args = collectInspectArguments(getSchemaObject(tool.inputSchema));
      return {
        tool: getToolName(tool),
        qualifiedName: tool.name,
        description: tool.description,
        requiredArgs: args.filter((arg) => arg.required).length,
        optionalArgs: args.filter((arg) => !arg.required).length,
      };
    })
    .sort((left, right) => left.tool.localeCompare(right.tool));

  if (summaries.length === 0) {
    throw new InspectCommandError(`Server not found or has no exposed tools: ${serverName}`);
  }

  return {
    kind: 'server',
    server: serverName,
    tools: summaries,
    fromCache,
    instructions,
  };
}

export function formatInspectOutput(result: InspectResult, format: InspectOutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  if (result.kind === 'servers') return formatServersOutput(result);
  if (result.kind === 'server') return formatServerOutput(result);
  return formatToolOutput(result);
}

function formatServersOutput(info: InspectServersInfo): string {
  if (info.servers.length === 0) {
    return 'No servers available.';
  }

  const lines = [`Servers (${info.servers.length}):`];
  for (const s of info.servers) {
    const parts: string[] = [s.server];
    if (s.type) parts.push(s.type);
    if (s.status) parts.push(s.status);
    parts.push(`${s.toolCount} tool${s.toolCount !== 1 ? 's' : ''}`);
    if (s.hasInstructions) parts.push('has instructions');
    lines.push(`  - ${parts.join(', ')}`);
  }
  return lines.join('\n');
}

function formatToolOutput(toolInfo: InspectToolInfo): string {
  const sections: string[] = [toolInfo.qualifiedName];

  if (toolInfo.description) {
    sections.push(toolInfo.description);
  }

  sections.push(formatArgumentSection('Required args', toolInfo.requiredArgs));
  sections.push(formatArgumentSection('Optional args', toolInfo.optionalArgs));

  if (toolInfo.outputSchema) {
    sections.push('Output schema: available');
  }

  if (toolInfo.fromCache !== undefined) {
    sections.push(`Schema cache: ${toolInfo.fromCache ? 'hit' : 'miss'}`);
  }

  if (toolInfo.examples.length > 0) {
    sections.push(`Examples:\n${toolInfo.examples.map((example) => `- ${JSON.stringify(example)}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

function formatServerOutput(serverInfo: InspectServerInfo): string {
  const sections: string[] = [`Server: ${serverInfo.server}`];

  if (serverInfo.instructions !== undefined) {
    sections.push(serverInfo.instructions ? `Instructions:\n${serverInfo.instructions}` : 'Instructions:\n(none)');
  }

  const totalTools = serverInfo.totalTools ?? serverInfo.tools.length;
  sections.push(`Tools (${totalTools}):`);
  sections.push(
    serverInfo.tools
      .map((tool) => {
        const summary = `${tool.tool} (${tool.requiredArgs} required, ${tool.optionalArgs} optional)`;
        return tool.description ? `- ${summary} - ${tool.description}` : `- ${summary}`;
      })
      .join('\n'),
  );

  if (serverInfo.hasMore) {
    const hint = serverInfo.nextCursor
      ? `  Use --cursor ${serverInfo.nextCursor} to see more, or --all to fetch everything.`
      : '  Use --all to fetch all tools.';
    sections.push(`Showing ${serverInfo.tools.length} of ${totalTools} tools.${hint}`);
  }

  if (serverInfo.fromCache !== undefined) {
    sections.push(`Schema cache: ${serverInfo.fromCache ? 'hit' : 'miss'}`);
  }

  return sections.join('\n\n');
}

function formatArgumentSection(title: string, args: InspectArgumentInfo[]): string {
  if (args.length === 0) {
    return `${title}:\n(none)`;
  }

  return `${title}:\n${args.map(formatArgumentLine).join('\n')}`;
}

function formatArgumentLine(arg: InspectArgumentInfo): string {
  const details = [arg.type];
  if (arg.enumValues && arg.enumValues.length > 0) {
    details.push(`enum(${arg.enumValues.map((value) => String(value)).join(' | ')})`);
  }
  if (arg.defaultValue !== undefined) {
    details.push(`default=${JSON.stringify(arg.defaultValue)}`);
  }

  const suffix = arg.description ? ` - ${arg.description}` : '';
  return `- ${arg.name}: ${details.join(', ')}${suffix}`;
}

function collectInspectArguments(inputSchema: Record<string, unknown>): InspectArgumentInfo[] {
  const schemaObject = getSchemaObject(inputSchema);
  const properties = isRecord(schemaObject.properties) ? schemaObject.properties : {};
  const requiredSet = new Set(
    Array.isArray(schemaObject.required)
      ? schemaObject.required.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [],
  );

  return Object.entries(properties).map(([name, value]) => {
    const propertySchema = getSchemaObject(value);
    return {
      name,
      required: requiredSet.has(name),
      type: summarizeSchemaType(propertySchema),
      description: typeof propertySchema.description === 'string' ? propertySchema.description : undefined,
      defaultValue: propertySchema.default,
      enumValues: Array.isArray(propertySchema.enum) ? propertySchema.enum : undefined,
    };
  });
}

function summarizeSchemaType(schema: JsonSchemaObject): string {
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((value): value is string => typeof value === 'string');
    return types.length > 0 ? types.join(' | ') : 'unknown';
  }

  if (typeof schema.type === 'string') {
    if (schema.type === 'array') {
      const items = getOptionalSchemaObject(schema.items);
      if (items?.type && typeof items.type === 'string') {
        return `array<${items.type}>`;
      }
    }

    return schema.type;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.every((value) => typeof value === 'string') ? 'string' : 'enum';
  }

  return 'unknown';
}

function getExamples(schema: unknown): unknown[] {
  if (!isPlainObject(schema) || !('examples' in schema)) {
    return [];
  }

  const examples = schema.examples;
  return Array.isArray(examples) ? examples : [];
}

function getSchemaObject(value: unknown): Record<string, unknown> & JsonSchemaObject {
  return isPlainObject(value) ? (value as Record<string, unknown> & JsonSchemaObject) : {};
}

function getOptionalSchemaObject(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function getServerName(tool: Tool): string {
  try {
    return parseUri(tool.name, MCP_URI_SEPARATOR).clientName;
  } catch {
    return '';
  }
}

function getToolName(tool: Tool): string {
  try {
    return parseUri(tool.name, MCP_URI_SEPARATOR).resourceName;
  } catch {
    return tool.name;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
