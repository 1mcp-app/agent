import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { buildCatalogGeneration } from '@src/core/capabilities/catalogGeneration.js';
import { type ServerAdapter, ServerStatus, ServerType } from '@src/core/server/adapters/types.js';
import type { OutboundConnections } from '@src/core/types/index.js';
import type { JsonValue } from '@src/sdk/contracts/index.js';

import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInspectHandler } from './apiRoutes.js';

const mockedLoadDeclaredServerConfigs = vi.hoisted(() => vi.fn());
const mockedLoadConfigWithTemplates = vi.hoisted(() => vi.fn());
const mockedExtractRequestContext = vi.hoisted(() => vi.fn());
const mockedGetTransportConfig = vi.hoisted(() => vi.fn());
const mockedGetConfiguredServerTargets = vi.hoisted(() => vi.fn());

vi.mock('@src/config/configManager.js', () => ({
  ConfigManager: {
    getInstance: vi.fn(() => ({
      loadDeclaredServerConfigs: mockedLoadDeclaredServerConfigs,
      loadConfigWithTemplates: mockedLoadConfigWithTemplates,
    })),
  },
}));

vi.mock('@src/config/mcpConfigManager.js', () => ({
  McpConfigManager: {
    getInstance: vi.fn(() => ({
      getTransportConfig: mockedGetTransportConfig,
      getConfiguredServerTargets: mockedGetConfiguredServerTargets,
    })),
  },
}));

vi.mock('@src/transport/http/utils/contextExtractor.js', () => ({
  CONTEXT_HEADERS: {
    SESSION_ID: 'mcp-session-id',
  },
  deriveContextSessionId: vi.fn(() => 'derived-session-id'),
  extractRequestContext: mockedExtractRequestContext,
  extractTemplateContextRequest: vi.fn(() => {
    const context = mockedExtractRequestContext();
    return context ? { context, source: 'meta' } : null;
  }),
}));

vi.mock('@src/transport/http/utils/templateContextAuthority.js', () => ({
  authorizeRequestTemplateContext: vi.fn(({ context }) => ({ status: 'trusted', context })),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
  infoIf: vi.fn(),
  warnIf: vi.fn(),
}));

