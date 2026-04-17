import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';

import { extractInspectToolInfo, type InspectToolInfo } from '@src/commands/inspect/inspectUtils.js';
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
import { loadProjectConfig } from '@src/config/projectConfigLoader.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import type { ContextData } from '@src/types/context.js';
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
  const format = options.raw ? 'json' : options.format || (process.stdout.isTTY ? 'text' : 'json');
  const maxChars = options['max-chars'] ?? 2000;

  const { url: discoveredUrl, pid: serverPid } = await discoverServerWithPidFile(options['config-dir'], options.url);
  const serverUrl = buildServerUrl(discoveredUrl, options);

  const validation = await validateServer1mcpUrl(serverUrl.toString());
  if (!validation.valid) {
    throw new RunCommandInputError(validation.error || 'Cannot connect to the running 1MCP server.');
  }

  const stdinText = await readStdin();
  const cachePath = getCliSessionCachePath({
    cachePathTemplate: options['cli-session-cache-path'],
    serverPid,
    serverUrl: serverUrl.toString(),
  });
  const cachedSession = await readCliSessionCache(cachePath, serverUrl.toString());
  const baseUrl = discoveredUrl.replace(/\/mcp$/, '');
  const authProfile = await loadAuthProfile(options['config-dir'], normalizeServerUrl(baseUrl));
  const apiClient = new ApiClient({ baseUrl, bearerToken: authProfile?.token });

  // REST-first path: skip MCP handshake when we know the server supports it,
  // or probe once on first run. Fall back to MCP on missing/unsupported/upstream errors.
  const canTryRest = cachedSession?.hasRestEndpoint !== false;
  const needsSchemaForStdin = options.args === undefined && stdinText !== undefined;

  if (canTryRest) {
    const restArgs =
      options.args !== undefined
        ? (JSON.parse(options.args) as Record<string, unknown>)
        : stdinText !== undefined
          ? tryParseJsonObject(stdinText)
          : {};

    const toolInfo =
      needsSchemaForStdin && restArgs === null
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
      const apiResponse = await apiClient.post<{
        result: CallToolResult;
        server: string;
        tool: string;
        error?: { type: string; message: string };
      }>('/api/tool-invocations', { tool: options.tool, args: resolvedArguments });

      const isFallbackStatus =
        apiResponse.status === 405 ||
        apiResponse.status === 503 ||
        apiResponse.status === 0 ||
        (apiResponse.status === 404 && apiResponse.error === 'HTTP 404');

      if (!isFallbackStatus) {
        await writeCliSessionCache(cachePath, {
          sessionId: cachedSession?.sessionId ?? 'rest',
          serverUrl: serverUrl.toString(),
          savedAt: Date.now(),
          hasRestEndpoint: true,
        });

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

      // Missing/unsupported/upstream REST responses → cache that and fall through to MCP
      await writeCliSessionCache(cachePath, {
        sessionId: cachedSession?.sessionId ?? 'mcp',
        serverUrl: serverUrl.toString(),
        savedAt: Date.now(),
        hasRestEndpoint: false,
      });
    }
  }

  const projectConfig = await loadProjectConfig();
  const runContext = buildRunContext(projectConfig);

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

async function fetchToolInfoFromApi(
  apiClient: ApiClient,
  toolReference: ReturnType<typeof parseToolReference>,
  displayToolName: string,
): Promise<InspectToolInfo | null> {
  const apiResponse = await apiClient.get<ApiInspectToolResult>('/api/inspect', {
    target: displayToolName,
  });

  if (!apiResponse.ok || !apiResponse.data || apiResponse.data.kind !== 'tool') {
    if (apiResponse.status === 404 || apiResponse.status === 405 || apiResponse.status === 0) {
      return null;
    }

    throw new RunCommandInputError(apiResponse.error || `Unable to load schema for ${displayToolName}`);
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

function buildRunContext(projectConfig?: Awaited<ReturnType<typeof loadProjectConfig>>): ContextData {
  const cwd = process.cwd();
  const projectName = cwd.split('/').pop() || 'unknown';

  const context: ContextData = {
    project: {
      path: cwd,
      name: projectName,
      environment: process.env.NODE_ENV || 'development',
      ...(projectConfig?.context
        ? {
            custom: {
              projectId: projectConfig.context.projectId,
              team: projectConfig.context.team,
              ...projectConfig.context.custom,
            },
          }
        : {}),
    },
    user: {
      username: process.env.USER || process.env.USERNAME || 'unknown',
      home: process.env.HOME || process.env.USERPROFILE || '',
    },
    environment: {
      variables: {
        NODE_VERSION: process.version,
        PLATFORM: process.platform,
        ARCH: process.arch,
        PWD: cwd,
      },
    },
    timestamp: new Date().toISOString(),
    version: 'run',
    transport: {
      type: 'run',
    },
  };

  if (projectConfig?.context?.environment) {
    context.project.environment = projectConfig.context.environment;
  }

  if (projectConfig?.context?.envPrefixes?.length) {
    for (const prefix of projectConfig.context.envPrefixes) {
      for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith(prefix) && value) {
          context.environment.variables = {
            ...context.environment.variables,
            [key]: value,
          };
        }
      }
    }
  }

  return context;
}
