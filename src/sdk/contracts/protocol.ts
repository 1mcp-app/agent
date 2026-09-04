import { type JsonObject, type JsonValue, toJsonValue } from './jsonValue.js';

/** Stable JSON-RPC and transport error codes used by 1MCP. */
export enum ErrorCode {
  ConnectionClosed = -32000,
  RequestTimeout = -32001,
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  UrlElicitationRequired = -32042,
}

export type ProtocolObject = JsonObject;

export interface Icon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: 'light' | 'dark';
}

export interface Annotations {
  audience?: Array<'user' | 'assistant'>;
  priority?: number;
  lastModified?: string;
}

export interface ProtocolMetadata {
  name: string;
  title?: string;
  icons?: Icon[];
}

export type JsonSchemaObject = JsonObject & {
  $schema?: string;
  type: 'object';
  properties?: Record<string, JsonObject>;
  required?: string[];
};

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export type Tool = ProtocolMetadata & {
  description?: string;
  inputSchema: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  execution?: { taskSupport?: 'forbidden' | 'optional' | 'required' };
  annotations?: ToolAnnotations;
  _meta?: JsonObject;
};

export type PromptArgument = ProtocolMetadata & {
  description?: string;
  required?: boolean;
};

export type Prompt = ProtocolMetadata & {
  description?: string;
  arguments?: PromptArgument[];
  _meta?: JsonObject;
};

export type Resource = ProtocolMetadata & {
  uri: string;
  description?: string;
  mimeType?: string;
  annotations?: Annotations;
  size?: number;
  _meta?: JsonObject;
};

export type ResourceTemplate = ProtocolMetadata & {
  uriTemplate: string;
  description?: string;
  mimeType?: string;
  annotations?: Annotations;
  _meta?: JsonObject;
};

export interface TextContent {
  type: 'text';
  text: string;
  annotations?: Annotations;
  _meta?: JsonObject;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
  annotations?: Annotations;
  _meta?: JsonObject;
}

export interface AudioContent {
  type: 'audio';
  data: string;
  mimeType: string;
  annotations?: Annotations;
  _meta?: JsonObject;
}

export type ResourceLink = Resource & { type: 'resource_link' };

export interface TextResourceContents {
  uri: string;
  mimeType?: string;
  text: string;
  _meta?: JsonObject;
}

export interface BlobResourceContents {
  uri: string;
  mimeType?: string;
  blob: string;
  _meta?: JsonObject;
}

export interface EmbeddedResource {
  type: 'resource';
  resource: TextResourceContents | BlobResourceContents;
  annotations?: Annotations;
  _meta?: JsonObject;
}

export type ContentBlock = TextContent | ImageContent | AudioContent | ResourceLink | EmbeddedResource;

export interface CallToolResult {
  content: ContentBlock[];
  structuredContent?: JsonObject;
  isError?: boolean;
  _meta?: JsonObject;
}

export interface ListToolsResult {
  tools: Tool[];
  nextCursor?: string;
  _meta?: JsonObject;
}
export interface ListResourcesResult {
  resources: Resource[];
  nextCursor?: string;
  _meta?: JsonObject;
}
export interface ListPromptsResult {
  prompts: Prompt[];
  nextCursor?: string;
  _meta?: JsonObject;
}

interface ListChangedCapability {
  listChanged?: boolean;
}

export interface ClientCapabilities {
  experimental?: Record<string, JsonObject>;
  roots?: ListChangedCapability;
  sampling?: { context?: JsonObject; tools?: JsonObject };
  elicitation?: { form?: JsonObject; url?: JsonObject };
  tasks?: JsonObject;
  extensions?: Record<string, JsonObject>;
}

export interface ServerCapabilities {
  experimental?: Record<string, JsonObject>;
  logging?: JsonObject;
  completions?: JsonObject;
  prompts?: ListChangedCapability;
  resources?: ListChangedCapability & { subscribe?: boolean };
  tools?: ListChangedCapability;
  tasks?: JsonObject;
  extensions?: Record<string, JsonObject>;
}

export type RequestId = string | number;
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: RequestId;
  method: string;
  params?: JsonObject;
}
export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: JsonObject;
}
export interface JSONRPCResultResponse {
  jsonrpc: '2.0';
  id: RequestId;
  result: JsonObject;
}
export interface JSONRPCErrorResponse {
  jsonrpc: '2.0';
  id?: RequestId;
  error: { code: number; message: string; data?: JsonValue };
}
export type JSONRPCMessage = JSONRPCRequest | JSONRPCNotification | JSONRPCResultResponse | JSONRPCErrorResponse;

export interface OAuthClientMetadata {
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  scope?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  jwks?: JsonValue;
  software_id?: string;
  software_version?: string;
  software_statement?: string;
}

export interface OAuthClientInformation {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
}

export type OAuthClientInformationFull = OAuthClientMetadata & OAuthClientInformation;

function toProtocolJsonObject(value: unknown, label: string): JsonObject {
  const normalized = toJsonValue(value);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== 'object') {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return normalized;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && !Array.isArray(value) && typeof value === 'object';
}

function isOptionalString(value: JsonValue | undefined): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalBoolean(value: JsonValue | undefined): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function isStringArray(value: JsonValue | undefined): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function isProtocolMetadata(value: JsonObject): value is JsonObject & ProtocolMetadata {
  return (
    typeof value.name === 'string' &&
    isOptionalString(value.title) &&
    (value.icons === undefined ||
      (Array.isArray(value.icons) &&
        value.icons.every(
          (icon) =>
            isJsonObject(icon) &&
            typeof icon.src === 'string' &&
            isOptionalString(icon.mimeType) &&
            isStringArray(icon.sizes) &&
            (icon.theme === undefined || icon.theme === 'light' || icon.theme === 'dark'),
        )))
  );
}

