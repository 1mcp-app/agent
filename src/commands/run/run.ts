import { StreamableHTTPError } from '@src/sdk/legacy/client/streamableHttp.js';
import { type CallToolResult, type Tool } from '@src/sdk/legacy/types.js';

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
import {
  attachReusableClientSurface,
  type ClientSurfaceAttachmentContext,
  type ClientSurfaceRestResponse,
  formatClientSurfaceAuthRequiredMessage,
} from '@src/commands/shared/clientSurfaceAttachment.js';
import { buildFilterSelectionQuery } from '@src/commands/shared/filterSelectionQuery.js';
import {
  type ApiInspectServerResult,
  inspectServerResultSchema,
  inspectToolResultSchema,
} from '@src/commands/shared/inspectApiSchemas.js';
import {
  type JsonRpcErrorEnvelope,
  type JsonRpcResponse,
  StreamableServeClient,
} from '@src/commands/shared/serveClient.js';
import { API_INSPECT_ENDPOINT, API_TOOL_INVOCATIONS_ENDPOINT } from '@src/constants/api.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import type { ContextData } from '@src/types/context.js';

export interface RunCommandOptions extends GlobalOptions {
  url?: string;
  context?: string;
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
  getCliSessionContextHash,
  readCliSessionCache,
  SESSION_CACHE_TTL_MS,
  writeCliSessionCache,
} from '@src/commands/shared/serveClient.js';

interface RunAttachmentValue {
  response: Awaited<ReturnType<typeof invokeTool>>;
}

export async function runCommand(options: RunCommandOptions): Promise<void> {
  const toolReference = parseToolReference(options.tool);
  const format = options.raw ? 'json' : options.format || 'toon';
  const maxChars = options['max-chars'] ?? 2000;
  const stdinPromise = options.args === undefined ? readStdin() : Promise.resolve(undefined);
  const attachment = await attachReusableClientSurface<RunCommandOptions, RunAttachmentValue>({
    clientSurface: 'run',
    version: 'run',
    options,
    alwaysTryRest: true,
    rest: async (context) => tryRunRest(context, options, toolReference, await stdinPromise),
    mcp: async (context) => {
      const stdinText = await stdinPromise;
      const response = await invokeTool({
        serverUrl: context.serverUrl,
        sessionId: context.sessionId,
        bearerToken: context.bearerToken,
        displayToolName: options.tool,
        qualifiedToolName: toolReference.qualifiedName,
        explicitArgs: options.args,
        stdinText,
        resolveTool: options.args === undefined,
        initializeContext: context.context,
        initializeContextProof: context.contextProof,
        sendInitialize: context.sendInitialize,
      });
      return response.retryWithFreshSession
        ? { status: 'stale_session' as const, observed: response }
        : { status: 'success' as const, sessionId: response.sessionId, value: { response } };
    },
  });

  if (attachment.status !== 'success') {
    process.stderr.write(`${attachment.message}\n`);
    process.exitCode = 1;
    return;
  }

  const { response } = attachment.value;

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

async function tryRunRest(
  context: ClientSurfaceAttachmentContext<RunCommandOptions>,
  options: RunCommandOptions,
  toolReference: ReturnType<typeof parseToolReference>,
  stdinText?: string,
): Promise<ClientSurfaceRestResponse<RunAttachmentValue>> {
  const apiClient = new ApiClient({
    baseUrl: context.baseUrl,
    bearerToken: context.bearerToken,
    sessionId: context.sessionId,
    context: context.context,
    contextProof: context.contextProof,
  });
  const needsSchemaForStdin = options.args === undefined && stdinText !== undefined;
  const needsSchemaForValidation = options.args !== undefined;
  const restArgs =
    options.args !== undefined
      ? parseExplicitArgs(options.args)
      : stdinText !== undefined
        ? parseJsonObject(stdinText)
        : {};

  // Parse explicit input before any network activity so invalid command input
  // remains a local validation error even while a backend is starting.
  const statusResponse = await checkServerStatus(apiClient, toolReference.serverName, context.options);
  if (statusResponse) {
    return statusResponse;
  }

  const toolInfo =
    (needsSchemaForStdin && restArgs === null) || needsSchemaForValidation
      ? await fetchToolInfoFromApi(apiClient, toolReference, options.tool, context.options)
      : null;

  if (restArgs === null && !toolInfo) {
    return { status: 'fallback', reason: 'mcp_required' };
  }

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
      return {
        status: 'success',
        value: {
          response: {
            rawResponse: {
              jsonrpc: '2.0',
              id: 0,
              error: { code: -32602, message: validation.errorMessage },
            },
            retryWithFreshSession: false,
          },
        },
      };
    }
  }

  const restEndpoint = context.serverUrl.search
    ? `${API_TOOL_INVOCATIONS_ENDPOINT}${context.serverUrl.search}`
    : API_TOOL_INVOCATIONS_ENDPOINT;

  const apiResponse = await apiClient.post<{
    result: CallToolResult;
    server: string;
    tool: string;
    error?: { type: string; message: string };
  }>(restEndpoint, {
    tool: options.tool,
    args: resolvedArguments,
    _meta: {
      context: context.context,
      ...(context.contextProof ? { contextProof: context.contextProof } : {}),
    },
  });

  if (apiResponse.status === 401 || apiResponse.status === 403) {
    return {
      status: 'auth_required',
      message: formatClientSurfaceAuthRequiredMessage(context),
    };
  }

  if (shouldFallbackToMcpForRest(apiResponse.status, apiResponse.error)) {
    return {
      status: 'fallback',
      reason: shouldPersistRestSupportDisabled(apiResponse.status, apiResponse.error)
        ? 'endpoint_missing'
        : 'transient_failure',
    };
  }

  const rawResponse: JsonRpcResponse<CallToolResult> =
    apiResponse.ok && apiResponse.data
      ? { jsonrpc: '2.0', id: 0, result: apiResponse.data.result }
      : {
          jsonrpc: '2.0',
          id: 0,
          error: { code: -32000, message: apiResponse.error ?? `HTTP ${apiResponse.status}` },
        };

  return {
    status: 'success',
    sessionId: apiResponse.sessionId ?? context.requestSessionId,
    value: {
      response: {
        rawResponse,
        sessionId: apiResponse.sessionId ?? context.requestSessionId,
        retryWithFreshSession: false,
      },
    },
  };
}

