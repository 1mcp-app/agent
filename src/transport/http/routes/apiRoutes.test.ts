import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import * as runtimeCatalog from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { CapabilityCursorCapacityError } from '@src/core/capabilities/capabilityPagination.js';
import { LoadingState, LoadingStateTracker } from '@src/core/loading/loadingStateTracker.js';
import { type ServerAdapter, ServerStatus, ServerType } from '@src/core/server/adapters/types.js';
import type { OutboundConnections } from '@src/core/types/index.js';

import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInspectHandler } from './apiRoutes.js';

const mockedGetServerState = vi.hoisted(() => vi.fn());
vi.mock('@src/core/loading/mcpLoadingManager.js', () => ({
  McpLoadingManager: { current: { getStateTracker: () => ({ getServerState: mockedGetServerState }) } },
}));

const mockedLoadDeclaredServerConfigs = vi.hoisted(() => vi.fn());
const mockedLoadConfigWithTemplates = vi.hoisted(() => vi.fn());
const mockedExtractRequestContext = vi.hoisted(() => vi.fn());
const mockedGetTransportConfig = vi.hoisted(() => vi.fn());

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
    mockedGetServerState.mockReset();
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
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getServerRegistry: vi.fn(() => serverRegistry),
      getClient: vi.fn((name: string) => outboundConnections.get(name)),
    };

    inspectHandler = createInspectHandler(serverManager as never);
  });

  it('keeps registered disconnected servers filtered by preset', async () => {
    const req = { query: { preset: 'dev-backend' } };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'servers',
      servers: [{ server: 'context7' }, { server: 'filesystem' }, { server: 'serena' }],
    });
    expect((res.body as { servers: Array<{ server: string }> }).servers).toHaveLength(3);
  });

  it('hides disabled tools from direct server inspect results', async () => {
    mockedGetTransportConfig.mockReturnValue({
      context7: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['context7_1mcp_query-docs'],
      },
    });

    const req = { query: { target: 'context7' } };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'server',
      server: 'context7',
      totalTools: 0,
      tools: [],
    });
  });

  it('returns 404 for disabled tool inspect targets', async () => {
    mockedGetTransportConfig.mockReturnValue({
      context7: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['context7_1mcp_query-docs'],
      },
    });

    const req = { query: { target: 'context7/context7_1mcp_query-docs' } };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: "Tool is disabled: context7:query-docs. Use '1mcp mcp tools enable context7 query-docs' to re-enable it.",
    });
  });

  it('hides disabled tools declared on template servers from direct inspect results', async () => {
    mockedLoadDeclaredServerConfigs.mockReturnValue({
      staticServers: {},
      templateServers: {
        serena: {
          type: 'stdio',
          command: 'uvx',
          args: ['serena'],
          tags: ['serena'],
          disabledTools: ['find_symbol'],
        },
      },
      errors: [],
    });
    outboundConnections.set(
      'serena:template-hash',
      connection(
        'serena',
        ['serena'],
        [
          { name: 'find_symbol', description: 'Find symbol', inputSchema: { type: 'object' } },
          { name: 'list_memories', description: 'List memories', inputSchema: { type: 'object' } },
        ],
      ),
    );

    const req = { query: { target: 'serena' } };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);

    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'server',
      server: 'serena',
      totalTools: 1,
      tools: [{ tool: 'list_memories', qualifiedName: 'serena_1mcp_list_memories' }],
    });
  });

  it('returns 404 for disabled template tool inspect targets', async () => {
    mockedLoadDeclaredServerConfigs.mockReturnValue({
      staticServers: {},
      templateServers: {
        serena: {
          type: 'stdio',
          command: 'uvx',
          args: ['serena'],
          tags: ['serena'],
          disabledTools: ['find_symbol'],
        },
      },
      errors: [],
    });

    const req = { query: { target: 'serena/find_symbol' } };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: "Tool is disabled: serena:find_symbol. Use '1mcp mcp tools enable serena find_symbol' to re-enable it.",
    });
  });

  it('includes declared template servers before any session has registered an adapter', async () => {
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

    const adapters = new Map<string, ServerAdapter>([
      ['context7', makeAdapter('context7', ['context7'])],
      ['filesystem', makeAdapter('filesystem', ['filesystem'])],
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
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getServerRegistry: vi.fn(() => serverRegistry),
      getClient: vi.fn((name: string) => outboundConnections.get(name)),
    };

    inspectHandler = createInspectHandler(serverManager as never);

    const req = { query: { preset: 'dev-backend' } };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);

    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'servers',
      servers: [
        { server: 'context7' },
        { server: 'filesystem' },
        { server: 'serena', type: 'template', available: false },
      ],
    });
  });

  it('does not expose tools from filtered-out servers via inspect fallback paths', async () => {
    const hiddenConnection = outboundConnections.get('hidden');
    if (!hiddenConnection) {
      throw new Error('Hidden connection not found');
    }

    vi.mocked(hiddenConnection.adapter.request).mockResolvedValue({
      tools: [
        {
          name: 'hidden_1mcp_secret',
          description: 'Secret tool',
          inputSchema: { type: 'object' },
        },
      ],
    });

    const req = { query: { preset: 'dev-backend', target: 'hidden/secret' } };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: 'Tool not found: hidden/secret' });
  });

  it('does not expose loading metadata for filtered-out static servers', async () => {
    mockedLoadDeclaredServerConfigs.mockReturnValue({
      staticServers: {
        hidden: {
          type: 'stdio',
          command: 'node',
          args: ['hidden.js'],
          tags: ['hidden'],
        },
      },
      templateServers: {},
      errors: [],
    });

    const req = { query: { preset: 'dev-backend', target: 'hidden' } };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Server not found: hidden' });
  });

  it('uses complete ordered snapshots and signed cursors for Admin and CLI inspect', async () => {
    const pagedConnections = new Map(outboundConnections);
    const pagedRequest = vi.fn(async ({ params }: { params?: unknown }) =>
      (params as { cursor?: string })?.cursor === 'private-upstream'
        ? { tools: [{ name: 'a', inputSchema: { type: 'object' } }] }
        : { tools: [{ name: 'z', inputSchema: { type: 'object' } }], nextCursor: 'private-upstream' },
    );
    pagedConnections.set(
      'context7',
      createMockOutboundConnection({
        ...pagedConnections.get('context7')!,
        adapter: { request: pagedRequest as never },
      }),
    );
    const manager = {
      getClients: () => pagedConnections,
      getClient: (name: string) => pagedConnections.get(name),
      getInstructionAggregator: () => undefined,
      getLazyLoadingOrchestrator: () => undefined,
      getServerRegistry: () => ({ get: () => undefined }),
    };
    const handler = createInspectHandler(manager as never);
    const query = { target: 'context7', limit: '1' };
    const first = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { query }, first);
    await invokeInspectRoute(handler, { query }, first);
    expect(first.statusCode, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ totalTools: 2, hasMore: true, tools: [{ tool: 'a' }] });
    const cursor = (first.body as { nextCursor: string }).nextCursor;
    expect(cursor.length).toBeLessThanOrEqual(4096);
    expect(Buffer.from(cursor.split('.')[0], 'base64url').toString()).not.toContain('private-upstream');
    const second = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { query }, second);
    await invokeInspectRoute(handler, { query: { ...query, cursor } }, second);
    expect(second.body).toMatchObject({ hasMore: false, tools: [{ tool: 'z' }] });
    expect(pagedRequest).toHaveBeenCalledTimes(2);
    expect(pagedRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'tools/list', params: { cursor: 'private-upstream' } }),
    );
    for (const changed of [{ cursor: cursor + 'x' }, { cursor, limit: '2' }, { cursor, all: 'true' }]) {
      const res = createMockResponse();
      await invokeInspectRoute(scopeAuthMiddleware, { query }, res);
      await invokeInspectRoute(handler, { query: { ...query, ...changed } }, res);
      expect(res.statusCode).toBe(400);
    }
    const changedAuthority = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { query }, changedAuthority);
    changedAuthority.locals.auth = {
      token: 'private-token',
      clientId: 'other-principal',
      grantedScopes: ['all'],
      grantedTags: [],
    };
    await invokeInspectRoute(handler, { query: { ...query, cursor } }, changedAuthority);
    expect(changedAuthority.statusCode).toBe(400);
    expect(pagedRequest).toHaveBeenCalledTimes(2);
  });

  it('omits resolved OAuth diagnostics from a Ready server response', async () => {
    const tracker = new LoadingStateTracker();
    tracker.startLoading(['context7']);
    tracker.updateServerState('context7', LoadingState.AwaitingOAuth, {
      error: new Error('Authorization required'),
      authorizationUrl: 'https://example.test/oauth',
    });
    tracker.updateServerState('context7', LoadingState.Ready);
    mockedGetServerState.mockImplementation((name: string) => tracker.getServerState(name));
    const response = createMockResponse();
    await invokeInspectRoute(inspectHandler, { query: { target: 'context7' } }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ status: 'connected', available: true });
    expect(response.body).not.toHaveProperty('error');
    expect(response.body).not.toHaveProperty('authorizationUrl');
  });

  it('includes per-server instructions in inspect listings when the aggregator has them', async () => {
    const req = { query: {} };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);

    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'servers',
      serverInstructions: {
        context7: '# Context7 Instructions',
      },
    });
  });

  it('returns an inspectable empty result for an unavailable configured static server', async () => {
    mockedLoadDeclaredServerConfigs.mockReturnValue({
      staticServers: {
        slow: { type: 'stdio', command: 'node', args: ['slow-server.js'], tags: ['slow'] },
      },
      templateServers: {},
      errors: [],
    });
    const serverManager = {
      getClients: vi.fn(() => new Map()),
      getInstructionAggregator: vi.fn(() => undefined),
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getServerRegistry: vi.fn(() => ({ getServerNames: vi.fn(() => []), get: vi.fn(() => undefined) })),
    };
    const handler = createInspectHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { query: { target: 'slow' } }, res);
    await invokeInspectRoute(handler, { query: { target: 'slow' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'server',
      server: 'slow',
      available: false,
      loadTracked: true,
      tools: [],
    });
  });

  it('lists tools for a connected configured static server without a loading tracker', async () => {
    mockedLoadDeclaredServerConfigs.mockReturnValue({
      staticServers: {
        context7: { type: 'stdio', command: 'node', args: ['context7.js'], tags: ['context7'] },
      },
      templateServers: {},
      errors: [],
    });
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { query: { target: 'context7' } }, res);
    await invokeInspectRoute(inspectHandler, { query: { target: 'context7' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'server',
      server: 'context7',
      status: 'connected',
      available: true,
      totalTools: 1,
      tools: [{ tool: 'query-docs' }],
    });
  });
  it.each(['registry', 'aggregator'])(
    'does not turn a failed inventory into an empty %s fallback',
    async (fallback) => {
      const target = outboundConnections.get('context7')!;
      vi.mocked(target.adapter.request).mockRejectedValue(new Error('private upstream outage'));
      const lazy = {
        getToolRegistry: () =>
          fallback === 'registry' ? { listTools: () => ({ tools: [], totalCount: 0, hasMore: false }) } : undefined,
        getCapabilityAggregator: () => ({ getCurrentCapabilities: () => ({ tools: [] }) }),
      };
      const manager = {
        getClients: () => outboundConnections,
        getClient: (name: string) => outboundConnections.get(name),
        getLazyLoadingOrchestrator: () => lazy,
        getInstructionAggregator: () => undefined,
        getServerRegistry: () => ({ get: () => undefined }),
      };
      const handler = createInspectHandler(manager as never);
      const req = { query: { target: 'context7' } };
      const res = createMockResponse();
      await invokeInspectRoute(scopeAuthMiddleware, req, res);
      await invokeInspectRoute(handler, req, res);
      expect(res.statusCode, JSON.stringify(res.body)).toBe(503);
      expect(res.body).toEqual({ error: 'Tool inventory not available for this server' });
    },
  );
  it.each(['context7', 'context7/query-docs'])(
    'projects internal cursor overload for %s distinctly from unavailable provider inventory',
    async (target) => {
      const acquire = vi
        .spyOn(runtimeCatalog, 'acquireRuntimeCapabilityCatalog')
        .mockRejectedValueOnce(new CapabilityCursorCapacityError());
      try {
        const req = { query: { target } };
        const res = createMockResponse();
        await invokeInspectRoute(scopeAuthMiddleware, req, res);
        await invokeInspectRoute(inspectHandler, req, res);
        expect(res.statusCode).toBe(503);
        expect(res.body).toEqual({ error: 'Capability cursor capacity exceeded', code: 'gateway_overloaded' });
      } finally {
        acquire.mockRestore();
      }
    },
  );
});
