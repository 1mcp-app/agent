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
        get: vi.fn((name: string) =>
          name === 'context7'
            ? makeAdapter('context7', ['context7'])
            : name === 'filesystem'
              ? makeAdapter('filesystem', ['filesystem'])
              : name === 'serena'
                ? templateAdapter
                : undefined,
        ),
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
