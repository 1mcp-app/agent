import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';

import { extractInspectToolInfo, type InspectToolInfo } from '@src/commands/inspect/inspectUtils.js';
import {
  findToolByQualifiedName,
  formatToolCallOutput,
  parseExplicitArgs,
  parseJsonObject,
  parseToolReference,
  resolveToolArguments,
  RunCommandInputError,
  type RunOutputFormat,
  validateToolArgs,
} from '@src/commands/run/runUtils.js';
import { ApiClient } from '@src/commands/shared/apiClient.js';
import { loadAuthProfile, normalizeServerUrl } from '@src/commands/shared/authProfileStore.js';
import { buildCliContext } from '@src/commands/shared/cliContext.js';
import {
  deleteCliSessionCache,
  getCliSessionCachePath,
  type JsonRpcErrorEnvelope,
  type JsonRpcResponse,
  readCliSessionCache,
  StreamableServeClient,
  writeCliSessionCache,
} from '@src/commands/shared/serveClient.js';
import { resolveServeTarget } from '@src/commands/shared/serveTargetResolver.js';
import { API_INSPECT_ENDPOINT, API_TOOL_INVOCATIONS_ENDPOINT } from '@src/constants/api.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import type { ContextData } from '@src/types/context.js';
import { stripMcpSuffix } from '@src/utils/urlUtils.js';

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

interface ApiInspectToolResult {
  kind: 'tool';
  server: string;
  tool: string;
  qualifiedName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
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
  const format = options.raw ? 'json' : options.format || 'toon';
  const maxChars = options['max-chars'] ?? 2000;
  const [{ projectConfig, discoveredUrl, serverPid, serverUrl }, stdinText] = await Promise.all([
    resolveServeTarget(options),
    readStdin(),
  ]);
  const cachePath = getCliSessionCachePath({
    cachePathTemplate: options['cli-session-cache-path'],
    serverPid,
    serverUrl: serverUrl.toString(),
  });
  const cachedSession = await readCliSessionCache(cachePath, serverUrl.toString());
  const baseUrl = stripMcpSuffix(discoveredUrl);
  const authProfile = await loadAuthProfile(options['config-dir'], normalizeServerUrl(baseUrl));
  const apiClient = new ApiClient({ baseUrl, bearerToken: authProfile?.token });
  let cachedRestEndpointSupport = cachedSession?.hasRestEndpoint;

  // REST-first path: skip MCP handshake when we know the server supports it,
  // or probe once on first run. Fall back to MCP on missing/unsupported/upstream errors.
  const canTryRest = cachedSession?.hasRestEndpoint !== false;
  const needsSchemaForStdin = options.args === undefined && stdinText !== undefined;
  const needsSchemaForValidation = options.args !== undefined;

