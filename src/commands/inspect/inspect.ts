import path from 'node:path';

import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { findToolByQualifiedName } from '@src/commands/run/runUtils.js';
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
import { loadProjectConfig, normalizeTags } from '@src/config/projectConfigLoader.js';
import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { API_INSPECT_ENDPOINT } from '@src/constants/api.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import type { ContextData } from '@src/types/context.js';
import { discoverServerWithPidFile, validateServer1mcpUrl } from '@src/utils/validation/urlDetection.js';

import {
  extractInspectServerInfo,
  extractInspectToolInfo,
  formatInspectOutput,
  InspectCommandError,
  type InspectOutputFormat,
  type InspectResult,
  type InspectServerInfo,
  parseInspectTarget,
} from './inspectUtils.js';

export interface InspectCommandOptions extends GlobalOptions {
  url?: string;
  preset?: string;
  filter?: string;
  tags?: string[];
  'tag-filter'?: string;
  format?: InspectOutputFormat;
  target?: string;
  all?: boolean;
  limit?: number;
  cursor?: string;
}

interface GetInspectResultOptions {
  includeServerInstructions?: boolean;
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

/** Strip /mcp suffix to get the base URL for /api/* calls */
function toBaseUrl(mcpUrl: string): string {
  return mcpUrl.replace(/\/mcp$/, '');
}

/** Build query params for /api/inspect */
function buildInspectQuery(
  options: Pick<InspectCommandOptions, 'preset' | 'filter' | 'tags' | 'tag-filter' | 'all' | 'limit' | 'cursor'>,
  target?: string,
): Record<string, string> {
  const query: Record<string, string> = {};
  if (target) query.target = target;
  if (options.preset) query.preset = options.preset;
  else if (options['tag-filter']) query['tag-filter'] = options['tag-filter'];
  else if (options.filter) query.filter = options.filter;
  else if (options.tags && options.tags.length > 0) query.tags = options.tags.join(',');
  if (options.all) query.all = 'true';
  else if (options.limit && options.limit !== 20) query.limit = String(options.limit);
  if (options.cursor) query.cursor = options.cursor;
  return query;
}

function buildInspectContext(projectConfig?: Awaited<ReturnType<typeof loadProjectConfig>>): ContextData {
  const cwd = process.cwd();
  const projectName = path.basename(cwd) || 'unknown';

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
    version: 'inspect',
    transport: {
      type: 'inspect',
    },
  };

  if (projectConfig?.context?.environment) {
    context.project.environment = projectConfig.context.environment;
  }

