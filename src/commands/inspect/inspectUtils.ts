import { encode } from '@toon-format/toon';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { ParsedToolReference } from '@src/commands/run/runUtils.js';
import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { buildUri, parseUri } from '@src/utils/core/parsing.js';

import chalk from 'chalk';

export type InspectOutputFormat = 'text' | 'json' | 'toon';

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
  instructions?: string | null;
  servers: InspectServerSummary[];
  serverInstructions?: Record<string, string>;
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

  return {
    kind: 'server',
    server: serverName,
    instructions,
    tools: summaries,
    fromCache,
  };
}

export function formatInspectOutput(result: InspectResult, format: InspectOutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  if (format === 'toon') {
    return encode(result);
  }

  if (result.kind === 'servers') return formatServersOutput(result);
  if (result.kind === 'server') return formatServerOutput(result);
  return formatToolOutput(result);
}

function formatServersOutput(info: InspectServersInfo): string {
  if (info.servers.length === 0) {
    return 'No servers available.';
  }

  const serverLines = [chalk.bold('servers:')];
  const sections = [chalk.bold.cyan('Inspect: Servers'), `count: ${info.servers.length}`];

  if (info.instructions !== undefined) {
    sections.push(
      info.instructions
        ? `${chalk.bold('instructions:')}\n\`\`\`\n${info.instructions}\n\`\`\``
        : `${chalk.bold('instructions:')}\n${chalk.dim('(none)')}`,
    );
  }

  for (const s of info.servers) {
    serverLines.push(``);
    serverLines.push(`- server: ${chalk.bold(s.server)}`);
    if (s.type) {
      serverLines.push(`  type: ${chalk.dim(s.type)}`);
    }
    if (s.status) {
      const status =
        s.status === 'connected'
          ? chalk.green(s.status)
          : s.status === 'disconnected'
            ? chalk.red(s.status)
            : chalk.yellow(s.status);
      serverLines.push(`  status: ${status}`);
    }
    if (s.available !== undefined) {
      serverLines.push(`  available: ${s.available ? 'yes' : 'no'}`);
    }
    serverLines.push(`  tools: ${s.toolCount}`);
    serverLines.push(`  instructions: ${s.hasInstructions ? 'yes' : 'no'}`);
  }

  sections.push(serverLines.join('\n'));
  return sections.join('\n\n');
}

function formatToolOutput(toolInfo: InspectToolInfo): string {
  const sections: string[] = [
    chalk.bold.cyan('Inspect: Tool'),
    [`server: ${toolInfo.server}`, `tool: ${toolInfo.tool}`, `qualified_name: ${toolInfo.qualifiedName}`].join('\n'),
  ];

  if (toolInfo.description) {
    sections.push(`${chalk.bold('description:')}\n${indentBlock(toolInfo.description, 2)}`);
  }

  sections.push(formatArgumentSection('Required args', toolInfo.requiredArgs));
  sections.push(formatArgumentSection('Optional args', toolInfo.optionalArgs));

  if (toolInfo.outputSchema) {
    sections.push(formatOutputSchemaSection(toolInfo.outputSchema));
  }

  if (toolInfo.fromCache !== undefined) {
    const cacheValue = toolInfo.fromCache ? chalk.green('hit') : chalk.yellow('miss');
    sections.push(`schema_cache: ${cacheValue}`);
  }

  if (toolInfo.examples.length > 0) {
    sections.push(
      `${chalk.bold('examples:')}\n${toolInfo.examples.map((example) => `- ${JSON.stringify(example)}`).join('\n')}`,
    );
  }

  return sections.join('\n\n');
}

