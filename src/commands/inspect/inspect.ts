import { findToolByQualifiedName } from '@src/commands/run/runUtils.js';
import { ApiClient } from '@src/commands/shared/apiClient.js';
import {
  attachReusableClientSurface,
  type ClientSurfaceAttachmentContext,
  type ClientSurfaceRestResponse,
  formatClientSurfaceAuthRequiredMessage,
  type ReusableClientSurface,
} from '@src/commands/shared/clientSurfaceAttachment.js';
import { buildFilterSelectionQuery } from '@src/commands/shared/filterSelectionQuery.js';
import { inspectSearchResultSchema, inspectToolsPageSchema } from '@src/commands/shared/inspectApiSchemas.js';
import {
  type JsonRpcErrorEnvelope,
  type JsonRpcResponse,
  StreamableServeClient,
} from '@src/commands/shared/serveClient.js';
import { API_INSPECT_ENDPOINT } from '@src/constants/api.js';
import { CAPABILITY_PAGINATION_META_KEY } from '@src/core/capabilities/capabilityPagination.js';
import { readPublicCapabilityRoute } from '@src/core/capabilities/catalogGeneration.js';
import { collectConfiguredToolPages } from '@src/core/capabilities/configuredToolSnapshot.js';
import { paginateInspectTools } from '@src/core/capabilities/inspectPagination.js';
import { inspectSearchOptionsSchema, searchInspectTools } from '@src/core/capabilities/inspectSearch.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import { hasHttpErrorCode, type Tool, toProtocolTools } from '@src/sdk/contracts/index.js';
import type { ContextData } from '@src/types/context.js';
import { isPlainObject } from '@src/utils/typeGuards.js';

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
  context?: string;
  preset?: string;
  filter?: string;
  tags?: string[];
  'tag-filter'?: string;
  format?: InspectOutputFormat;
  target?: string;
  all?: boolean;
  limit?: number;
  cursor?: string;
  search?: string;
  glob?: boolean;
  'include-descriptions'?: boolean;
  'show-descriptions'?: boolean;
}

interface GetInspectResultOptions {
  includeServerInstructions?: boolean;
  clientSurface?: ReusableClientSurface;
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
  options: Pick<
    InspectCommandOptions,
    | 'preset'
    | 'filter'
    | 'tags'
    | 'tag-filter'
    | 'all'
    | 'limit'
    | 'cursor'
    | 'search'
    | 'glob'
    | 'include-descriptions'
    | 'show-descriptions'
  >,
  target?: string,
): Record<string, string> {
  const query: Record<string, string> = buildFilterSelectionQuery(options);
  if (target) query.target = target;
  if (options.search !== undefined) query.search = options.search;
  if (options.glob) query.glob = 'true';
  if (options['include-descriptions']) query['include-descriptions'] = 'true';
  if (options['show-descriptions']) query['show-descriptions'] = 'true';
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
  return tools.some((tool) => readPublicCapabilityRoute(tool)?.server === serverName);
}

