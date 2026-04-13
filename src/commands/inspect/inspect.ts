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
import type { GlobalOptions } from '@src/globalOptions.js';
import type { ContextData } from '@src/types/context.js';
import { discoverServerWithPidFile, validateServer1mcpUrl } from '@src/utils/validation/urlDetection.js';

import {
  extractInspectServerInfo,
  extractInspectToolInfo,
  formatInspectOutput,
  InspectCommandError,
  type InspectOutputFormat,
  type InspectServersInfo,
  type InspectServerSummary,
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

function mergeContextDiscoveredServers(
  result: InspectServersInfo,
  tools: Tool[],
  fromCache: boolean,
): InspectServersInfo {
  const mergedServers = new Map<string, InspectServerSummary>(result.servers.map((server) => [server.server, server]));
  const toolCounts = new Map<string, number>();

  for (const tool of tools) {
    const [serverName] = tool.name.split('_1mcp_');
    if (!serverName || serverName === '1mcp') {
      continue;
    }
    toolCounts.set(serverName, (toolCounts.get(serverName) ?? 0) + 1);
  }

  for (const [serverName, toolCount] of toolCounts) {
    const existing = mergedServers.get(serverName);
    if (existing) {
      existing.toolCount = Math.max(existing.toolCount, toolCount);
      if (!existing.available) {
        existing.available = true;
        existing.status = 'connected';
      }
      continue;
    }

    mergedServers.set(serverName, {
      server: serverName,
      type: 'template',
      status: 'connected',
      available: true,
      toolCount,
      hasInstructions: !fromCache,
    });
  }

  return {
    kind: 'servers',
    servers: Array.from(mergedServers.values()).sort((left, right) => left.server.localeCompare(right.server)),
  };
}

function hasServerTools(tools: Tool[], serverName: string): boolean {
  return tools.some((tool) => {
    const [toolServerName] = tool.name.split('_1mcp_');
    return toolServerName === serverName;
  });
}

export async function inspectCommand(options: InspectCommandOptions): Promise<void> {
  // Load .1mcprc with CLI > .1mcprc > defaults precedence
  const projectConfig = await loadProjectConfig();
  const mergedOptions: InspectCommandOptions = {
    ...options,
    preset: options.preset || projectConfig?.preset,
    filter: options.filter || projectConfig?.filter,
    tags: options.tags || normalizeTags(projectConfig?.tags),
  };

  const target = parseInspectTarget(mergedOptions.target);
  const format = mergedOptions.format || 'text';

  const { url: discoveredUrl } = await discoverServerWithPidFile(mergedOptions['config-dir'], mergedOptions.url);
  const serverUrl = buildServerUrl(discoveredUrl, mergedOptions);
  const baseUrl = toBaseUrl(discoveredUrl);

  const validation = await validateServer1mcpUrl(discoveredUrl);
  if (!validation.valid) {
    throw new InspectCommandError(validation.error || 'Cannot connect to the running 1MCP server.');
  }

  // Load auth profile for this server (if any)
  const authProfile = await loadAuthProfile(mergedOptions['config-dir'], normalizeServerUrl(baseUrl));
  const cachePath = getCliSessionCachePath(mergedOptions['config-dir']);
  const cachedSession = await readCliSessionCache(cachePath, serverUrl.toString());
  const inspectContext = buildInspectContext(projectConfig);

  // Try /api/inspect first (fast path)
  const apiClient = new ApiClient({ baseUrl, bearerToken: authProfile?.token });
  const query = buildInspectQuery(mergedOptions, mergedOptions.target);
  const apiResponse = await apiClient.get<unknown>('/api/inspect', query);

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

    if (target.kind === 'all' && result.kind === 'servers') {
      let contextResponse = await inspectTools({
        serverUrl,
        sessionId: cachedSession?.sessionId,
        context: inspectContext,
      });

      // Template-backed servers can appear only after the initial contextful session
      // is fully established. If this is the first discovery pass, retry once using
      // the freshly issued session id before merging discovered servers.
      if (!cachedSession?.sessionId && contextResponse.sessionId) {
        const secondPass = await inspectTools({
          serverUrl,
          sessionId: contextResponse.sessionId,
          context: inspectContext,
        });
        if (!secondPass.retryWithFreshSession) {
          contextResponse = secondPass;
        }
      }

      if (!contextResponse.retryWithFreshSession) {
        result = mergeContextDiscoveredServers(result, contextResponse.tools, Boolean(cachedSession?.sessionId));

        if (contextResponse.sessionId) {
          await writeCliSessionCache(cachePath, {
            sessionId: contextResponse.sessionId,
            serverUrl: serverUrl.toString(),
            savedAt: Date.now(),
            hasRestEndpoint: true,
          });
        }
      }
    }

    if (target.kind === 'tool' && !cachedSession?.sessionId) {
      const sessionResponse = await inspectTools({
        serverUrl,
        context: inspectContext,
      });

      if (sessionResponse.sessionId) {
        await writeCliSessionCache(cachePath, {
          sessionId: sessionResponse.sessionId,
          serverUrl: serverUrl.toString(),
          savedAt: Date.now(),
          hasRestEndpoint: true,
        });
      }
    }

    const output = formatInspectOutput(result, format);
    if (output.length > 0) {
      process.stdout.write(`${output}\n`);
    }
    // Mark that this server has the REST endpoint
    if (cachedSession) {
      await writeCliSessionCache(cachePath, { ...cachedSession, hasRestEndpoint: true });
    }
    return;
  }

  // Fall back to MCP protocol for servers without /api/inspect (404) or for tool targets
  if (apiResponse.status === 401 || apiResponse.status === 403) {
    throw new InspectCommandError(
      `Authentication required. Run: 1mcp auth login --url ${baseUrl} --token <your-token>`,
    );
  }

  if (apiResponse.status !== 404 && apiResponse.status !== 503 && apiResponse.status !== 0) {
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
    context: inspectContext,
  });

  const shouldRetryWithFreshSession =
    response.retryWithFreshSession ||
    (!!cachedSession?.sessionId &&
      ((target.kind === 'server' && !hasServerTools(response.tools, target.serverName)) ||
        (target.kind === 'tool' && !findToolByQualifiedName(response.tools, target.reference.qualifiedName)))) ||
    (target.kind === 'server' && response.instructions === undefined);

  if (shouldRetryWithFreshSession) {
    await deleteCliSessionCache(cachePath);
    response = await inspectTools({ serverUrl, context: inspectContext });
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
    const serverApiResponse = await apiClient.get<Parameters<typeof formatInspectOutput>[0]>('/api/inspect', {
      ...buildInspectQuery(mergedOptions, mergedOptions.target),
    });

    if (serverApiResponse.ok && serverApiResponse.data?.kind === 'server') {
      result = serverApiResponse.data;
    } else {
      result = extractInspectServerInfo(
        target.serverName,
        response.tools,
        Boolean(cachedSession?.sessionId),
        undefined,
      );
    }
  }

  const output = formatInspectOutput(result, format);
  if (output.length > 0) {
    process.stdout.write(`${output}\n`);
  }
}

export async function inspectTools(options: { serverUrl: URL; sessionId?: string; context?: ContextData }): Promise<{
  rawResponse: JsonRpcResponse<unknown>;
  tools: Tool[];
  sessionId?: string;
  instructions?: string | null;
  retryWithFreshSession: boolean;
}> {
  const client = new StreamableServeClient(options.serverUrl, options.sessionId);
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
  } finally {
    await client.close();
  }
}

function findTool(tools: Tool[], qualifiedToolName: string, displayToolName: string): Tool {
  const tool = findToolByQualifiedName(tools, qualifiedToolName);
  if (!tool) {
    throw new InspectCommandError(`Tool not found: ${displayToolName}`);
  }

  return tool;
}
