import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { findToolByQualifiedName } from '@src/commands/run/runUtils.js';
import { ApiClient } from '@src/commands/shared/apiClient.js';
import {
  attachReusableClientSurface,
  type ClientSurfaceAttachmentContext,
  type ClientSurfaceRestResponse,
} from '@src/commands/shared/clientSurfaceAttachment.js';
import {
  type JsonRpcErrorEnvelope,
  type JsonRpcResponse,
  StreamableServeClient,
} from '@src/commands/shared/serveClient.js';
import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { API_INSPECT_ENDPOINT } from '@src/constants/api.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import type { ContextData } from '@src/types/context.js';

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

type InspectMcpValue = Awaited<ReturnType<typeof inspectTools>>;
type InspectAttachmentValue = InspectMcpValue | { result: InspectResult };

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

function isApiInspectToolResult(value: unknown): value is ApiInspectToolResult {
  return (
    typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'tool' && 'inputSchema' in value
  );
}

function extractServerInstructionsFromAggregatedInstructions(
  instructions: string | null | undefined,
  serverName: string,
): string | undefined {
  if (!instructions?.trim()) {
    return undefined;
  }

  const escapedServerName = serverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = instructions.match(
    new RegExp(`<${escapedServerName}>\\s*([\\s\\S]*?)\\s*</${escapedServerName}>`, 'i'),
  );
  return match?.[1]?.trim() || undefined;
}

function normalizeApiInspectResult(
  result: Parameters<typeof formatInspectOutput>[0],
  target: ReturnType<typeof parseInspectTarget>,
  includeServerInstructions: boolean,
): Parameters<typeof formatInspectOutput>[0] {
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

  return result;
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

  const { instructions: _instructions, serverInstructions: _serverInstructions, ...serversResult } = result;
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
  const attachment = await attachReusableClientSurface<InspectCommandOptions, InspectAttachmentValue>({
    clientSurface: 'inspect',
    version: 'inspect',
    options,
    rest: (context) => tryInspectRest(context, includeServerInstructions),
    mcp: async (context) => {
      const response = await inspectTools({
        serverUrl: context.serverUrl,
        sessionId: context.sessionId,
        bearerToken: context.bearerToken,
        context: context.context,
        sendInitialize: context.sendInitialize,
      });
      const target = parseInspectTarget(context.options.target);
      const shouldRetryWithFreshSession =
        response.retryWithFreshSession ||
        (!!context.cachedSession?.sessionId &&
          ((target.kind === 'server' && !hasServerTools(response.tools, target.serverName)) ||
            (target.kind === 'tool' && !findToolByQualifiedName(response.tools, target.reference.qualifiedName))));

      return shouldRetryWithFreshSession
        ? { status: 'stale_session' as const, observed: response }
        : { status: 'success' as const, sessionId: response.sessionId, value: response };
    },
  });

  if (attachment.status !== 'success') {
    throw new InspectCommandError(attachment.message);
  }

  if (attachment.protocol === 'rest') {
    if (!('result' in attachment.value)) {
      throw new InspectCommandError('Unexpected REST inspect result.');
    }
    return attachment.value.result;
  }

  const target = parseInspectTarget(attachment.target.mergedOptions.target);
  if (target.kind === 'all') {
    throw new InspectCommandError(
      'Cannot list all servers: the running 1MCP server does not support the /api/inspect endpoint.',
    );
  }
  if ('result' in attachment.value) {
    throw new InspectCommandError('Unexpected MCP inspect result.');
  }
  const response = attachment.value;

  if (target.kind === 'server') {
    const apiClient = new ApiClient({
      baseUrl: attachment.baseUrl,
      bearerToken: attachment.bearerToken,
      sessionId: attachment.sessionId ?? attachment.requestSessionId,
      context: attachment.context,
    });
    const refreshedApiResponse = await apiClient.get<unknown>(
      API_INSPECT_ENDPOINT,
      buildInspectQuery(attachment.target.mergedOptions, attachment.target.mergedOptions.target),
    );
    if (refreshedApiResponse.ok && refreshedApiResponse.data !== undefined) {
      return normalizeApiInspectResult(
        refreshedApiResponse.data as Parameters<typeof formatInspectOutput>[0],
        target,
        includeServerInstructions,
      );
    }
  }

  let result: Parameters<typeof formatInspectOutput>[0];

  if (target.kind === 'tool') {
    result = extractInspectToolInfo(
      findTool(response.tools, target.reference.qualifiedName, attachment.target.mergedOptions.target!),
      target.reference,
      Boolean(attachment.cachedSession?.sessionId),
    );
  } else {
    result = extractInspectServerInfo(
      target.serverName,
      response.tools,
      Boolean(attachment.cachedSession?.sessionId),
      extractServerInstructionsFromAggregatedInstructions(response.instructions, target.serverName),
    );
    if (!includeServerInstructions) {
      result = stripServerInstructions(result);
    }
  }

  return result;
}

async function tryInspectRest(
  context: ClientSurfaceAttachmentContext<InspectCommandOptions>,
  includeServerInstructions: boolean,
): Promise<ClientSurfaceRestResponse<{ result: InspectResult }>> {
  const target = parseInspectTarget(context.options.target);
  const apiClient = new ApiClient({
    baseUrl: context.baseUrl,
    bearerToken: context.bearerToken,
    sessionId: context.sessionId,
    context: context.context,
  });
  const apiResponse = await apiClient.get<unknown>(
    API_INSPECT_ENDPOINT,
    buildInspectQuery(context.options, context.options.target),
  );

  if (apiResponse.ok && apiResponse.data !== undefined) {
    return {
      status: 'success',
      sessionId: apiResponse.sessionId ?? context.sessionId,
      value: {
        result: normalizeApiInspectResult(
          apiResponse.data as Parameters<typeof formatInspectOutput>[0],
          target,
          includeServerInstructions,
        ),
      },
    };
  }

  if (apiResponse.status === 401 || apiResponse.status === 403) {
    return {
      status: 'auth_required',
      message: `Authentication required. Run: 1mcp auth login --url ${context.baseUrl} --token <your-token>`,
    };
  }

  const isMissingInspectEndpoint =
    apiResponse.status === 404 && (!apiResponse.error || apiResponse.error === 'HTTP 404');
  const canFallbackToMcp =
    isMissingInspectEndpoint ||
    apiResponse.status === 405 ||
    apiResponse.status === 0 ||
    ((target.kind === 'server' || target.kind === 'tool') && apiResponse.status === 503);

  if (!canFallbackToMcp) {
    return { status: 'error', message: apiResponse.error || `Server returned HTTP ${apiResponse.status}` };
  }

  if (target.kind === 'all') {
    return {
      status: 'error',
      message: 'Cannot list all servers: the running 1MCP server does not support the /api/inspect endpoint.',
    };
  }

  return {
    status: 'fallback',
    reason: isMissingInspectEndpoint || apiResponse.status === 405 ? 'endpoint_missing' : 'transient_failure',
  };
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
  sendInitialize?: boolean;
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
    const shouldSendInitialize = options.sendInitialize ?? !options.sessionId;
    if (shouldSendInitialize) {
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
    try {
      await client.close();
    } catch {
      // Best-effort cleanup for CLI inspect sessions.
    }
  }
}

function findTool(tools: Tool[], qualifiedToolName: string, displayToolName: string): Tool {
  const tool = findToolByQualifiedName(tools, qualifiedToolName);
  if (!tool) {
    throw new InspectCommandError(`Tool not found: ${displayToolName}`);
  }

  return tool;
}