function formatServerOutput(serverInfo: InspectServerInfo): string {
  const totalTools = serverInfo.totalTools ?? serverInfo.tools.length;
  const summaryLines = [`server: ${serverInfo.server}`, `tools_total: ${totalTools}`];

  if (serverInfo.type) {
    summaryLines.push(`type: ${serverInfo.type}`);
  }

  if (serverInfo.status) {
    const status =
      serverInfo.status === 'connected'
        ? chalk.green(serverInfo.status)
        : serverInfo.status === 'disconnected'
          ? chalk.red(serverInfo.status)
          : chalk.yellow(serverInfo.status);
    summaryLines.push(`status: ${status}`);
  }

  if (serverInfo.available !== undefined) {
    summaryLines.push(`available: ${serverInfo.available ? 'yes' : 'no'}`);
  }

  const sections: string[] = [chalk.bold.cyan('Inspect: Server'), summaryLines.join('\n')];

  sections.push(chalk.bold(`tools (${totalTools}):`));
  sections.push(
    serverInfo.tools
      .map((tool) => {
        const lines = [
          ``,
          `- tool: ${chalk.yellow(tool.tool)}`,
          `  required_args: ${tool.requiredArgs}`,
          `  optional_args: ${tool.optionalArgs}`,
        ];

        if (tool.description) {
          lines.push(`  description: ${tool.description}`);
        }

        return lines.join('\n');
      })
      .join('\n'),
  );

  if (serverInfo.hasMore) {
    const hint = serverInfo.nextCursor
      ? `Use --cursor ${serverInfo.nextCursor} to see more, or --all to fetch everything.`
      : '  Use --all to fetch all tools.';
    sections.push(chalk.dim(`pagination: showing ${serverInfo.tools.length} of ${totalTools} tools. ${hint.trim()}`));
  }

  if (serverInfo.fromCache !== undefined) {
    const cacheValue = serverInfo.fromCache ? chalk.green('hit') : chalk.yellow('miss');
    sections.push(`schema_cache: ${cacheValue}`);
  }

  return sections.join('\n\n');
}

function formatArgumentSection(title: string, args: InspectArgumentInfo[]): string {
  if (args.length === 0) {
    return `${chalk.bold(`${toSectionKey(title)}:`)}\n${chalk.dim('(none)')}`;
  }

  return `${chalk.bold(`${toSectionKey(title)}:`)}\n${args.map(formatArgumentLine).join('\n')}`;
}

function formatOutputSchemaSection(outputSchema: Record<string, unknown>): string {
  const schemaObject = getSchemaObject(outputSchema);
  const fields = collectInspectArguments(schemaObject);

  if (fields.length > 0) {
    const lines = [chalk.bold('output_schema:')];
    const requiredFields = fields.filter((field) => field.required);
    const optionalFields = fields.filter((field) => !field.required);

    lines.push(indentBlock(formatArgumentSection('Required fields', requiredFields), 2));
    lines.push('');
    lines.push(indentBlock(formatArgumentSection('Optional fields', optionalFields), 2));
    return lines.join('\n');
  }

  const schemaType = summarizeSchemaType(schemaObject);
  return `${chalk.bold('output_schema:')}\n  type=${chalk.dim(schemaType)}`;
}

function formatArgumentLine(arg: InspectArgumentInfo): string {
  const details = [`type=${chalk.dim(arg.type)}`];
  if (arg.enumValues && arg.enumValues.length > 0) {
    details.push(`enum=${chalk.dim(arg.enumValues.map((value) => String(value)).join(' | '))}`);
  }
  if (arg.defaultValue !== undefined) {
    details.push(`default=${chalk.dim(JSON.stringify(arg.defaultValue))}`);
  }

  const lines = [``, `- name: ${chalk.yellow(arg.name)}`, `  ${details.join(chalk.dim('  '))}`];
  if (arg.description) {
    lines.push(`  description: ${arg.description}`);
  }
  return lines.join('\n');
}

function toSectionKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, '_');
}

function indentBlock(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function collectInspectArguments(inputSchema: Record<string, unknown>): InspectArgumentInfo[] {
  const schemaObject = getSchemaObject(inputSchema);
  const properties = isPlainObject(schemaObject.properties) ? schemaObject.properties : {};
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
