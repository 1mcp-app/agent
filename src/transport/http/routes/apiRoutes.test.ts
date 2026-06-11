import { type ServerAdapter, ServerStatus, ServerType } from '@src/core/server/adapters/types.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/index.js';

import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInspectHandler } from './apiRoutes.js';

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
        {
          name: 'context7',
          transport: { tags: ['context7'] } as never,
          client: {
            listTools: vi.fn().mockResolvedValue({
              tools: [
                {
                  name: 'context7_1mcp_query-docs',
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
            }),
          } as never,
          status: ClientStatus.Connected,
        },
      ],
      [
        'filesystem',
        {
          name: 'filesystem',
          transport: { tags: ['filesystem'] } as never,
          client: {
            listTools: vi.fn().mockResolvedValue({ tools: [] }),
          } as never,
          status: ClientStatus.Connected,
        },
      ],
      [
        'hidden',
        {
          name: 'hidden',
          transport: { tags: ['hidden'] } as never,
          client: {
            listTools: vi.fn().mockResolvedValue({ tools: [] }),
          } as never,
          status: ClientStatus.Connected,
        },
      ],
    ]) as unknown as OutboundConnections;

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
    outboundConnections.set('serena:template-hash', {
      name: 'serena',
      transport: { tags: ['serena'] } as never,
      client: {
        listTools: vi.fn().mockResolvedValue({
          tools: [
            { name: 'find_symbol', description: 'Find symbol', inputSchema: { type: 'object' } },
            { name: 'list_memories', description: 'List memories', inputSchema: { type: 'object' } },
          ],
        }),
      } as never,
      status: ClientStatus.Connected,
    } as never);

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
    if (!hiddenConnection?.client) {
      throw new Error('Hidden connection not found');
    }

    hiddenConnection.client.listTools = vi.fn().mockResolvedValue({
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

  it('preserves pagination metadata when inspecting a server through direct listTools', async () => {
    const pagedConnections = new Map(outboundConnections) as OutboundConnections;
    pagedConnections.set('context7', {
      ...pagedConnections.get('context7')!,
      client: {
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'query-docs',
              description: 'Query docs',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
          totalCount: 3,
          hasMore: true,
          nextCursor: 'cursor-2',
        }),
      } as never,
    });

    const serverRegistry = {
      getServerNames: vi.fn(() => ['context7', 'filesystem', 'hidden']),
      get: vi.fn(
        (name: string) =>
          ({
            context7: makeAdapter('context7', ['context7']),
            filesystem: makeAdapter('filesystem', ['filesystem']),
            hidden: makeAdapter('hidden', ['hidden']),
          })[name],
      ),
    };

    const serverManager = {
      getClients: vi.fn(() => pagedConnections),
      getInstructionAggregator: vi.fn(() => ({
        hasInstructions: () => false,
        getServerInstructions: () => undefined,
      })),
      getLazyLoadingOrchestrator: vi.fn(() => ({
        getToolRegistry: vi.fn(() => ({ listTools: vi.fn() })),
        getCapabilityAggregator: vi.fn(() => undefined),
      })),
      getServerRegistry: vi.fn(() => serverRegistry),
      getClient: vi.fn((name: string) => pagedConnections.get(name)),
    };

    const pagedInspectHandler = createInspectHandler(serverManager as never);
    const req = { query: { preset: 'dev-backend', target: 'context7', limit: '1', cursor: 'cursor-1' } };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(pagedInspectHandler, req, res);

    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'server',
      server: 'context7',
      totalTools: 3,
      hasMore: true,
      nextCursor: 'cursor-2',
    });
    expect(pagedConnections.get('context7')?.client?.listTools as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
      limit: 1,
      cursor: 'cursor-1',
    });
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
});
