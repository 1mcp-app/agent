import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  type CallToolResult,
  type JSONRPCMessage,
  LATEST_PROTOCOL_VERSION,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import {
  findToolByQualifiedName,
  formatToolCallOutput,
  parseToolReference,
  resolveToolArguments,
  RunCommandInputError,
  type RunOutputFormat,
} from '@src/commands/run/runUtils.js';
import { getConfigDir, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@src/constants.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import { discoverServerWithPidFile, validateServer1mcpUrl } from '@src/utils/validation/urlDetection.js';

interface JsonRpcSuccessEnvelope<Result> {
  jsonrpc: '2.0';
  id: number;
  result: Result;
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

type JsonRpcResponse<Result> = JsonRpcSuccessEnvelope<Result> | JsonRpcErrorEnvelope;

interface ListToolsResult {
  tools: Tool[];
  nextCursor?: string;
}

interface InitializeResult {
  protocolVersion: string;
}

interface RunSessionCache {
  sessionId: string;
  serverUrl: string;
  savedAt: number;
  hasRestEndpoint?: boolean;
}

interface PendingRequest<Result> {
  resolve: (value: JsonRpcResponse<Result>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface RunCommandOptions extends GlobalOptions {
  url?: string;
  preset?: string;
  filter?: string;
  tags?: string[];
  'tag-filter'?: string;
  format?: RunOutputFormat;
  raw?: boolean;
  'max-chars'?: number;
  args?: string;
  tool: string;
}

export const SESSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

class StreamableRunClient {
  private readonly transport: StreamableHTTPClientTransport;
  private readonly pendingRequests = new Map<number, PendingRequest<unknown>>();
  private nextId = 1;

  constructor(serverUrl: URL, sessionId?: string) {
    this.transport = new StreamableHTTPClientTransport(serverUrl, {
      sessionId,
      requestInit: {
        headers: {
          'User-Agent': `1MCP/${MCP_SERVER_VERSION}`,
        },
      },
    });

    this.transport.onmessage = (message) => {
      this.handleMessage(message);
    };
    this.transport.onerror = (error) => {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
    };
    this.transport.onclose = () => {
      this.rejectAll(new Error('Connection closed.'));
    };
  }

  async start(): Promise<void> {
    await this.transport.start();
  }

  async initialize(): Promise<JsonRpcResponse<InitializeResult>> {
    const response = await this.sendRequest<InitializeResult>('initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
      },
    });

    if ('result' in response && response.result.protocolVersion) {
      this.transport.setProtocolVersion(response.result.protocolVersion);
    }

    await this.transport.send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    return response;
  }

  async listTools(): Promise<JsonRpcResponse<ListToolsResult>> {
    return this.sendRequest<ListToolsResult>('tools/list', {});
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<JsonRpcResponse<CallToolResult>> {
    return this.sendRequest('tools/call', {
      name,
      arguments: args,
    });
  }

  get sessionId(): string | undefined {
    return this.transport.sessionId;
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  private async sendRequest<Result>(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse<Result>> {
    const id = this.nextId++;

    return new Promise<JsonRpcResponse<Result>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for ${method} response.`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: resolve as PendingRequest<unknown>['resolve'],
        reject,
        timeout,
      });

      void this.transport
        .send({
          jsonrpc: '2.0',
          id,
          method,
          params,
        })
        .catch((error) => {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  private handleMessage(message: JSONRPCMessage): void {
    if (!('id' in message) || typeof message.id !== 'number') {
      return;
    }

    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.id);
    pending.resolve(message as JsonRpcResponse<unknown>);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }
}

export async function runCommand(options: RunCommandOptions): Promise<void> {
  const toolReference = parseToolReference(options.tool);
  const format = options.raw ? 'json' : options.format || (process.stdout.isTTY ? 'text' : 'json');
  const maxChars = options['max-chars'] ?? 2000;

  const { url: discoveredUrl } = await discoverServerWithPidFile(options['config-dir'], options.url);
  const serverUrl = buildServerUrl(discoveredUrl, options);

  const validation = await validateServer1mcpUrl(serverUrl.toString());
  if (!validation.valid) {
    throw new RunCommandInputError(validation.error || 'Cannot connect to the running 1MCP server.');
  }

  const stdinText = await readStdin();
  const cachePath = getCliSessionCachePath(options['config-dir']);
  const cachedSession = await readCliSessionCache(cachePath, serverUrl.toString());

  let response = await invokeTool({
    serverUrl,
    sessionId: cachedSession?.sessionId,
    displayToolName: options.tool,
    qualifiedToolName: toolReference.qualifiedName,
    explicitArgs: options.args,
    stdinText,
    resolveTool: options.args === undefined,
  });

  if (response.retryWithFreshSession) {
    await deleteCliSessionCache(cachePath);
    response = await invokeTool({
      serverUrl,
      displayToolName: options.tool,
      qualifiedToolName: toolReference.qualifiedName,
      explicitArgs: options.args,
      stdinText,
      resolveTool: options.args === undefined,
    });
  }

  if (response.sessionId) {
    await writeCliSessionCache(cachePath, {
      sessionId: response.sessionId,
      serverUrl: serverUrl.toString(),
      savedAt: Date.now(),
      hasRestEndpoint: false,
    });
  }

  const output = formatToolCallOutput(response.rawResponse, format, maxChars);
  if ('error' in response.rawResponse) {
    process.stderr.write(`${output}\n`);
    process.exitCode = 1;
    return;
  }

  if (response.rawResponse.result.isError) {
    process.stderr.write(`${output}\n`);
    process.exitCode = 2;
    return;
  }

  if (output.length > 0) {
    process.stdout.write(`${output}\n`);
  }
}

export async function invokeTool(options: {
  serverUrl: URL;
  sessionId?: string;
  displayToolName: string;
  qualifiedToolName: string;
  explicitArgs?: string;
  stdinText?: string;
  resolveTool: boolean;
}): Promise<{
  rawResponse: JsonRpcResponse<CallToolResult>;
  sessionId?: string;
  retryWithFreshSession: boolean;
}> {
  const client = new StreamableRunClient(options.serverUrl, options.sessionId);
  await client.start();

  try {
    let tool: Tool | undefined;

    if (!options.sessionId) {
      const initializeResponse = await client.initialize();
      if ('error' in initializeResponse) {
        return {
          rawResponse: initializeResponse,
          sessionId: client.sessionId,
          retryWithFreshSession: false,
        };
      }
    }

    if (options.resolveTool) {
      const toolsResponse = await client.listTools();
      if ('error' in toolsResponse) {
        return {
          rawResponse: toolsResponse as JsonRpcErrorEnvelope,
          sessionId: client.sessionId,
          retryWithFreshSession: false,
        };
      }

      tool = findToolByQualifiedName(toolsResponse.result.tools, options.qualifiedToolName);
      if (!tool) {
        throw new RunCommandInputError(`Unknown tool: ${options.displayToolName}`);
      }
    }

    const resolvedArguments = resolveToolArguments({
      explicitArgs: options.explicitArgs,
      stdinText: options.stdinText,
      tool,
    });

    const response = await client.callTool(options.qualifiedToolName, resolvedArguments.arguments);
    return {
      rawResponse: response,
      sessionId: client.sessionId,
      retryWithFreshSession: false,
    };
  } catch (error) {
    if (error instanceof StreamableHTTPError && error.code === 404 && options.sessionId) {
      return {
        rawResponse: {
          jsonrpc: '2.0',
          id: 0,
          error: {
            code: -32004,
            message: 'Cached session expired.',
          },
        },
        retryWithFreshSession: true,
      };
    }

    throw error;
  } finally {
    await client.close();
  }
}

export function buildServerUrl(
  baseUrl: string,
  options: Pick<RunCommandOptions, 'preset' | 'filter' | 'tags' | 'tag-filter'>,
): URL {
  const serverUrl = new URL(baseUrl);

  if (options.preset) {
    serverUrl.searchParams.set('preset', options.preset);
  } else if (options['tag-filter']) {
    serverUrl.searchParams.set('tag-filter', options['tag-filter']);
  } else if (options.filter) {
    serverUrl.searchParams.set('filter', options.filter);
  } else if (options.tags && options.tags.length > 0) {
    serverUrl.searchParams.set('tags', options.tags.join(','));
  }

  return serverUrl;
}

async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString('utf8');
}

export function getCliSessionCachePath(configDir?: string): string {
  return path.join(getConfigDir(configDir), '.cli-session');
}

export async function readCliSessionCache(cachePath: string, serverUrl: string): Promise<RunSessionCache | null> {
  try {
    const raw = await readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRunSessionCache(parsed)) {
      return null;
    }

    if (parsed.serverUrl !== serverUrl) {
      return null;
    }

    if (Date.now() - parsed.savedAt > SESSION_CACHE_TTL_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function writeCliSessionCache(cachePath: string, cache: RunSessionCache): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.tmp.${process.pid}`;
  await writeFile(tempPath, JSON.stringify(cache), 'utf8');
  await rename(tempPath, cachePath);
}

export async function deleteCliSessionCache(cachePath: string): Promise<void> {
  await rm(cachePath, { force: true });
}

function isRunSessionCache(value: unknown): value is RunSessionCache {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sessionId' in value &&
    typeof value.sessionId === 'string' &&
    'serverUrl' in value &&
    typeof value.serverUrl === 'string' &&
    'savedAt' in value &&
    typeof value.savedAt === 'number' &&
    Number.isFinite(value.savedAt)
  );
}