vi.mock('@src/transport/http/middlewares/tagsExtractor.js', () => ({
  default: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

type MockResponse = Response & { body?: unknown };

function createMockResponse(): MockResponse {
  const response = {
    locals: {},
    statusCode: 200,
    setHeader: vi.fn(),
    status(code: number) {
      response.statusCode = code;
      return response as MockResponse;
    },
    json(body: unknown) {
      response.body = body;
      return response as MockResponse;
    },
  } as unknown as MockResponse;

  return response;
}

async function invokeInspectRoute(handler: RequestHandler, req: Partial<Request>, res: Response): Promise<void> {
  await handler(req as Request, res, () => undefined);
}

describe('apiRoutes inspect', () => {
  let inspectHandler: RequestHandler;
  let outboundConnections: OutboundConnections;
  const lazyOrchestrator = vi.fn();

  const connection = (name: string, tags: string[], tools: unknown[] = []) =>
    createMockOutboundConnection({
      capabilities: { tools: {} },
      name,
      tags,
      adapter: { request: vi.fn().mockResolvedValue({ tools }) },
    });

  const makeAdapter = (name: string, tags: string[], status = ServerStatus.Connected): ServerAdapter => ({
    name,
    type: ServerType.External,
    config: { type: 'stdio', command: 'node', args: [], tags },
    resolveConnection: vi.fn(),
    getStatus: vi.fn(() => status),
    isAvailable: vi.fn(() => status === ServerStatus.Connected),
    getConnectionKey: vi.fn(),
  });

  const scopeAuthMiddleware: RequestHandler = (req, res, next) => {
    const preset = typeof req.query.preset === 'string' ? req.query.preset : undefined;
    res.locals.validatedTags = [];
    res.locals.tagFilterMode = preset ? 'preset' : 'none';
    res.locals.presetName = preset;
    res.locals.tagQuery = preset
      ? {
          $or: [{ tag: 'context7' }, { tag: 'filesystem' }, { tag: 'serena' }],
        }
      : undefined;
    next();
  };

  beforeEach(() => {
    lazyOrchestrator.mockReset();
    mockedLoadDeclaredServerConfigs.mockReset();
    mockedLoadConfigWithTemplates.mockReset();
    mockedExtractRequestContext.mockReset();
    mockedLoadDeclaredServerConfigs.mockReturnValue({
      staticServers: {},
      templateServers: {},
      errors: [],
    });
    mockedGetTransportConfig.mockReset();
    mockedGetTransportConfig.mockReturnValue({});
    mockedGetConfiguredServerTargets.mockReset();
    mockedGetConfiguredServerTargets.mockImplementation(() => mockedGetTransportConfig());
    mockedLoadConfigWithTemplates.mockResolvedValue({
      staticServers: {},
      templateServers: {},
      errors: [],
    });
    mockedExtractRequestContext.mockReturnValue(undefined);

    outboundConnections = new Map([
      [
        'context7',
        connection(
          'context7',
          ['context7'],
          [
            {
              name: 'query-docs',
              description: 'Query docs',
              inputSchema: {
                type: 'object',
                properties: {
                  libraryId: { type: 'string' },
                  query: { type: 'string' },
                },
                required: ['libraryId', 'query'],
              },
            },
          ],
        ),
      ],
      ['filesystem', connection('filesystem', ['filesystem'])],
      ['hidden', connection('hidden', ['hidden'])],
    ]);

    const adapters = new Map<string, ServerAdapter>([
      ['context7', makeAdapter('context7', ['context7'])],
      ['filesystem', makeAdapter('filesystem', ['filesystem'])],
      ['serena', makeAdapter('serena', ['serena'], ServerStatus.Disconnected)],
      ['hidden', makeAdapter('hidden', ['hidden'])],
    ]);

    const serverRegistry = {
      getServerNames: vi.fn(() => Array.from(adapters.keys())),
      get: vi.fn((name: string) => adapters.get(name)),
    };

    const serverManager = {
      getClients: vi.fn(() => outboundConnections),
      getInstructionAggregator: vi.fn(() => ({
        hasInstructions: (name: string) => name === 'context7' || name === 'serena',
        getServerInstructions: (name: string) => (name === 'context7' ? '# Context7 Instructions' : undefined),
      })),
      getLazyLoadingOrchestrator: lazyOrchestrator,
      getServerRegistry: vi.fn(() => serverRegistry),
      getClient: vi.fn((name: string) => outboundConnections.get(name)),
    };

    inspectHandler = createInspectHandler(serverManager as never);
  });

  it('reapplies authorization and invalidates search cursors when inventory or authority changes', async () => {
    outboundConnections.set(
      'context7',
      connection(
        'context7',
        ['context7'],
        [
          { name: 'a', inputSchema: { type: 'object' } },
          { name: 'b', inputSchema: { type: 'object' } },
        ],
      ),
    );
    outboundConnections.set(
      'hidden',
      connection('hidden', ['hidden'], [{ name: 'secret', inputSchema: { type: 'object' } }]),
    );
    const query = { search: 'context7', limit: '1' };
    const first = createMockResponse();
    first.locals.validatedTags = ['context7'];
    await invokeInspectRoute(inspectHandler, { query }, first);
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatchObject({
      kind: 'search',
      complete: true,
      totalTools: 2,
      tools: [{ server: 'context7', tool: 'a' }],
      sources: [{ server: 'context7' }],
    });
    const cursor = (first.body as { nextCursor: string }).nextCursor;
    const changedAuthority = createMockResponse();
    changedAuthority.locals.validatedTags = ['hidden'];
    await invokeInspectRoute(inspectHandler, { query: { ...query, cursor } }, changedAuthority);
    expect(changedAuthority.statusCode).toBe(400);
    expect(changedAuthority.body).toMatchObject({ error: expect.stringContaining('stale') });
    // Same identities and counts, changed schema: the inventory still changed.
    outboundConnections.set(
      'context7',
      connection(
        'context7',
        ['context7'],
        [
          { name: 'a', inputSchema: { type: 'object', description: 'changed' } },
          { name: 'b', inputSchema: { type: 'object' } },
        ],
      ),
    );
    const changedInventory = createMockResponse();
    changedInventory.locals.validatedTags = ['context7'];
    await invokeInspectRoute(inspectHandler, { query: { ...query, cursor } }, changedInventory);
    expect(changedInventory.statusCode).toBe(400);
  });

  it('distinguishes unavailable sources from a complete empty search', async () => {
    const unavailable = createMockResponse();
    await invokeInspectRoute(inspectHandler, { query: { search: 'nothing', target: 'serena' } }, unavailable);
    expect(unavailable.body).toMatchObject({
      kind: 'search',
      tools: [],
      totalTools: 0,
      complete: false,
      sources: [{ server: 'serena', available: false }],
    });
    const empty = createMockResponse();
    await invokeInspectRoute(inspectHandler, { query: { search: 'nothing', target: 'filesystem' } }, empty);
    expect(empty.body).toMatchObject({ kind: 'search', tools: [], totalTools: 0, complete: true });
  });

  it('reports a malformed authoritative cursor as unavailable instead of complete empty search', async () => {
    vi.mocked(outboundConnections.get('context7')!.adapter.request).mockResolvedValue({
      tools: [],
      nextCursor: 42,
    } as never);
    const response = createMockResponse();
    await invokeInspectRoute(inspectHandler, { query: { search: 'anything', target: 'context7' } }, response);
    expect(response.statusCode).toBe(503);
  });

  it.each(['5001', '999999999999999999999', '1.5', '1junk', '0', '-1', 'NaN', 'Infinity', ''])(
    'rejects invalid limit %j before querying tools',
    async (limit) => {
      const targetConnection = outboundConnections.get('context7')!;
      for (const all of [undefined, 'true']) {
        const response = createMockResponse();
        await invokeInspectRoute(
          inspectHandler,
          { query: { target: 'context7', limit, ...(all ? { all } : {}) } },
          response,
        );
        expect(response.statusCode).toBe(400);
      }
      expect(targetConnection.adapter.request).not.toHaveBeenCalled();
    },
  );

  it('accepts the maximum page size and allows all to return a larger complete inventory', async () => {
    const tools = Array.from({ length: 5001 }, (_, index) => ({
      name: `tool_${index}`,
      inputSchema: { type: 'object' },
    }));
    outboundConnections.set('context7', connection('context7', ['context7'], tools));
    const page = createMockResponse();
    await invokeInspectRoute(inspectHandler, { query: { target: 'context7', limit: '5000' } }, page);
    expect(page.statusCode).toBe(200);
    expect((page.body as { tools: unknown[] }).tools).toHaveLength(5000);
    const all = createMockResponse();
    await invokeInspectRoute(inspectHandler, { query: { target: 'context7', all: 'true' } }, all);
    expect(all.statusCode).toBe(200);
    expect((all.body as { tools: unknown[] }).tools).toHaveLength(5001);
    expect(all.body).toMatchObject({ totalTools: 5001, hasMore: false });
  });

  it.each(['direct', 'registry', 'snapshot'])(
    'uses authoritative %s inventory after disabled filtering',
    async (source) => {
      const rawTools = ['first', 'disabled', 'last'].map((name) => ({ name, inputSchema: { type: 'object' } }));
      const targetConnection = connection('context7', ['context7'], rawTools);
      outboundConnections.set('context7', targetConnection);
      mockedGetConfiguredServerTargets.mockReturnValue({ context7: { disabledTools: ['disabled'] } });
      if (source === 'registry') {
        vi.mocked(targetConnection.adapter.request).mockRejectedValue(new Error('offline'));
        lazyOrchestrator.mockReturnValue({
          getToolRegistry: () => ({ groupByServer: () => ({ context7: rawTools }) }),
          getCapabilityAggregator: () => undefined,
        });
      } else if (source === 'snapshot') {
        const generation = buildCatalogGeneration(
          1,
          rawTools.map((object) => ({
            kind: 'tools',
            server: 'context7',
            connectionKey: 'context7',
            object,
          })),
        );
        lazyOrchestrator.mockReturnValue({
          getToolRegistry: () => undefined,
          getCapabilityAggregator: () => ({
            getCurrentCapabilities: () => ({ tools: generation.entries.map((entry) => entry.publicObject) }),
          }),
        });
      }
      const first = createMockResponse();
      await invokeInspectRoute(inspectHandler, { query: { target: 'context7', limit: '1' } }, first);
      if (source === 'registry') {
        expect(first.statusCode).toBe(503);
        expect(first.body).toEqual({ error: 'Tool inventory not available for this server' });
        return;
      }
      expect(first.statusCode).toBe(200);
      const page = first.body as { tools: Array<{ tool: string }>; nextCursor: string };
      expect(page).toMatchObject({ tools: [{ tool: 'first' }], totalTools: 2, hasMore: true });
      const last = createMockResponse();
      await invokeInspectRoute(
        inspectHandler,
        { query: { target: 'context7', limit: '1', cursor: page.nextCursor } },
        last,
      );
      expect(last.body).toMatchObject({ tools: [{ tool: 'last' }], totalTools: 2, hasMore: false });
      const all = createMockResponse();
      await invokeInspectRoute(inspectHandler, { query: { target: 'context7', limit: '1', all: 'true' } }, all);
      expect(all.body).toMatchObject({ tools: [{ tool: 'first' }, { tool: 'last' }], hasMore: false });
      const wrongTarget = createMockResponse();
      await invokeInspectRoute(
        inspectHandler,
        { query: { target: 'filesystem', cursor: page.nextCursor } },
        wrongTarget,
      );
      expect(wrongTarget.statusCode).toBe(400);
      const changedFilter = createMockResponse();
      changedFilter.locals.validatedTags = ['context7'];
      changedFilter.locals.tagFilterMode = 'simple-or';
      await invokeInspectRoute(
        inspectHandler,
        { query: { target: 'context7', cursor: page.nextCursor } },
        changedFilter,
      );
      expect(changedFilter.statusCode).toBe(400);
    },
  );

  it('walks oversized and empty upstream pages and rejects repeated upstream cursors', async () => {
    const targetConnection = connection('context7', ['context7']);
    outboundConnections.set('context7', targetConnection);
    const request = vi.mocked(targetConnection.adapter.request);
    request.mockImplementation(async ({ params }): Promise<JsonValue> => {
      const cursor = (params as { cursor?: string } | undefined)?.cursor;
      if (cursor === undefined)
        return {
          tools: [
            { name: 'a', inputSchema: { type: 'object' } },
            { name: 'b', inputSchema: { type: 'object' } },
          ],
          nextCursor: 'empty',
        };
      if (cursor === 'empty') return { tools: [], nextCursor: 'tail' };
      return { tools: [{ name: 'c', inputSchema: { type: 'object' } }] };
    });
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const response = createMockResponse();
      await invokeInspectRoute(
        inspectHandler,
        { query: { target: 'context7', limit: '1', ...(cursor ? { cursor } : {}) } },
        response,
      );
      expect(response.statusCode).toBe(200);
      const page = response.body as { tools: Array<{ tool: string }>; nextCursor?: string };
      names.push(...page.tools.map((tool) => tool.tool));
      cursor = page.nextCursor;
    } while (cursor);
    expect(names).toEqual(['a', 'b', 'c']);
    request.mockResolvedValue({ tools: [], nextCursor: 'repeat' });
    const repeated = createMockResponse();
    await invokeInspectRoute(inspectHandler, { query: { target: 'context7', limit: '1' } }, repeated);
    expect(repeated.statusCode).toBe(503);
  });

  it('uses the configured effective description in server and tool payloads', async () => {
    mockedGetConfiguredServerTargets.mockReturnValue({
      context7: {
        type: 'stdio',
        command: 'node',
        toolDescriptionOverrides: { 'context7_1mcp_query-docs': 'Search the current documentation' },
      },
    });

    const serverRequest = { query: { target: 'context7' } };
    const serverResponse = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, serverRequest, serverResponse);
    await invokeInspectRoute(inspectHandler, serverRequest, serverResponse);

    expect(serverResponse.statusCode, JSON.stringify(serverResponse.body)).toBe(200);
    expect(serverResponse.body).toMatchObject({
      kind: 'server',
      tools: [{ tool: 'query-docs', description: 'Search the current documentation' }],
    });

    const toolRequest = { query: { target: 'context7/query-docs' } };
    const toolResponse = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, toolRequest, toolResponse);
    await invokeInspectRoute(inspectHandler, toolRequest, toolResponse);

    expect(toolResponse.statusCode, JSON.stringify(toolResponse.body)).toBe(200);
    expect(toolResponse.body).toMatchObject({
      kind: 'tool',
      description: 'Search the current documentation',
    });
  });

  it('does not initialize template servers for bare inspect listings even when request context is present', async () => {
    mockedLoadDeclaredServerConfigs.mockReturnValue({
      staticServers: {},
      templateServers: {
        serena: {
          type: 'stdio',
          command: 'uvx',
          args: ['serena'],
          tags: ['serena'],
        },
      },
      errors: [],
    });
    mockedLoadConfigWithTemplates.mockResolvedValue({
      staticServers: {},
      templateServers: {
        serena: {
          type: 'stdio',
          command: 'uvx',
          args: ['serena', '{{project.path}}'],
          tags: ['serena'],
        },
      },
      errors: [],
    });
    mockedExtractRequestContext.mockReturnValue({
      sessionId: 'context-session',
      project: {
        path: '/tmp/project',
      },
    });

    outboundConnections = new Map([
      ...outboundConnections.entries(),
      [
        'serena:template-hash',
        connection(
          'serena',
          ['serena'],
          [
            {
              name: 'find_symbol',
              description: 'Find symbol',
              inputSchema: {
                type: 'object',
                properties: {
                  name_path_pattern: { type: 'string' },
                },
                required: ['name_path_pattern'],
              },
            },
          ],
        ),
      ],
    ]);

    const createTemplateBasedServers = vi.fn();
    const getRenderedHashForSession = vi.fn(() => undefined);
    const registerTemplate = vi.fn();
    const templateAdapter = {
      name: 'serena',
      type: ServerType.Template,
      config: { type: 'stdio', command: 'uvx', args: ['serena'], tags: ['serena'] },
      resolveConnection: vi.fn(),
      getStatus: vi.fn(() => ServerStatus.Disconnected),
      isAvailable: vi.fn(() => false),
      getConnectionKey: vi.fn(),
    };

    const serverManager = {
      getClients: vi.fn(() => outboundConnections),
      getInstructionAggregator: vi.fn(() => ({
        hasInstructions: (name: string) => name === 'context7' || name === 'serena',
        getServerInstructions: (name: string) => (name === 'context7' ? '# Context7 Instructions' : undefined),
      })),
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getServerRegistry: vi.fn(() => ({
        getServerNames: vi.fn(() => ['context7', 'filesystem', 'serena']),
        get: vi.fn((name: string) => {
          if (name === 'context7') return makeAdapter('context7', ['context7']);
          if (name === 'filesystem') return makeAdapter('filesystem', ['filesystem']);
          if (name === 'serena') return templateAdapter;
          return undefined;
        }),
        has: vi.fn(() => false),
        registerTemplate,
      })),
      getClient: vi.fn((name: string) => outboundConnections.get(name)),
      getTemplateServerManager: vi.fn(() => ({
        getRenderedHashForSession,
        createTemplateBasedServers,
      })),
      getClientTransports: vi.fn(() => new Map()),
    };

    inspectHandler = createInspectHandler(serverManager as never);

    const req = { query: {} };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);

    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect((res.body as { kind: string }).kind).toBe('servers');
    const serenaEntry = (res.body as { servers: Array<{ server: string }> }).servers.find((server) => {
      return server.server === 'serena';
    });
    expect(serenaEntry).toMatchObject({ server: 'serena', type: 'template', available: false, toolCount: 0 });
    expect(createTemplateBasedServers).not.toHaveBeenCalled();
    expect(registerTemplate).not.toHaveBeenCalled();
    expect(getRenderedHashForSession).not.toHaveBeenCalled();
  });
});