export async function getInspectResult(
  options: InspectCommandOptions,
  resultOptions: GetInspectResultOptions = {},
): Promise<InspectResult> {
  const validatedSearch = inspectSearchOptionsSchema.safeParse(options);
  if (!validatedSearch.success) throw new InspectCommandError(validatedSearch.error.issues[0].message);
  if (options.search !== undefined && parseInspectTarget(options.target).kind === 'tool') {
    throw new InspectCommandError('Search accepts an optional server target, not an exact tool target.');
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 5000)) {
    throw new InspectCommandError('limit must be an integer from 1 to 5000.');
  }
  const includeServerInstructions = resultOptions.includeServerInstructions ?? true;
  const clientSurface = resultOptions.clientSurface ?? 'inspect';
  const attachment = await attachReusableClientSurface<InspectCommandOptions, InspectAttachmentValue>({
    clientSurface,
    alwaysTryRest: options.search !== undefined,
    version: clientSurface,
    options,
    rest: (context) => tryInspectRest(context, includeServerInstructions),
    mcp: async (context) => {
      const response = await inspectTools({
        serverUrl: context.serverUrl,
        sessionId: context.sessionId,
        bearerToken: context.bearerToken,
        context: context.context,
        contextProof: context.contextProof,
        sendInitialize: context.sendInitialize,
      });
      if ('error' in response.rawResponse && !response.retryWithFreshSession) {
        throw new InspectCommandError(response.rawResponse.error.message);
      }
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

  let serverConfirmed = false;
  let searchMetadata = response._meta;
  let searchSource: { server: string; status: string; available: boolean } | undefined;
  if (target.kind === 'server') {
    const apiClient = new ApiClient({
      baseUrl: attachment.baseUrl,
      bearerToken: attachment.bearerToken,
      sessionId: attachment.sessionId ?? attachment.requestSessionId,
      context: attachment.context,
      contextProof: attachment.contextProof,
    });
    const refreshedApiResponse = await apiClient.get<unknown>(
      API_INSPECT_ENDPOINT,
      buildInspectQuery(attachment.target.mergedOptions, attachment.target.mergedOptions.target),
    );
    serverConfirmed =
      refreshedApiResponse.ok &&
      isPlainObject(refreshedApiResponse.data) &&
      refreshedApiResponse.data.kind === 'server' &&
      refreshedApiResponse.data.server === target.serverName;
    if (serverConfirmed && isPlainObject(refreshedApiResponse.data)) {
      const data = refreshedApiResponse.data;
      if (isPlainObject(data._meta)) searchMetadata = mergeInspectMetadata(searchMetadata, data._meta);
      if (typeof data.status === 'string' || typeof data.available === 'boolean') {
        const status = typeof data.status === 'string' ? data.status : 'unknown';
        searchSource = {
          server: target.serverName,
          status,
          available: data.available === true && (status === 'connected' || status === 'unknown'),
        };
      }
    }
    if (refreshedApiResponse.status === 401 || refreshedApiResponse.status === 403) {
      throw new InspectCommandError('Authorization failed while inspecting tools.');
    }
    if (attachment.target.mergedOptions.search !== undefined && !refreshedApiResponse.ok) {
      const missingEndpoint =
        refreshedApiResponse.status === 404 &&
        (!refreshedApiResponse.error || refreshedApiResponse.error === 'HTTP 404');
      if (!missingEndpoint && ![0, 405, 503].includes(refreshedApiResponse.status)) {
        throw new InspectCommandError(
          refreshedApiResponse.error || `Server returned HTTP ${refreshedApiResponse.status}`,
        );
      }
    }
    if (
      refreshedApiResponse.ok &&
      refreshedApiResponse.data !== undefined &&
      attachment.target.mergedOptions.search === undefined
    ) {
      return normalizeApiInspectResult(
        refreshedApiResponse.data as Parameters<typeof formatInspectOutput>[0],
        target,
        includeServerInstructions,
      );
    }
  }

  if (attachment.target.mergedOptions.search !== undefined) {
    if (response.tools.some((tool) => readPublicCapabilityRoute(tool)?.kind !== 'tools')) {
      throw new InspectCommandError(
        'This runtime does not expose public tool route metadata required for inspect search. Upgrade the running 1MCP runtime.',
      );
    }
    if (
      target.kind === 'server' &&
      !serverConfirmed &&
      !hasServerTools(response.tools, target.serverName) &&
      searchMetadata === undefined
    ) {
      throw new InspectCommandError(
        `Cannot establish whether server '${target.serverName}' exists in this runtime's empty scoped inventory. Upgrade the running 1MCP runtime for supported inspect search.`,
      );
    }
    return searchInspectTools(
      response.tools,
      {
        ...attachment.target.mergedOptions,
        search: attachment.target.mergedOptions.search,
        target: target.kind === 'server' ? target.serverName : undefined,
      },
      buildInspectQuery({ ...attachment.target.mergedOptions, cursor: undefined, all: false, limit: 20 }),
      {
        complete: searchMetadata === undefined && (searchSource?.available ?? true),
        ...(searchSource === undefined ? {} : { sources: [searchSource] }),
        ...(searchMetadata === undefined ? {} : { _meta: searchMetadata }),
      },
    );
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
    result = {
      ...result,
      ...paginateInspectTools(result.tools, {
        limit: attachment.target.mergedOptions.limit ?? 20,
        all: attachment.target.mergedOptions.all,
        cursor: attachment.target.mergedOptions.cursor,
        scope: {
          server: target.serverName,
          filters: buildInspectQuery({ ...attachment.target.mergedOptions, cursor: undefined, all: false, limit: 20 }),
        },
      }),
    };
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
    contextProof: context.contextProof,
  });
  const apiResponse = await apiClient.get<unknown>(
    API_INSPECT_ENDPOINT,
    buildInspectQuery(context.options, context.options.target),
  );

  if (apiResponse.ok && apiResponse.data !== undefined) {
    if (context.options.search !== undefined) {
      const parsed = inspectSearchResultSchema.safeParse(apiResponse.data);
      if (
        !parsed.success ||
        parsed.data.search !== context.options.search ||
        parsed.data.glob !== (context.options.glob ?? false) ||
        parsed.data.includeDescriptions !== (context.options['include-descriptions'] ?? false) ||
        parsed.data.showDescriptions !== (context.options['show-descriptions'] ?? false)
      ) {
        if (target.kind === 'server') return { status: 'fallback', reason: 'endpoint_missing' };
        return {
          status: 'error',
          message:
            'This runtime does not support inspect search. Upgrade the running 1MCP runtime, or search an explicit server with --search.',
        };
      }
      return {
        status: 'success',
        sessionId: apiResponse.sessionId ?? context.sessionId,
        value: { result: parsed.data },
      };
    }
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
      message: formatClientSurfaceAuthRequiredMessage(context),
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
      message:
        context.options.search !== undefined
          ? 'This runtime does not support cross-server inspect search. Upgrade the running 1MCP runtime, or search an explicit server with --search.'
          : 'Cannot list all servers: the running 1MCP server does not support the /api/inspect endpoint.',
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

function mergeInspectMetadata(
  previous: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!incoming) return previous;
  const metadata = { ...previous, ...incoming };
  const previousPartial = previous?.[CAPABILITY_PAGINATION_META_KEY];
  if (isPlainObject(previousPartial) && previousPartial.partial === true) {
    const current = metadata[CAPABILITY_PAGINATION_META_KEY];
    metadata[CAPABILITY_PAGINATION_META_KEY] = { ...(isPlainObject(current) ? current : {}), ...previousPartial };
  }
  return metadata;
}

async function listAllInspectTools(client: StreamableServeClient) {
  const first = await client.listTools();
  if ('error' in first) return first;
  let metadata: Record<string, unknown> | undefined;
  const result = await collectConfiguredToolPages(async (cursor) => {
    const response = cursor === undefined ? first : await client.listTools(cursor);
    if ('error' in response) throw new InspectCommandError(response.error.message);
    const page = inspectToolsPageSchema.safeParse(response.result);
    if (!page.success) throw new InspectCommandError('Invalid tools/list response from server.');
    metadata = mergeInspectMetadata(metadata, page.data._meta);
    const { _meta: _metadata, ...validatedPage } = page.data;
    return { ...validatedPage, tools: toProtocolTools(page.data.tools) };
  });
  return { ...first, result: { ...result, ...(metadata === undefined ? {} : { _meta: metadata }) } };
}

export async function inspectTools(options: {
  serverUrl: URL;
  sessionId?: string;
  bearerToken?: string;
  context?: ContextData;
  contextProof?: import('@src/core/context/templateContextTrust.js').TemplateContextProof;
  sendInitialize?: boolean;
}): Promise<{
  rawResponse: JsonRpcResponse<unknown>;
  tools: Tool[];
  sessionId?: string;
  instructions?: string | null;
  retryWithFreshSession: boolean;
  _meta?: Record<string, unknown>;
}> {
  const client = new StreamableServeClient(options.serverUrl, options.sessionId, options.bearerToken);
  await client.start();

  try {
    const shouldSendInitialize = options.sendInitialize ?? !options.sessionId;
    if (shouldSendInitialize) {
      const initializeResponse = await client.initialize(options.context, options.contextProof);
      if ('error' in initializeResponse) {
        return {
          rawResponse: initializeResponse,
          tools: [],
          sessionId: client.sessionId,
          instructions: undefined,
          retryWithFreshSession: false,
        };
      }

      const response = await listAllInspectTools(client);
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
        tools: toProtocolTools(response.result.tools),
        _meta: response.result._meta,
        sessionId: client.sessionId,
        instructions: initializeResponse.result.instructions ?? null,
        retryWithFreshSession: false,
      };
    }

    const response = await listAllInspectTools(client);
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
      tools: toProtocolTools(response.result.tools),
      _meta: response.result._meta,
      sessionId: client.sessionId,
      instructions: undefined,
      retryWithFreshSession: false,
    };
  } catch (error) {
    if (hasHttpErrorCode(error, 404) && options.sessionId) {
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
