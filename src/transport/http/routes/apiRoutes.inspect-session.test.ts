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

  it('touches an existing REST template session instead of creating another template instance', async () => {
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

    const createTemplateBasedServers = vi.fn();
    const touchEphemeralClient = vi.fn();
    const registerTemplate = vi.fn();
    const getRenderedHashForSession = vi.fn(() => 'template-hash');
    const serverManager = {
      getClients: vi.fn(() => outboundConnections),
      getInstructionAggregator: vi.fn(() => ({
        hasInstructions: () => false,
        getServerInstructions: () => undefined,
      })),
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getServerRegistry: vi.fn(() => ({
        getServerNames: vi.fn(() => ['serena']),
        get: vi.fn(() => makeAdapter('serena', ['serena'], ServerStatus.Disconnected)),
        has: vi.fn(() => true),
        registerTemplate,
      })),
      getClient: vi.fn((name: string) => outboundConnections.get(name)),
      getTemplateServerManager: vi.fn(() => ({
        getRenderedHashForSession,
        createTemplateBasedServers,
        touchEphemeralClient,
      })),
      getClientTransports: vi.fn(() => ({})),
    };
    const handler = createInspectHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { query: { target: 'serena' } }, res);
    await invokeInspectRoute(handler, { query: { target: 'serena' } }, res);

    expect(createTemplateBasedServers).not.toHaveBeenCalled();
    expect(touchEphemeralClient).toHaveBeenCalledWith('context-session');
    expect(registerTemplate).not.toHaveBeenCalled();
  });

  it('uses header-only targeted inspect as a routing-only request session', async () => {
    const listTools = vi.fn().mockResolvedValue({
      tools: [{ name: 'find_symbol', description: 'Find symbol', inputSchema: { type: 'object' } }],
    });
    const connection = {
      name: 'serena',
      transport: { tags: ['serena'] } as never,
      client: { listTools } as never,
      status: ClientStatus.Connected,
    };
    const resolveConnection = vi.fn(() => connection);
    const createTemplateBasedServers = vi.fn();
    const registerTemplate = vi.fn();
    const serverManager = {
      getClients: vi.fn(() => new Map()),
      getInstructionAggregator: vi.fn(() => ({
        hasInstructions: () => false,
        getServerInstructions: () => undefined,
      })),
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getServerRegistry: vi.fn(() => ({
        getServerNames: vi.fn(() => ['serena']),
        get: vi.fn(() => ({
          ...makeAdapter('serena', ['serena']),
          type: ServerType.Template,
          resolveConnection,
        })),
        has: vi.fn(() => false),
        registerTemplate,
        resolveConnection,
      })),
      getClient: vi.fn(() => undefined),
      getTemplateServerManager: vi.fn(() => ({
        getRenderedHashForSession: vi.fn(() => undefined),
        createTemplateBasedServers,
      })),
      getClientTransports: vi.fn(() => ({})),
    };
    const handler = createInspectHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(
      scopeAuthMiddleware,
      { query: { target: 'serena' }, headers: { 'mcp-session-id': 'header-session' } },
      res,
    );
    await invokeInspectRoute(
      handler,
      { query: { target: 'serena' }, headers: { 'mcp-session-id': 'header-session' } },
      res,
    );

    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(resolveConnection).toHaveBeenCalledWith('serena', { sessionId: 'header-session' });
    expect(createTemplateBasedServers).not.toHaveBeenCalled();
    expect(registerTemplate).not.toHaveBeenCalled();
    expect(mockedLoadConfigWithTemplates).not.toHaveBeenCalled();
  });

  it('returns instructions and summarized tools for server targets in non-lazy mode', async () => {
    const req = { query: { target: 'context7' } };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'server',
      server: 'context7',
      instructions: '# Context7 Instructions',
      totalTools: 1,
      hasMore: false,
      tools: [
        {
          tool: 'query-docs',
          qualifiedName: 'context7_1mcp_query-docs',
          description: 'Query docs',
          requiredArgs: 2,
          optionalArgs: 0,
        },
      ],
    });
  });

  it('resolves template-backed server targets by clean server name', async () => {
    outboundConnections = new Map([
      [
        'serena:template-hash',
        {
          name: 'serena',
          transport: { tags: ['serena'] } as never,
          client: {
            listTools: vi.fn().mockResolvedValue({
              tools: [
                {
                  name: 'find_symbol',
                  description: 'Find symbol',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      name_path_pattern: { type: 'string' },
                      relative_path: { type: 'string' },
                    },
                    required: ['name_path_pattern'],
                  },
                },
              ],
            }),
          } as never,
          status: ClientStatus.Connected,
        },
      ],
    ]) as unknown as OutboundConnections;

    const adapters = new Map<string, ServerAdapter>([['serena', makeAdapter('serena', ['serena'])]]);

    const serverRegistry = {
      getServerNames: vi.fn(() => Array.from(adapters.keys())),
      get: vi.fn((name: string) => adapters.get(name)),
    };

    const serverManager = {
      getClients: vi.fn(() => outboundConnections),
      getInstructionAggregator: vi.fn(() => ({
        hasInstructions: (name: string) => name === 'serena',
        getServerInstructions: (name: string) => (name === 'serena' ? '# Serena Instructions' : undefined),
      })),
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getServerRegistry: vi.fn(() => serverRegistry),
      getClient: vi.fn((name: string) => outboundConnections.get(name)),
    };

    inspectHandler = createInspectHandler(serverManager as never);

    const req = { query: { target: 'serena' } };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);

    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'server',
      server: 'serena',
      instructions: '# Serena Instructions',
      totalTools: 1,
      hasMore: false,
      tools: [
        {
          tool: 'find_symbol',
          qualifiedName: 'serena_1mcp_find_symbol',
          description: 'Find symbol',
          requiredArgs: 1,
          optionalArgs: 1,
        },
      ],
    });
  });

  it('treats declared template servers as known server targets even before a live connection exists', async () => {
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

    const serverRegistry = {
      getServerNames: vi.fn(() => []),
      get: vi.fn(() => undefined),
    };

    const serverManager = {
      getClients: vi.fn(() => new Map()),
      getInstructionAggregator: vi.fn(() => ({
        hasInstructions: () => false,
        getServerInstructions: () => undefined,
      })),
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getServerRegistry: vi.fn(() => serverRegistry),
      getClient: vi.fn(() => undefined),
    };

    inspectHandler = createInspectHandler(serverManager as never);

    const req = { query: { target: 'serena' } };
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(inspectHandler, req, res);

    expect(res.statusCode, JSON.stringify(res.body)).toBe(503);
    expect(res.body).toMatchObject({ error: "Server 'serena' is not currently connected" });
  });
});