async function checkServerStatus(
  apiClient: ApiClient,
  serverName: string,
  options: RunCommandOptions,
): Promise<ClientSurfaceRestResponse<RunAttachmentValue> | undefined> {
  const apiResponse = await apiClient.get<unknown>(API_INSPECT_ENDPOINT, {
    ...buildFilterSelectionQuery(options),
    target: serverName,
  });

  if (apiResponse.ok) {
    const parsed = inspectServerResultSchema.safeParse(apiResponse.data);
    if (!parsed.success) {
      return { status: 'error', message: `Invalid response from ${API_INSPECT_ENDPOINT}.` };
    }
    const server = parsed.data;
    if (server.status === 'connected' && server.available) {
      return undefined;
    }

    if (server.status === 'pending' || server.status === 'loading') {
      return statusErrorResponse(
        'server_loading',
        `Server '${serverName}' is ${server.status}. Wait for it to become connected.`,
        `1mcp wait ${serverName}`,
        server,
      );
    }

    if (server.status === 'connected' && !server.available) {
      return statusErrorResponse(
        'server_loading',
        `Server '${serverName}' is connected but not yet available. Wait for it to finish loading.`,
        `1mcp wait ${serverName}`,
        server,
      );
    }

    if (server.status === 'awaiting_oauth') {
      const guidance = server.authorizationUrl
        ? `Complete OAuth authorization at ${server.authorizationUrl}.`
        : `Complete OAuth authorization for '${serverName}'.`;
      return statusErrorResponse('server_awaiting_oauth', guidance, `1mcp inspect ${serverName}`, server);
    }

    return statusErrorResponse(
      'server_unavailable',
      `Server '${serverName}' is ${server.status}${server.error ? `: ${server.error}` : ''}.`,
      `1mcp mcp restart ${serverName}`,
      server,
    );
  }

  if (apiResponse.status === 401 || apiResponse.status === 403) {
    return {
      status: 'auth_required',
      message: 'Authentication required before checking server status.',
    };
  }

  // A text-only 404 identifies pre-status runtimes. Retain the established
  // REST-to-MCP compatibility fallback only when no status endpoint exists.
  if (isEndpointNotFoundResponse(apiResponse.status, apiResponse.error)) {
    return { status: 'fallback', reason: 'endpoint_missing' };
  }

  return {
    status: 'error',
    message: apiResponse.error ?? `Unable to check status for server '${serverName}'.`,
  };
}

function statusErrorResponse(
  code: 'server_loading' | 'server_unavailable' | 'server_awaiting_oauth',
  message: string,
  recoveryCommand: string,
  details: ApiInspectServerResult,
): ClientSurfaceRestResponse<RunAttachmentValue> {
  const formattedMessage = `${code}: ${message} Recovery: ${recoveryCommand}`;
  return {
    status: 'success',
    value: {
      response: {
        rawResponse: {
          jsonrpc: '2.0',
          id: 0,
          error: {
            code: -32010,
            message: formattedMessage,
            data: { code, recoveryCommand, details },
          },
        },
        retryWithFreshSession: false,
      },
    },
  };
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
  options: RunCommandOptions,
): Promise<InspectToolInfo | null> {
  const apiResponse = await apiClient.get<unknown>(API_INSPECT_ENDPOINT, {
    ...buildFilterSelectionQuery(options),
    target: displayToolName,
  });

  if (!apiResponse.ok) {
    if (!apiResponse.ok && apiResponse.status !== 404) {
      logger.debug('fetchToolInfoFromApi: unexpected response status', { status: apiResponse.status });
    }
    return null;
  }
  const parsed = inspectToolResultSchema.safeParse(apiResponse.data);
  if (!parsed.success) {
    logger.debug('fetchToolInfoFromApi: invalid inspect response');
    return null;
  }

  return extractInspectToolInfo(
    {
      name: parsed.data.qualifiedName,
      description: parsed.data.description,
      inputSchema: parsed.data.inputSchema,
      outputSchema: parsed.data.outputSchema,
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
  initializeContextProof?: import('@src/core/context/templateContextTrust.js').TemplateContextProof;
  sendInitialize?: boolean;
}): Promise<{
  rawResponse: JsonRpcResponse<CallToolResult>;
  sessionId?: string;
  retryWithFreshSession: boolean;
}> {
  const client = new StreamableServeClient(options.serverUrl, options.sessionId, options.bearerToken);
  await client.start();

  try {
    let tool: Tool | undefined;
    const shouldSendInitialize = options.sendInitialize ?? !options.sessionId;

    if (shouldSendInitialize) {
      const initializeResponse = await client.initialize(options.initializeContext, options.initializeContextProof);
      if ('error' in initializeResponse) {
        return {
          rawResponse: initializeResponse,
          sessionId: client.sessionId,
          retryWithFreshSession: false,
        };
      }
    }

    if (options.sessionId && !shouldSendInitialize && !options.resolveTool) {
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
  } finally {
    try {
      await client.close();
    } catch (closeError) {
      logger.debug('CLI session cleanup close failed (best-effort):', { error: closeError });
    }
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
