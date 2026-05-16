import { type ServerAdapter, ServerStatus, ServerType } from '@src/core/server/adapters/types.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/index.js';

import express from 'express';
import type { Request, RequestHandler, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createApiRoutes,
  createInspectHandler,
  createServersHandler,
  createToolInvocationsHandler,
  createToolsHandler,
} from './apiRoutes.js';

const mockedLoadDeclaredServerConfigs = vi.hoisted(() => vi.fn());
const mockedLoadConfigWithTemplates = vi.hoisted(() => vi.fn());
const mockedExtractRequestContext = vi.hoisted(() => vi.fn());

vi.mock('@src/config/configManager.js', () => ({
  ConfigManager: {
    getInstance: vi.fn(() => ({
      loadDeclaredServerConfigs: mockedLoadDeclaredServerConfigs,
      loadConfigWithTemplates: mockedLoadConfigWithTemplates,
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

function createMockResponse(): Response & { body?: unknown } {
  const response: Response & { body?: unknown } = {
    locals: {},
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  } as Response & { body?: unknown };

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

describe('apiRoutes /api/servers', () => {
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

  const scopeAuthMiddleware: RequestHandler = (_req, res, next) => {
    res.locals.validatedTags = [];
    res.locals.tagFilterMode = 'none';
    next();
  };

  beforeEach(() => {
    mockedLoadDeclaredServerConfigs.mockReset();
    mockedLoadDeclaredServerConfigs.mockReturnValue({
      staticServers: {},
      templateServers: {},
      errors: [],
    });

    outboundConnections = new Map([
      [
        'alpha',
        {
          name: 'alpha',
          transport: { tags: ['alpha'] } as never,
          client: { listTools: vi.fn().mockResolvedValue({ tools: [] }) } as never,
          status: ClientStatus.Connected,
        },
      ],
      [
        'beta:hash1',
        {
          name: 'beta',
          transport: { tags: ['beta'] } as never,
          client: { listTools: vi.fn().mockResolvedValue({ tools: [] }) } as never,
          status: ClientStatus.Connected,
        },
      ],
      [
        'beta:hash2',
        {
          name: 'beta',
          transport: { tags: ['beta'] } as never,
          client: { listTools: vi.fn().mockResolvedValue({ tools: [] }) } as never,
          status: ClientStatus.Connected,
        },
      ],
    ]) as unknown as OutboundConnections;
  });

  it('returns all connected servers sorted alphabetically', async () => {
    const adapters = new Map<string, ServerAdapter>([
      ['alpha', makeAdapter('alpha', ['alpha'])],
      ['beta', makeAdapter('beta', ['beta'])],
    ]);
    const serverManager = {
      getClients: vi.fn(() => outboundConnections),
      getInstructionAggregator: vi.fn(() => ({ hasInstructions: () => false })),
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getServerRegistry: vi.fn(() => ({
        getServerNames: vi.fn(() => Array.from(adapters.keys())),
        get: vi.fn((name: string) => adapters.get(name)),
      })),
    };

    const handler = createServersHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, {}, res);
    await invokeInspectRoute(handler, {}, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { kind: string; servers: Array<{ server: string }> };
    expect(body.kind).toBe('servers');
    expect(body.servers.map((s) => s.server)).toEqual(['alpha', 'beta']);
  });

  it('deduplicates template instances into a single server entry', async () => {
    const adapters = new Map<string, ServerAdapter>([['beta', makeAdapter('beta', ['beta'])]]);
    const serverManager = {
      getClients: vi.fn(() => outboundConnections),
      getInstructionAggregator: vi.fn(() => ({ hasInstructions: () => false })),
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getServerRegistry: vi.fn(() => ({
        getServerNames: vi.fn(() => Array.from(adapters.keys())),
        get: vi.fn((name: string) => adapters.get(name)),
      })),
    };

    const handler = createServersHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, {}, res);
    await invokeInspectRoute(handler, {}, res);

    const body = res.body as { servers: Array<{ server: string }> };
    const betaEntries = body.servers.filter((s) => s.server === 'beta');
    expect(betaEntries).toHaveLength(1);
  });

  it('includes registered-but-disconnected servers', async () => {
    const adapters = new Map<string, ServerAdapter>([
      ['alpha', makeAdapter('alpha', ['alpha'])],
      ['offline', makeAdapter('offline', ['offline'], ServerStatus.Disconnected)],
    ]);
    const serverManager = {
      getClients: vi.fn(() => new Map([['alpha', outboundConnections.get('alpha')!]])),
      getInstructionAggregator: vi.fn(() => ({ hasInstructions: () => false })),
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getServerRegistry: vi.fn(() => ({
        getServerNames: vi.fn(() => Array.from(adapters.keys())),
        get: vi.fn((name: string) => adapters.get(name)),
      })),
    };

    const handler = createServersHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, {}, res);
    await invokeInspectRoute(handler, {}, res);

    const body = res.body as { servers: Array<{ server: string }> };
    expect(body.servers.map((s) => s.server)).toContain('offline');
  });

  it('includes declared template servers even when no adapter has been registered yet', async () => {
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

    const serverManager = {
      getClients: vi.fn(() => new Map()),
      getInstructionAggregator: vi.fn(() => ({ hasInstructions: (name: string) => name === 'serena' })),
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getServerRegistry: vi.fn(() => ({
        getServerNames: vi.fn(() => []),
        get: vi.fn(() => undefined),
      })),
    };

    const handler = createServersHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, {}, res);
    await invokeInspectRoute(handler, {}, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'servers',
      servers: [{ server: 'serena', type: 'template', available: false, hasInstructions: true }],
    });
  });
});

describe('apiRoutes /api/tools', () => {
  const scopeAuthMiddleware: RequestHandler = (_req, res, next) => {
    res.locals.validatedTags = [];
    res.locals.tagFilterMode = 'none';
    next();
  };

  it('returns empty tool list when lazy orchestrator is unavailable', async () => {
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(() => new Map()),
    };
    const handler = createToolsHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { query: {} }, res);
    await invokeInspectRoute(handler, { query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ tools: [], totalCount: 0, servers: [], hasMore: false });
  });

  it('paginates fallback tool lists with cursor support when lazy orchestrator is unavailable', async () => {
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(
        () =>
          new Map([
            [
              'alpha',
              {
                status: 'connected',
                client: {
                  listTools: vi.fn().mockResolvedValue({
                    tools: [
                      { name: 'alpha_one', description: 'First', inputSchema: {} },
                      { name: 'alpha_two', description: 'Second', inputSchema: {} },
                      { name: 'alpha_three', description: 'Third', inputSchema: {} },
                    ],
                  }),
                },
              },
            ],
          ]),
      ),
    };
    const handler = createToolsHandler(serverManager as never);

    const firstRes = createMockResponse();
    const firstReq = { query: { limit: '2' } };
    await invokeInspectRoute(scopeAuthMiddleware, firstReq, firstRes);
    await invokeInspectRoute(handler, firstReq, firstRes);
    const firstBody = firstRes.body as {
      totalCount: number;
      hasMore: boolean;
      servers: string[];
      tools: Array<{ name: string; server: string; description: string }>;
      nextCursor?: string;
    };

    expect(firstRes.statusCode).toBe(200);
    expect(firstBody).toMatchObject({
      totalCount: 3,
      hasMore: true,
      servers: ['alpha'],
      tools: [
        { name: 'alpha_one', server: 'alpha', description: 'First' },
        { name: 'alpha_two', server: 'alpha', description: 'Second' },
      ],
    });
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const secondRes = createMockResponse();
    const secondReq = { query: { limit: '2', cursor: firstBody.nextCursor } };
    await invokeInspectRoute(scopeAuthMiddleware, secondReq, secondRes);
    await invokeInspectRoute(handler, secondReq, secondRes);
    const secondBody = secondRes.body as {
      totalCount: number;
      hasMore: boolean;
      servers: string[];
      tools: Array<{ name: string; server: string; description: string }>;
      nextCursor?: string;
    };

    expect(secondRes.statusCode).toBe(200);
    expect(secondBody).toMatchObject({
      totalCount: 3,
      hasMore: false,
      servers: ['alpha'],
      tools: [{ name: 'alpha_three', server: 'alpha', description: 'Third' }],
    });
    expect(secondBody.nextCursor).toBeUndefined();
  });

  it('reports only servers with matching tools in fallback mode', async () => {
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(
        () =>
          new Map([
            [
              'alpha',
              {
                status: 'connected',
                client: {
                  listTools: vi.fn().mockResolvedValue({
                    tools: [{ name: 'alpha_tool', description: 'Alpha tool', inputSchema: {} }],
                  }),
                },
              },
            ],
            [
              'beta',
              {
                status: 'connected',
                client: {
                  listTools: vi.fn().mockResolvedValue({
                    tools: [{ name: 'beta_tool', description: 'Beta tool', inputSchema: {} }],
                  }),
                },
              },
            ],
          ]),
      ),
    };
    const handler = createToolsHandler(serverManager as never);
    const res = createMockResponse();
    const req = { query: { pattern: 'alpha_*' } };

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(handler, req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      totalCount: 1,
      hasMore: false,
      servers: ['alpha'],
      tools: [{ name: 'alpha_tool', server: 'alpha', description: 'Alpha tool' }],
    });
  });

  it('passes query params to callMetaTool and returns result', async () => {
    const mockResult = { tools: [], totalCount: 0, servers: [], hasMore: false };
    const callMetaTool = vi.fn().mockResolvedValue(mockResult);
    const serverManager = { getLazyLoadingOrchestrator: vi.fn(() => ({ callMetaTool })) };
    const handler = createToolsHandler(serverManager as never);
    const res = createMockResponse();
    const req = { query: { server: 'alpha', pattern: 'foo', limit: '5', cursor: 'abc' } };
    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(handler, req, res);
    expect(res.statusCode).toBe(200);
    expect(callMetaTool).toHaveBeenCalledWith(
      'tool_list',
      {
        server: 'alpha',
        pattern: 'foo',
        limit: 5,
        cursor: 'abc',
      },
      undefined,
      undefined,
    );
    expect(res.body).toEqual(mockResult);
  });

  it('returns 400 on validation error from meta-tool', async () => {
    const callMetaTool = vi.fn().mockResolvedValue({
      tools: [],
      totalCount: 0,
      servers: [],
      hasMore: false,
      error: { type: 'validation', message: 'bad input' },
    });
    const serverManager = { getLazyLoadingOrchestrator: vi.fn(() => ({ callMetaTool })) };
    const handler = createToolsHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { query: {} }, res);
    await invokeInspectRoute(handler, { query: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 on not_found error from meta-tool', async () => {
    const callMetaTool = vi.fn().mockResolvedValue({
      tools: [],
      totalCount: 0,
      servers: [],
      hasMore: false,
      error: { type: 'not_found', message: 'not found' },
    });
    const serverManager = { getLazyLoadingOrchestrator: vi.fn(() => ({ callMetaTool })) };
    const handler = createToolsHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { query: {} }, res);
    await invokeInspectRoute(handler, { query: {} }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('apiRoutes /api/tool-invocations', () => {
  const scopeAuthMiddleware: RequestHandler = (_req, res, next) => {
    res.locals.validatedTags = [];
    res.locals.tagFilterMode = 'none';
    next();
  };

  it('rejects browser-origin POST requests before reaching the tool invocation handler', async () => {
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClient: vi.fn(() => undefined),
      getClients: vi.fn(() => new Map()),
    };
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createApiRoutes(serverManager as never, scopeAuthMiddleware));

    const response = await request(app)
      .post('/api/v1/tool-invocations')
      .set('Origin', 'http://evil.example.com')
      .send({ tool: 'server/tool' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Cross-origin requests are not allowed for this endpoint' });
    expect(serverManager.getLazyLoadingOrchestrator).not.toHaveBeenCalled();
    expect(serverManager.getClient).not.toHaveBeenCalled();
  });

  it('returns 400 when tool field is missing', async () => {
    const serverManager = { getLazyLoadingOrchestrator: vi.fn(() => undefined) };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { body: {} }, res);
    await invokeInspectRoute(handler, { body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid tool format (no slash)', async () => {
    const serverManager = { getLazyLoadingOrchestrator: vi.fn(() => undefined) };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'notavalidref' } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'notavalidref' } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 503 when server is not connected and lazy orchestrator is unavailable', async () => {
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClient: vi.fn(() => undefined),
      getClients: vi.fn(() => new Map()),
    };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'server/tool' } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'server/tool' } }, res);
    expect(res.statusCode).toBe(503);
  });

  it('returns a safe upstream error message for direct invocation failures', async () => {
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(() => new Map()),
      getClient: vi.fn(() => ({
        client: {
          callTool: vi.fn().mockRejectedValue({ detail: 'boom' }),
        },
      })),
    };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'server/tool' } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'server/tool' } }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'Upstream error: Upstream error' });
  });

  it('resolves dynamic template connection keys for direct invocation', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'done' }],
      isError: false,
    });
    const filteredConnections = new Map([
      [
        'serena:abc123',
        {
          name: 'serena',
          transport: { tags: ['serena'] } as never,
          client: { callTool } as never,
          status: ClientStatus.Connected,
        },
      ],
    ]);
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(() => filteredConnections),
      getClient: vi.fn(() => undefined),
    };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'serena/list_memories', args: { limit: 1 } } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'serena/list_memories', args: { limit: 1 } } }, res);

    expect(res.statusCode).toBe(200);
    expect(callTool).toHaveBeenCalledWith({
      name: 'list_memories',
      arguments: { limit: 1 },
    });
    expect(res.body).toEqual({
      result: { content: [{ type: 'text', text: 'done' }], isError: false },
      server: 'serena',
      tool: 'list_memories',
    });
  });

  it('returns 200 with result on success', async () => {
    const mockResult = {
      result: { content: [{ type: 'text', text: 'done' }], isError: false },
      server: 'alpha',
      tool: 'mytool',
    };
    const callMetaTool = vi.fn().mockResolvedValue(mockResult);
    const serverManager = { getLazyLoadingOrchestrator: vi.fn(() => ({ callMetaTool })) };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'alpha/mytool', args: { x: 1 } } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'alpha/mytool', args: { x: 1 } } }, res);
    expect(res.statusCode).toBe(200);
    expect(callMetaTool).toHaveBeenCalledWith(
      'tool_invoke',
      { server: 'alpha', toolName: 'mytool', args: { x: 1 } },
      undefined,
      undefined,
    );
    expect(res.body).toEqual(mockResult);
  });

  it('passes request session id to lazy meta-tool invocation routing', async () => {
    const mockResult = {
      result: { content: [{ type: 'text', text: 'done' }], isError: false },
      server: 'alpha',
      tool: 'mytool',
    };
    const callMetaTool = vi.fn().mockResolvedValue(mockResult);
    const serverManager = { getLazyLoadingOrchestrator: vi.fn(() => ({ callMetaTool })) };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(
      scopeAuthMiddleware,
      {
        headers: { 'mcp-session-id': 'rest-session-123' },
        body: { tool: 'alpha/mytool', args: { x: 1 } },
      },
      res,
    );
    await invokeInspectRoute(
      handler,
      {
        headers: { 'mcp-session-id': 'rest-session-123' },
        body: { tool: 'alpha/mytool', args: { x: 1 } },
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(callMetaTool).toHaveBeenCalledWith(
      'tool_invoke',
      { server: 'alpha', toolName: 'mytool', args: { x: 1 } },
      'rest-session-123',
      undefined,
    );
  });

  it('returns 200 even when result.isError is true', async () => {
    const mockResult = {
      result: { content: [{ type: 'text', text: 'err' }], isError: true },
      server: 'alpha',
      tool: 'mytool',
    };
    const callMetaTool = vi.fn().mockResolvedValue(mockResult);
    const serverManager = { getLazyLoadingOrchestrator: vi.fn(() => ({ callMetaTool })) };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'alpha/mytool' } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'alpha/mytool' } }, res);
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when tool not found', async () => {
    const callMetaTool = vi.fn().mockResolvedValue({
      result: {},
      server: 'alpha',
      tool: 'mytool',
      error: { type: 'not_found', message: 'tool not found' },
    });
    const serverManager = { getLazyLoadingOrchestrator: vi.fn(() => ({ callMetaTool })) };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'alpha/mytool' } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'alpha/mytool' } }, res);
    expect(res.statusCode).toBe(404);
  });

  it('returns 503 when server not connected', async () => {
    const callMetaTool = vi.fn().mockResolvedValue({
      result: {},
      server: 'alpha',
      tool: 'mytool',
      error: { type: 'upstream', message: 'server not connected' },
    });
    const serverManager = { getLazyLoadingOrchestrator: vi.fn(() => ({ callMetaTool })) };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'alpha/mytool' } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'alpha/mytool' } }, res);
    expect(res.statusCode).toBe(503);
  });

  it('returns 502 for other upstream errors', async () => {
    const callMetaTool = vi.fn().mockResolvedValue({
      result: {},
      server: 'alpha',
      tool: 'mytool',
      error: { type: 'upstream', message: 'upstream failure' },
    });
    const serverManager = { getLazyLoadingOrchestrator: vi.fn(() => ({ callMetaTool })) };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();
    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'alpha/mytool' } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'alpha/mytool' } }, res);
    expect(res.statusCode).toBe(502);
  });
});