  if (canTryRest) {
    const restArgs =
      options.args !== undefined
        ? parseExplicitArgs(options.args)
        : stdinText !== undefined
          ? parseJsonObject(stdinText)
          : {};

    const toolInfo =
      (needsSchemaForStdin && restArgs === null) || needsSchemaForValidation
        ? await fetchToolInfoFromApi(apiClient, toolReference, options.tool)
        : null;

    if (restArgs !== null || toolInfo) {
      const resolvedArguments =
        restArgs !== null
          ? restArgs
          : resolveToolArguments({
              stdinText,
              tool: toTool(toolInfo!),
            }).arguments;

      if (toolInfo) {
        const validation = validateToolArgs(
          resolvedArguments,
          toolInfo.inputSchema as Record<string, unknown>,
          options.tool,
        );
        if (!validation.valid) {
          process.stderr.write(`${validation.errorMessage}\n`);
          process.exitCode = 1;
          return;
        }
      }

      // Forward filter params (preset/tags/filter) as query params so server-side
      // filtering applies on the REST path, same as the MCP path.
      const restEndpoint = serverUrl.search
        ? `${API_TOOL_INVOCATIONS_ENDPOINT}${serverUrl.search}`
        : API_TOOL_INVOCATIONS_ENDPOINT;

      const apiResponse = await apiClient.post<{
        result: CallToolResult;
        server: string;
        tool: string;
        error?: { type: string; message: string };
      }>(restEndpoint, { tool: options.tool, args: resolvedArguments });

      const shouldFallbackToMcp = shouldFallbackToMcpForRest(apiResponse.status, apiResponse.error);
      const shouldPersistRestDisabled = shouldPersistRestSupportDisabled(apiResponse.status, apiResponse.error);

      if (!shouldFallbackToMcp) {
        await writeCliSessionCache(cachePath, {
          sessionId: apiResponse.sessionId ?? cachedSession?.sessionId ?? 'rest',
          serverUrl: serverUrl.toString(),
          savedAt: Date.now(),
          hasRestEndpoint: true,
        });
        cachedRestEndpointSupport = true;

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

      if (shouldPersistRestDisabled) {
        await writeCliSessionCache(cachePath, {
          sessionId: cachedSession?.sessionId ?? 'mcp',
          serverUrl: serverUrl.toString(),
          savedAt: Date.now(),
          hasRestEndpoint: false,
        });
        cachedRestEndpointSupport = false;
      }
    }
  }

  const runContext = buildCliContext({
    projectConfig,
    transportType: 'run',
    version: 'run',
  });

  let response = await invokeTool({
    serverUrl,
    sessionId: cachedSession?.sessionId,
    bearerToken: authProfile?.token,
    displayToolName: options.tool,
    qualifiedToolName: toolReference.qualifiedName,
    explicitArgs: options.args,
    stdinText,
    resolveTool: options.args === undefined,
    initializeContext: runContext,
  });

  if (response.retryWithFreshSession) {
    await deleteCliSessionCache(cachePath);
    response = await invokeTool({
      serverUrl,
      bearerToken: authProfile?.token,
      displayToolName: options.tool,
      qualifiedToolName: toolReference.qualifiedName,
      explicitArgs: options.args,
      stdinText,
      resolveTool: options.args === undefined,
      initializeContext: runContext,
    });
  }

  if (response.sessionId) {
    await writeCliSessionCache(cachePath, {
      sessionId: response.sessionId,
      serverUrl: serverUrl.toString(),
      savedAt: Date.now(),
      hasRestEndpoint: cachedRestEndpointSupport,
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

function isEndpointNotFoundResponse(status: number, error?: string): boolean {
  return status === 404 && /^HTTP 404\b/u.test(error ?? '');
}

function shouldFallbackToMcpForRest(status: number, error?: string): boolean {
  return status === 405 || status === 503 || status === 0 || isEndpointNotFoundResponse(status, error);
}

function shouldPersistRestSupportDisabled(status: number, error?: string): boolean {
  return status === 405 || isEndpointNotFoundResponse(status, error);
}

async function fetchToolInfoFromApi(
  apiClient: ApiClient,
  toolReference: ReturnType<typeof parseToolReference>,
  displayToolName: string,
): Promise<InspectToolInfo | null> {
  const apiResponse = await apiClient.get<ApiInspectToolResult>(API_INSPECT_ENDPOINT, {
    target: displayToolName,
  });

  if (!apiResponse.ok || !apiResponse.data || apiResponse.data.kind !== 'tool') {
    return null;
  }

  return extractInspectToolInfo(
    {
      name: apiResponse.data.qualifiedName,
      description: apiResponse.data.description,
      inputSchema: apiResponse.data.inputSchema,
      outputSchema: apiResponse.data.outputSchema,
    } as Tool,
    toolReference,
  );
}

function toTool(toolInfo: InspectToolInfo): Tool {
  return {
    name: toolInfo.qualifiedName,
    description: toolInfo.description,
    inputSchema: toolInfo.inputSchema as Tool['inputSchema'],
    outputSchema: toolInfo.outputSchema as Tool['outputSchema'],
  };
}

export async function invokeTool(options: {
  serverUrl: URL;
  sessionId?: string;
  bearerToken?: string;
  displayToolName: string;
  qualifiedToolName: string;
  explicitArgs?: string;
  stdinText?: string;
  resolveTool: boolean;
  initializeContext?: ContextData;
}): Promise<{
  rawResponse: JsonRpcResponse<CallToolResult>;
  sessionId?: string;
  retryWithFreshSession: boolean;
}> {
  const client = new StreamableServeClient(options.serverUrl, options.sessionId, options.bearerToken);
  await client.start();

  try {
    let tool: Tool | undefined;

    if (!options.sessionId) {
      const initializeResponse = await client.initialize(options.initializeContext);
      if ('error' in initializeResponse) {
        return {
          rawResponse: initializeResponse,
          sessionId: client.sessionId,
          retryWithFreshSession: false,
        };
      }
    }

    if (options.sessionId && !options.resolveTool) {
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
        return {
          rawResponse: {
            jsonrpc: '2.0',
            id: 0,
            error: {
              code: -32004,
              message: 'Cached session missing requested tool.',
            },
          },
          retryWithFreshSession: true,
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
        if (options.sessionId) {
          return {
            rawResponse: {
              jsonrpc: '2.0',
              id: 0,
              error: {
                code: -32004,
                message: 'Cached session missing requested tool.',
              },
            },
            retryWithFreshSession: true,
          };
        }
        throw new RunCommandInputError(`Unknown tool: ${options.displayToolName}`);
      }
    }

    const resolvedArguments = resolveToolArguments({
      explicitArgs: options.explicitArgs,
      stdinText: options.stdinText,
      tool,
    });

    if (tool) {
      const validation = validateToolArgs(
        resolvedArguments.arguments,
        tool.inputSchema as Record<string, unknown>,
        options.displayToolName,
      );
      if (!validation.valid) {
        return {
          rawResponse: {
            jsonrpc: '2.0',
            id: 0,
            error: { code: -32602, message: validation.errorMessage },
          },
          sessionId: client.sessionId,
          retryWithFreshSession: false,
        };
      }
    }

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
