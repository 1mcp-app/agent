import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  findToolByQualifiedName,
  formatToolCallOutput,
  parseToolReference,
  resolveToolArguments,
  RunCommandInputError,
  type RunOutputFormat,
} from '@src/commands/run/runUtils.js';
import { ApiClient } from '@src/commands/shared/apiClient.js';
import { loadAuthProfile, normalizeServerUrl } from '@src/commands/shared/authProfileStore.js';
import {
  buildServerUrl,
  deleteCliSessionCache,
  getCliSessionCachePath,
  type JsonRpcErrorEnvelope,
  type JsonRpcResponse,
  readCliSessionCache,
  StreamableServeClient,
  writeCliSessionCache,
} from '@src/commands/shared/serveClient.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import { discoverServerWithPidFile, validateServer1mcpUrl } from '@src/utils/validation/urlDetection.js';

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

export {
  buildServerUrl,
  deleteCliSessionCache,
  getCliSessionCachePath,
  readCliSessionCache,
  SESSION_CACHE_TTL_MS,
  writeCliSessionCache,
} from '@src/commands/shared/serveClient.js';

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

  // REST-first path: skip MCP handshake when we know the server supports it,
  // or probe once on first run. Fall back to MCP on 404/405/network errors.
  const canTryRest = cachedSession?.hasRestEndpoint !== false;
  const needsSchemaForStdin = options.args === undefined && stdinText !== undefined;

  if (canTryRest && !needsSchemaForStdin) {
    const baseUrl = discoveredUrl.replace(/\/mcp$/, '');
    const authProfile = await loadAuthProfile(options['config-dir'], normalizeServerUrl(baseUrl));
    const apiClient = new ApiClient({ baseUrl, bearerToken: authProfile?.token });

    const restArgs =
      options.args !== undefined
        ? (JSON.parse(options.args) as Record<string, unknown>)
        : stdinText !== undefined
          ? tryParseJsonObject(stdinText)
          : {};

    if (restArgs !== null) {
      const apiResponse = await apiClient.post<{
        result: CallToolResult;
        server: string;
        tool: string;
        error?: { type: string; message: string };
      }>('/api/tool-invocations', { tool: options.tool, args: restArgs ?? {} });

      const isFallbackStatus =
        apiResponse.status === 404 ||
        apiResponse.status === 405 ||
        apiResponse.status === 503 ||
        apiResponse.status === 0;

      if (!isFallbackStatus) {
        // REST endpoint exists — cache the result
        if (cachedSession) {
          await writeCliSessionCache(cachePath, { ...cachedSession, hasRestEndpoint: true });
        }

        let rawResponse: JsonRpcResponse<CallToolResult>;
        if (apiResponse.ok && apiResponse.data) {
          rawResponse = { jsonrpc: '2.0', id: 0, result: apiResponse.data.result };
        } else {
          rawResponse = {
            jsonrpc: '2.0',
            id: 0,
            error: { code: -32000, message: apiResponse.error ?? `HTTP ${apiResponse.status}` },
          };
        }

        const output = formatToolCallOutput(rawResponse, format, maxChars);
        if ('error' in rawResponse) {
          process.stderr.write(`${output}\n`);
          process.exitCode = 1;
          return;
        }
        if (rawResponse.result.isError) {
          process.stderr.write(`${output}\n`);
          process.exitCode = 2;
          return;
        }
        if (output.length > 0) {
          process.stdout.write(`${output}\n`);
        }
        return;
      }

      // 404/405/0 → server doesn't have REST endpoint, cache that and fall through to MCP
      if (cachedSession) {
        await writeCliSessionCache(cachePath, { ...cachedSession, hasRestEndpoint: false });
      }
    }
  }

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
  const client = new StreamableServeClient(options.serverUrl, options.sessionId);
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

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
