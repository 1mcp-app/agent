import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { CustomJsonSchemaValidator } from '@src/core/validation/CustomJsonSchemaValidator.js';
import { buildUri } from '@src/utils/core/parsing.js';

export type RunOutputFormat = 'json' | 'text' | 'compact';

export interface ParsedToolReference {
  serverName: string;
  toolName: string;
  qualifiedName: string;
}

export interface ResolveToolArgumentsOptions {
  explicitArgs?: string;
  stdinText?: string;
  tool?: Tool;
}

export interface ResolveToolArgumentsResult {
  arguments: Record<string, unknown>;
  usedStdin: boolean;
}

interface JsonSchemaObject {
  properties?: Record<string, unknown>;
  required?: unknown;
}

interface TextContentBlock {
  type: 'text';
  text: string;
}

interface ImageContentBlock {
  type: 'image';
  mimeType?: string;
}

interface ResourceContentBlock {
  type: 'resource';
  resource?: {
    uri?: string;
  };
}

interface JsonRpcSuccessEnvelope {
  jsonrpc: '2.0';
  id: number;
  result: CallToolResult;
}

interface JsonRpcErrorEnvelope {
  jsonrpc: '2.0';
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class RunCommandInputError extends Error {}

export interface ValidateToolArgsFailure {
  valid: false;
  errorMessage: string;
  schema: Record<string, unknown>;
}

export function validateToolArgs(
  args: Record<string, unknown>,
  inputSchema: Record<string, unknown>,
  toolDisplayName: string,
): { valid: true } | ValidateToolArgsFailure {
  const validator = new CustomJsonSchemaValidator();
  const validate = validator.getValidator<Record<string, unknown>>(inputSchema);
  const result = validate(args);
  if (result.valid) {
    return { valid: true };
  }
  return {
    valid: false,
    errorMessage: `Validation failed for ${toolDisplayName}:\n  ${result.errorMessage ?? 'Invalid arguments'}\n\nExpected schema:\n${JSON.stringify(inputSchema, null, 2)}`,
    schema: inputSchema,
  };
}

export function parseToolReference(toolRef: string): ParsedToolReference {
  const parts = toolRef.split('/');
  if (parts.length !== 2) {
    throw new RunCommandInputError('Tool reference must be in the format <server>/<tool>.');
  }

  const [serverPart, toolPart] = parts;
  const serverName = serverPart.trim();
  const toolName = toolPart.trim();

  if (!serverName || !toolName) {
    throw new RunCommandInputError('Tool reference must be in the format <server>/<tool>.');
  }

  return {
    serverName,
    toolName,
    qualifiedName: buildUri(serverName, toolName, MCP_URI_SEPARATOR),
  };
}

export function findToolByReference(tools: Tool[], reference: ParsedToolReference): Tool | undefined {
  return tools.find((tool) => tool.name === reference.qualifiedName);
}

export function findToolByQualifiedName(tools: Tool[], qualifiedName: string): Tool | undefined {
  return tools.find((tool) => tool.name === qualifiedName);
}

export function resolveToolArguments(options: ResolveToolArgumentsOptions): ResolveToolArgumentsResult {
  if (options.explicitArgs !== undefined) {
    return {
      arguments: parseExplicitArgs(options.explicitArgs),
      usedStdin: false,
    };
  }

  const stdinText = options.stdinText;
  if (stdinText === undefined) {
    return {
      arguments: {},
      usedStdin: false,
    };
  }

  const stdinObject = parseJsonObject(stdinText);
  if (stdinObject) {
    return {
      arguments: stdinObject,
      usedStdin: true,
    };
  }

  if (!options.tool) {
    throw new RunCommandInputError('Tool schema is required to map raw stdin. Use --args instead.');
  }

  const targetProperty = getFirstRequiredStringProperty(options.tool);
  if (!targetProperty) {
    throw new RunCommandInputError(
      `Tool ${options.tool.name.replace(MCP_URI_SEPARATOR, '/')} has no string arguments. Cannot map stdin. Use --args instead.`,
    );
  }

  const remainingRequired = getRequiredProperties(options.tool).filter((property) => property !== targetProperty);
  if (remainingRequired.length > 0) {
    throw new RunCommandInputError(`Missing required argument: ${remainingRequired[0]}. Use --args or named flags.`);
  }

  return {
    arguments: {
      [targetProperty]: stdinText,
    },
    usedStdin: true,
  };
}

export function formatToolCallOutput(
  response: JsonRpcSuccessEnvelope | JsonRpcErrorEnvelope,
  format: RunOutputFormat,
  maxChars: number,
): string {
  if (format === 'json') {
    return JSON.stringify(response, null, 2);
  }

  if ('error' in response) {
    return response.error.message;
  }

  const textOutput = extractTextOutput(response.result);
  if (format === 'text') {
    return textOutput;
  }

  return truncateText(textOutput, maxChars);
}

export function truncateText(text: string, maxChars: number): string {
  if (maxChars < 0) {
    throw new RunCommandInputError('--max-chars must be zero or greater.');
  }

  if (maxChars === 0) {
    return text;
  }

  if (text.length <= maxChars) {
    return text;
  }

  const suffix = '... [truncated]';
  if (maxChars <= suffix.length) {
    return suffix.slice(0, maxChars);
  }

  return `${text.slice(0, maxChars - suffix.length)}${suffix}`;
}

function parseExplicitArgs(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isPlainObject(parsed)) {
      throw new RunCommandInputError('--args must be a JSON object.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof RunCommandInputError) {
      throw error;
    }
    throw new RunCommandInputError(
      `Invalid JSON passed to --args: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getFirstRequiredStringProperty(tool: Tool): string | undefined {
  const schema = getToolSchema(tool);
  const requiredProperties = getRequiredProperties(tool);

  for (const propertyName of requiredProperties) {
    const property = schema.properties?.[propertyName];
    if (isSchemaString(property)) {
      return propertyName;
    }
  }

  return undefined;
}

function getRequiredProperties(tool: Tool): string[] {
  const schema = getToolSchema(tool);
  if (!Array.isArray(schema.required)) {
    return [];
  }

  return schema.required.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function getToolSchema(tool: Tool): JsonSchemaObject {
  const schema = tool.inputSchema as unknown;
  if (!schema || typeof schema !== 'object') {
    return {};
  }

  return schema as JsonSchemaObject;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchemaString(value: unknown): value is { type: 'string' } {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'string';
}

function extractTextOutput(result: CallToolResult): string {
  const output: string[] = [];

  for (const block of result.content) {
    if (isTextContentBlock(block)) {
      output.push(block.text);
      continue;
    }

    if (isImageContentBlock(block)) {
      output.push(`[image: ${block.mimeType || 'unknown'}]`);
      continue;
    }

    if (isResourceContentBlock(block)) {
      output.push(`[resource: ${block.resource?.uri || 'unknown'}]`);
    }
  }

  return output.join('\n');
}

function isTextContentBlock(value: unknown): value is TextContentBlock {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'text' && 'text' in value;
}

function isImageContentBlock(value: unknown): value is ImageContentBlock {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'image';
}

function isResourceContentBlock(value: unknown): value is ResourceContentBlock {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'resource';
}
