import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  type CallToolResult,
  type JSONRPCMessage,
  LATEST_PROTOCOL_VERSION,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { getConfigDir, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@src/constants.js';
import type { ContextData } from '@src/types/context.js';

export interface JsonRpcSuccessEnvelope<Result> {
  jsonrpc: '2.0';
  id: number;
  result: Result;
}

export interface JsonRpcErrorEnvelope {
  jsonrpc: '2.0';
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse<Result> = JsonRpcSuccessEnvelope<Result> | JsonRpcErrorEnvelope;

export interface ListToolsResult {
  tools: Tool[];
  nextCursor?: string;
}

export interface InitializeResult {
  protocolVersion: string;
  instructions?: string;
}

export interface CliSessionCache {
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

export interface ServeUrlOptions {
  preset?: string;
  filter?: string;
  tags?: string[];
  'tag-filter'?: string;
}

export const SESSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class StreamableServeClient {
  private readonly transport: StreamableHTTPClientTransport;
  private readonly pendingRequests = new Map<number, PendingRequest<unknown>>();
  private nextId = 1;

  constructor(serverUrl: URL, sessionId?: string, bearerToken?: string) {
    const headers: Record<string, string> = {
      'User-Agent': `1MCP/${MCP_SERVER_VERSION}`,
    };

    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    this.transport = new StreamableHTTPClientTransport(serverUrl, {
      sessionId,
      requestInit: {
        headers,
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

  async initialize(context?: ContextData): Promise<JsonRpcResponse<InitializeResult>> {
    const response = await this.sendRequest<InitializeResult>('initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
      },
      ...(context
        ? {
            _meta: {
              context,
            },
          }
        : {}),
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

export function buildServerUrl(baseUrl: string, options: ServeUrlOptions): URL {
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

export function getCliSessionCachePath(configDir?: string): string {
  return path.join(getConfigDir(configDir), '.cli-session');
}

export async function readCliSessionCache(cachePath: string, serverUrl: string): Promise<CliSessionCache | null> {
  try {
    const raw = await readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isCliSessionCache(parsed)) {
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

export async function writeCliSessionCache(cachePath: string, cache: CliSessionCache): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.tmp.${process.pid}`;
  await writeFile(tempPath, JSON.stringify(cache), 'utf8');
  await rename(tempPath, cachePath);
}

export async function deleteCliSessionCache(cachePath: string): Promise<void> {
  await rm(cachePath, { force: true });
}

function isCliSessionCache(value: unknown): value is CliSessionCache {
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
