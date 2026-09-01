import type { JsonObject } from './jsonValue.js';

/** Open protocol extension bags are normalized before shared code relies on their contents. */
export type ProtocolObject = JsonObject | Record<string, unknown>;

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

export type JsonSchemaObject = Record<string, unknown> & {
  $schema?: string;
  type: 'object';
  properties?: Record<string, object>;
  required?: string[];
};

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface Tool extends ProtocolMetadata {
  description?: string;
  inputSchema: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  execution?: { taskSupport?: 'forbidden' | 'optional' | 'required' };
  annotations?: ToolAnnotations;
  _meta?: ProtocolObject;
}

export interface PromptArgument extends ProtocolMetadata {
  description?: string;
  required?: boolean;
}

export interface Prompt extends ProtocolMetadata {
  description?: string;
  arguments?: PromptArgument[];
  _meta?: ProtocolObject;
}

export interface Resource extends ProtocolMetadata {
  uri: string;
  description?: string;
  mimeType?: string;
  annotations?: Annotations;
  size?: number;
  _meta?: ProtocolObject;
}

export interface ResourceTemplate extends ProtocolMetadata {
  uriTemplate: string;
  description?: string;
  mimeType?: string;
  annotations?: Annotations;
  _meta?: ProtocolObject;
}

export interface TextContent {
  type: 'text';
  text: string;
  annotations?: Annotations;
  _meta?: ProtocolObject;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
  annotations?: Annotations;
  _meta?: ProtocolObject;
}

export interface AudioContent {
  type: 'audio';
  data: string;
  mimeType: string;
  annotations?: Annotations;
  _meta?: ProtocolObject;
}

export interface ResourceLink extends Resource {
  type: 'resource_link';
}

export interface TextResourceContents {
  uri: string;
  mimeType?: string;
  text: string;
  _meta?: ProtocolObject;
}

export interface BlobResourceContents {
  uri: string;
  mimeType?: string;
  blob: string;
  _meta?: ProtocolObject;
}

export interface EmbeddedResource {
  type: 'resource';
  resource: TextResourceContents | BlobResourceContents;
  annotations?: Annotations;
  _meta?: ProtocolObject;
}

export type ContentBlock = TextContent | ImageContent | AudioContent | ResourceLink | EmbeddedResource;

export interface CallToolResult {
  content: ContentBlock[];
  structuredContent?: ProtocolObject;
  isError?: boolean;
  _meta?: ProtocolObject;
}

export interface ListToolsResult {
  tools: Tool[];
  nextCursor?: string;
  _meta?: ProtocolObject;
}

export interface ListResourcesResult {
  resources: Resource[];
  nextCursor?: string;
  _meta?: ProtocolObject;
}

export interface ListPromptsResult {
  prompts: Prompt[];
  nextCursor?: string;
  _meta?: ProtocolObject;
}

export interface ClientCapabilities {
  [key: string]: unknown;
  experimental?: Record<string, ProtocolObject>;
  roots?: { listChanged?: boolean };
  sampling?: { context?: ProtocolObject; tools?: ProtocolObject };
  elicitation?: { form?: ProtocolObject; url?: ProtocolObject };
  tasks?: ProtocolObject;
  extensions?: Record<string, ProtocolObject>;
}

export interface ServerCapabilities {
  [key: string]: unknown;
  experimental?: Record<string, ProtocolObject>;
  logging?: ProtocolObject;
  completions?: ProtocolObject;
  prompts?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  tools?: { listChanged?: boolean };
  tasks?: ProtocolObject;
  extensions?: Record<string, ProtocolObject>;
}

export type RequestId = string | number;

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: RequestId;
  method: string;
  params?: ProtocolObject;
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: ProtocolObject;
}

export interface JSONRPCResultResponse {
  jsonrpc: '2.0';
  id: RequestId;
  result: ProtocolObject;
}

export interface JSONRPCErrorResponse {
  jsonrpc: '2.0';
  id?: RequestId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
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
  jwks?: unknown;
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

export interface OAuthClientInformationFull extends OAuthClientMetadata, OAuthClientInformation {}

/** Matches HTTP-like errors without importing or depending on an SDK error class identity. */
export function hasHttpErrorCode(error: unknown, code: number): error is { readonly code: number } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