  if (projectConfig?.context?.envPrefixes?.length) {
    for (const prefix of projectConfig.context.envPrefixes) {
      if (!prefix) continue;
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

function isApiInspectToolResult(value: unknown): value is ApiInspectToolResult {
  return (
    typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'tool' && 'inputSchema' in value
  );
}

function stripServerInstructions(result: InspectServerInfo): InspectServerInfo {
  const { instructions: _instructions, ...serverResult } = result;
  return serverResult;
}

function maybeStripServerInstructions(result: InspectResult): InspectResult {
  if (result.kind !== 'server') {
    return result;
  }

  return stripServerInstructions(result);
}

function stripListInstructions(result: InspectResult): InspectResult {
  if (result.kind !== 'servers') {
    return result;
  }

  const { instructions: _instructions, ...serversResult } = result;
  return serversResult;
}

function hasServerTools(tools: Tool[], serverName: string): boolean {
  return tools.some((tool) => {
    const [toolServerName] = tool.name.split(MCP_URI_SEPARATOR);
    return toolServerName === serverName;
  });
}

export async function getInspectResult(
  options: InspectCommandOptions,
  resultOptions: GetInspectResultOptions = {},
): Promise<InspectResult> {
  const includeServerInstructions = resultOptions.includeServerInstructions ?? true;

  // Load .1mcprc with CLI > .1mcprc > defaults precedence
  const projectConfig = await loadProjectConfig();
  const mergedOptions: InspectCommandOptions = {
    ...options,
    preset: options.preset || projectConfig?.preset,
    filter: options.filter || projectConfig?.filter,
    tags: options.tags || normalizeTags(projectConfig?.tags),
  };

  const target = parseInspectTarget(mergedOptions.target);

  const { url: discoveredUrl, pid: serverPid } = await discoverServerWithPidFile(
    mergedOptions['config-dir'],
    mergedOptions.url,
  );
  const serverUrl = buildServerUrl(discoveredUrl, mergedOptions);
  const baseUrl = toBaseUrl(discoveredUrl);

  const validation = await validateServer1mcpUrl(discoveredUrl);
  if (!validation.valid) {
    throw new InspectCommandError(validation.error || 'Cannot connect to the running 1MCP server.');
  }

  // Load auth profile for this server (if any)
  const authProfile = await loadAuthProfile(mergedOptions['config-dir'], normalizeServerUrl(baseUrl));
  const cachePath = getCliSessionCachePath({
    cachePathTemplate: mergedOptions['cli-session-cache-path'],
    serverPid,
    serverUrl: serverUrl.toString(),
  });
  const cachedSession = await readCliSessionCache(cachePath, serverUrl.toString());
  const inspectContext = buildInspectContext(projectConfig);

  // Try /api/inspect first (fast path)
  const apiClient = new ApiClient({ baseUrl, bearerToken: authProfile?.token });
  const query = buildInspectQuery(mergedOptions, mergedOptions.target);
  const apiResponse = await apiClient.get<unknown>(API_INSPECT_ENDPOINT, query);

  if (apiResponse.ok && apiResponse.data !== undefined) {
    let result = apiResponse.data as Parameters<typeof formatInspectOutput>[0];

    if (target.kind === 'tool' && isApiInspectToolResult(result)) {
      result = extractInspectToolInfo(
        {
          name: result.qualifiedName,
          description: result.description,
          inputSchema: result.inputSchema,
          outputSchema: result.outputSchema,
        } as Tool,
        target.reference,
      );
    }

    if (!includeServerInstructions) {
      result = maybeStripServerInstructions(result);
      result = stripListInstructions(result);
    }

    // Mark that this server has the REST endpoint
    await writeCliSessionCache(cachePath, {
      sessionId: cachedSession?.sessionId ?? '',
      serverUrl: serverUrl.toString(),
      savedAt: Date.now(),
      hasRestEndpoint: true,
    });
    return result;
  }

  // Fall back to MCP protocol for servers without /api/inspect (404) or for tool targets
  if (apiResponse.status === 401 || apiResponse.status === 403) {
    throw new InspectCommandError(
      `Authentication required. Run: 1mcp auth login --url ${baseUrl} --token <your-token>`,
    );
  }

  const canFallbackToMcp =
    apiResponse.status === 404 ||
    apiResponse.status === 405 ||
    apiResponse.status === 0 ||
    ((target.kind === 'server' || target.kind === 'tool') && apiResponse.status === 503);

  if (!canFallbackToMcp) {
    // Non-fallback error from the API — surface it
    throw new InspectCommandError(apiResponse.error || `Server returned HTTP ${apiResponse.status}`);
  }

  // MCP fallback: only works for server/tool targets (not the all-servers listing)
  if (target.kind === 'all') {
    throw new InspectCommandError(
      'Cannot list all servers: the running 1MCP server does not support the /api/inspect endpoint.',
    );
  }

  let response = await inspectTools({
    serverUrl,
    sessionId: cachedSession?.sessionId,
    bearerToken: authProfile?.token,
    context: inspectContext,
  });

  const shouldRetryWithFreshSession =
    response.retryWithFreshSession ||
    (!!cachedSession?.sessionId &&
      ((target.kind === 'server' && !hasServerTools(response.tools, target.serverName)) ||
        (target.kind === 'tool' && !findToolByQualifiedName(response.tools, target.reference.qualifiedName))));

  if (shouldRetryWithFreshSession) {
    await deleteCliSessionCache(cachePath);
    response = await inspectTools({ serverUrl, bearerToken: authProfile?.token, context: inspectContext });
  }

  if (response.sessionId) {
    await writeCliSessionCache(cachePath, {
      sessionId: response.sessionId,
      serverUrl: serverUrl.toString(),
      savedAt: Date.now(),
      hasRestEndpoint: false,
    });
  }

  let result: Parameters<typeof formatInspectOutput>[0];

  if (target.kind === 'tool') {
    result = extractInspectToolInfo(
      findTool(response.tools, target.reference.qualifiedName, mergedOptions.target!),
      target.reference,
      Boolean(cachedSession?.sessionId),
    );
  } else {
    result = extractInspectServerInfo(target.serverName, response.tools, Boolean(cachedSession?.sessionId));
    if (!includeServerInstructions) {
      result = stripServerInstructions(result);
    }
  }

  return result;
}

export async function inspectCommand(options: InspectCommandOptions): Promise<void> {
  const format = options.format || 'toon';
  const result = await getInspectResult(options, { includeServerInstructions: false });
  const output = formatInspectOutput(result, format);
  if (output.length > 0) {
    process.stdout.write(`${output}\n`);
  }
}

export async function inspectTools(options: {
  serverUrl: URL;
  sessionId?: string;
  bearerToken?: string;
  context?: ContextData;
}): Promise<{
  rawResponse: JsonRpcResponse<unknown>;
  tools: Tool[];
  sessionId?: string;
  instructions?: string | null;
  retryWithFreshSession: boolean;
}> {
  const client = new StreamableServeClient(options.serverUrl, options.sessionId, options.bearerToken);
  await client.start();

  try {
    if (!options.sessionId) {
      const initializeResponse = await client.initialize(options.context);
      if ('error' in initializeResponse) {
        return {
          rawResponse: initializeResponse,
          tools: [],
          sessionId: client.sessionId,
          instructions: undefined,
          retryWithFreshSession: false,
        };
      }

      const response = await client.listTools();
      if ('error' in response) {
        return {
          rawResponse: response as JsonRpcErrorEnvelope,
          tools: [],
          sessionId: client.sessionId,
          instructions: initializeResponse.result.instructions ?? null,
          retryWithFreshSession: false,
        };
      }

      return {
        rawResponse: response,
        tools: response.result.tools,
        sessionId: client.sessionId,
        instructions: initializeResponse.result.instructions ?? null,
        retryWithFreshSession: false,
      };
    }

    const response = await client.listTools();
    if ('error' in response) {
      return {
        rawResponse: response as JsonRpcErrorEnvelope,
        tools: [],
        sessionId: client.sessionId,
        instructions: undefined,
        retryWithFreshSession: false,
      };
    }

    return {
      rawResponse: response,
      tools: response.result.tools,
      sessionId: client.sessionId,
      instructions: undefined,
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
        tools: [],
        instructions: undefined,
        retryWithFreshSession: true,
      };
    }

    throw error;
  }
}

function findTool(tools: Tool[], qualifiedToolName: string, displayToolName: string): Tool {
  const tool = findToolByQualifiedName(tools, qualifiedToolName);
  if (!tool) {
    throw new InspectCommandError(`Tool not found: ${displayToolName}`);
  }

  return tool;
}