function isJsonSchemaObject(value: JsonValue | undefined): value is JsonSchemaObject {
  return (
    isJsonObject(value) &&
    value.type === 'object' &&
    isOptionalString(value.$schema) &&
    (value.properties === undefined ||
      (isJsonObject(value.properties) && Object.values(value.properties).every(isJsonObject))) &&
    isStringArray(value.required)
  );
}

function isAnnotations(value: JsonValue | undefined): value is JsonObject & Annotations {
  return (
    isJsonObject(value) &&
    (value.audience === undefined ||
      (Array.isArray(value.audience) &&
        value.audience.every((audience) => audience === 'user' || audience === 'assistant'))) &&
    (value.priority === undefined || typeof value.priority === 'number') &&
    isOptionalString(value.lastModified)
  );
}

function isTool(value: JsonObject): value is JsonObject & Tool {
  const annotations = value.annotations;
  const execution = value.execution;
  return (
    isProtocolMetadata(value) &&
    isOptionalString(value.description) &&
    isJsonSchemaObject(value.inputSchema) &&
    (value.outputSchema === undefined || isJsonSchemaObject(value.outputSchema)) &&
    (execution === undefined ||
      (isJsonObject(execution) &&
        (execution.taskSupport === undefined ||
          execution.taskSupport === 'forbidden' ||
          execution.taskSupport === 'optional' ||
          execution.taskSupport === 'required'))) &&
    (annotations === undefined ||
      (isJsonObject(annotations) &&
        isOptionalString(annotations.title) &&
        isOptionalBoolean(annotations.readOnlyHint) &&
        isOptionalBoolean(annotations.destructiveHint) &&
        isOptionalBoolean(annotations.idempotentHint) &&
        isOptionalBoolean(annotations.openWorldHint))) &&
    (value._meta === undefined || isJsonObject(value._meta))
  );
}

function isResource(value: JsonObject): value is JsonObject & Resource {
  return (
    isProtocolMetadata(value) &&
    typeof value.uri === 'string' &&
    isOptionalString(value.description) &&
    isOptionalString(value.mimeType) &&
    (value.annotations === undefined || isAnnotations(value.annotations)) &&
    (value.size === undefined || typeof value.size === 'number') &&
    (value._meta === undefined || isJsonObject(value._meta))
  );
}

function isPromptArgument(value: JsonValue): value is JsonObject & PromptArgument {
  return (
    isJsonObject(value) &&
    isProtocolMetadata(value) &&
    isOptionalString(value.description) &&
    isOptionalBoolean(value.required)
  );
}

function isPrompt(value: JsonObject): value is JsonObject & Prompt {
  return (
    isProtocolMetadata(value) &&
    isOptionalString(value.description) &&
    (value.arguments === undefined || (Array.isArray(value.arguments) && value.arguments.every(isPromptArgument))) &&
    (value._meta === undefined || isJsonObject(value._meta))
  );
}

function isRequestId(value: JsonValue | undefined): value is RequestId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value));
}

function isJSONRPCMessage(value: JsonObject): value is JsonObject & JSONRPCMessage {
  if (value.jsonrpc !== '2.0') return false;

  if (typeof value.method === 'string') {
    const hasValidParams = value.params === undefined || isJsonObject(value.params);
    return (
      hasValidParams &&
      (value.id === undefined || isRequestId(value.id)) &&
      value.result === undefined &&
      value.error === undefined
    );
  }

  if (isRequestId(value.id) && isJsonObject(value.result)) {
    return value.error === undefined && value.method === undefined;
  }

  if (!isJsonObject(value.error)) return false;
  return (
    (value.id === undefined || isRequestId(value.id)) &&
    typeof value.error.code === 'number' &&
    Number.isInteger(value.error.code) &&
    typeof value.error.message === 'string' &&
    value.method === undefined &&
    value.result === undefined
  );
}

export function toProtocolTool(value: unknown): Tool {
  const normalized = toProtocolJsonObject(value, 'Tool');
  if (!isTool(normalized)) {
    throw new TypeError('Tool must have a name and object input schema');
  }
  return normalized;
}

export function toProtocolTools(values: readonly unknown[]): Tool[] {
  return values.map(toProtocolTool);
}

export function toProtocolResource(value: unknown): Resource {
  const normalized = toProtocolJsonObject(value, 'Resource');
  if (!isResource(normalized)) {
    throw new TypeError('Resource must have a name and URI');
  }
  return normalized;
}

export function toProtocolResources(values: readonly unknown[]): Resource[] {
  return values.map(toProtocolResource);
}

export function toProtocolPrompt(value: unknown): Prompt {
  const normalized = toProtocolJsonObject(value, 'Prompt');
  if (!isPrompt(normalized)) {
    throw new TypeError('Prompt must have a name');
  }
  return normalized;
}

export function toProtocolPrompts(values: readonly unknown[]): Prompt[] {
  return values.map(toProtocolPrompt);
}

export function toProtocolJSONRPCMessage(value: unknown): JSONRPCMessage {
  const normalized = toProtocolJsonObject(value, 'JSON-RPC message');
  if (!isJSONRPCMessage(normalized)) {
    throw new TypeError('JSON-RPC message must use version 2.0');
  }
  return normalized;
}

/** Matches HTTP-like errors without importing or depending on an SDK error class identity. */
export function hasHttpErrorCode(error: unknown, code: number): error is { readonly code: number } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
