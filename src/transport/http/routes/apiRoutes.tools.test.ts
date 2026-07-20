import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';

import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createToolsHandler } from './apiRoutes.js';

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

describe('apiRoutes /api/tools', () => {
  const scopeAuthMiddleware: RequestHandler = (_req, res, next) => {
    res.locals.validatedTags = [];
    res.locals.tagFilterMode = 'none';
    next();
  };

  beforeEach(() => {
    mockedGetTransportConfig.mockReturnValue({});
    mockedExtractRequestContext.mockReset();
    mockedExtractRequestContext.mockReturnValue(undefined);
  });

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

  it('filters disabled tools from fallback mode results', async () => {
    mockedGetTransportConfig.mockReturnValue({
      alpha: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['alpha_two'],
      },
    });

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
                    ],
                  }),
                },
              },
            ],
          ]),
      ),
    };
    const handler = createToolsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { query: {} }, res);
    await invokeInspectRoute(handler, { query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      totalCount: 1,
      hasMore: false,
      servers: ['alpha'],
      tools: [{ name: 'alpha_one', server: 'alpha', description: 'First' }],
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

  it('serves the cached tool registry without refreshing all capabilities', async () => {
    const refreshCapabilities = vi.fn();
    const callMetaTool = vi.fn();
    const registry = ToolRegistry.fromToolsWithServer([
      {
        server: 'alpha',
        tool: { name: 'alpha_tool', description: 'Alpha tool', inputSchema: { type: 'object' } },
      },
    ]);
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => ({
        callMetaTool,
        refreshCapabilities,
        getToolRegistry: () => registry,
        getSchemaCache: () => ({}),
      })),
      getClients: vi.fn(() => new Map()),
    };
    const handler = createToolsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { query: {} }, res);
    await invokeInspectRoute(handler, { query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      tools: [{ name: 'alpha_tool', server: 'alpha' }],
      totalCount: 1,
      servers: ['alpha'],
    });
    expect(refreshCapabilities).not.toHaveBeenCalled();
    expect(callMetaTool).not.toHaveBeenCalled();
  });

  it('canonicalizes context to the header session before lazy tool listing', async () => {
    const context = {
      sessionId: 'context-session',
      project: { path: '/tmp/project' },
      user: {},
      environment: {},
    };
    const templateConfig = {
      type: 'stdio',
      command: 'uvx',
      args: ['serena', '{{sessionId}}'],
      tags: ['serena'],
    };
    mockedExtractRequestContext.mockReturnValue(context);
    mockedLoadConfigWithTemplates.mockResolvedValue({
      staticServers: {},
      templateServers: { serena: templateConfig },
      errors: [],
    });

    const callMetaTool = vi.fn().mockResolvedValue({ tools: [], totalCount: 0, servers: [], hasMore: false });
    const refreshCapabilities = vi.fn();
    const createTemplateBasedServers = vi.fn();
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => ({ callMetaTool, refreshCapabilities })),
      getClients: vi.fn(() => new Map()),
      getClientTransports: vi.fn(() => ({})),
      getTemplateServerManager: vi.fn(() => ({
        getRenderedHashForSession: vi.fn(() => undefined),
        createTemplateBasedServers,
      })),
      getServerRegistry: vi.fn(() => ({
        has: vi.fn(() => false),
        registerTemplate: vi.fn(),
      })),
    };
    const handler = createToolsHandler(serverManager as never);
    const res = createMockResponse();
    const req = { headers: { 'mcp-session-id': 'header-session' }, query: {} };

    await invokeInspectRoute(scopeAuthMiddleware, req, res);
    await invokeInspectRoute(handler, req, res);

    expect(mockedLoadConfigWithTemplates).toHaveBeenCalledWith({
      ...context,
      sessionId: 'header-session',
    });
    expect(createTemplateBasedServers).toHaveBeenCalledWith(
      'header-session',
      { ...context, sessionId: 'header-session' },
      expect.any(Object),
      { mcpTemplates: { serena: templateConfig } },
      expect.any(Map),
      {},
      'ephemeral',
    );
    expect(callMetaTool).toHaveBeenCalledWith('tool_list', expect.any(Object), 'header-session', undefined);
    expect(res.setHeader).toHaveBeenCalledWith('mcp-session-id', 'header-session');
    expect(context.sessionId).toBe('context-session');
  });

  it('prepares request context before lazy tool listing', async () => {
    const context = {
      sessionId: 'context-session',
      project: { path: '/tmp/project' },
      user: {},
      environment: {},
    };
    const templateConfig = {
      type: 'stdio',
      command: 'uvx',
      args: ['serena', '{{project.path}}'],
      tags: ['serena'],
    };
    mockedExtractRequestContext.mockReturnValue(context);
    mockedLoadConfigWithTemplates.mockResolvedValue({
      staticServers: {},
      templateServers: { serena: templateConfig },
      errors: [],
    });

    const callMetaTool = vi.fn().mockResolvedValue({ tools: [], totalCount: 0, servers: [], hasMore: false });
    const refreshCapabilities = vi.fn();
    const createTemplateBasedServers = vi.fn();
    const registerTemplate = vi.fn();
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => ({ callMetaTool, refreshCapabilities })),
      getClients: vi.fn(() => new Map()),
      getClientTransports: vi.fn(() => ({})),
      getTemplateServerManager: vi.fn(() => ({
        getRenderedHashForSession: vi.fn(() => undefined),
        createTemplateBasedServers,
      })),
      getServerRegistry: vi.fn(() => ({
        has: vi.fn(() => false),
        registerTemplate,
      })),
    };
    const handler = createToolsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { query: {} }, res);
    await invokeInspectRoute(handler, { query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(createTemplateBasedServers).toHaveBeenCalledWith(
      'derived-session-id',
      { ...context, sessionId: 'derived-session-id' },
      expect.any(Object),
      { mcpTemplates: { serena: templateConfig } },
      expect.any(Map),
      {},
      'ephemeral',
    );
    expect(registerTemplate).toHaveBeenCalledWith('serena', templateConfig);
    expect(refreshCapabilities).toHaveBeenCalledOnce();
    expect(callMetaTool).toHaveBeenCalledWith('tool_list', expect.any(Object), 'derived-session-id', undefined);
    expect(res.setHeader).toHaveBeenCalledWith('mcp-session-id', 'derived-session-id');
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
