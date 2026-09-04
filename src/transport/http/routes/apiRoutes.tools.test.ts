import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';

import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createToolsHandler } from './apiRoutes.js';

const mockedLoadDeclaredServerConfigs = vi.hoisted(() => vi.fn());
const mockedLoadConfigWithTemplates = vi.hoisted(() => vi.fn());
const mockedExtractRequestContext = vi.hoisted(() => vi.fn());
const mockedGetTransportConfig = vi.hoisted(() => vi.fn());
const mockedAuthorizeRequestTemplateContext = vi.hoisted(() =>
  vi.fn(({ context }: { context: unknown }): Record<string, unknown> => ({ status: 'trusted', context })),
);

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
  authorizeRequestTemplateContext: mockedAuthorizeRequestTemplateContext,
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

function connectionWithTools(
  name: string,
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
  tags: string[] = [],
) {
  return createMockOutboundConnection({
    name,
    tags,
    adapter: {
      request: vi.fn().mockResolvedValue({ tools }),
    },
  });
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
    mockedAuthorizeRequestTemplateContext.mockImplementation(({ context }) => ({ status: 'trusted', context }));
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
              connectionWithTools('alpha', [
                { name: 'alpha_one', description: 'First', inputSchema: {} },
                { name: 'alpha_two', description: 'Second', inputSchema: {} },
                { name: 'alpha_three', description: 'Third', inputSchema: {} },
              ]),
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

  it('keeps same-name fallback template instances isolated by the selected connection key', async () => {
    const filteredScopeMiddleware: RequestHandler = (_req, res, next) => {
      res.locals.validatedTags = ['session-one'];
      res.locals.tagFilterMode = 'simple-or';
      next();
    };
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(
        () =>
          new Map([
            [
              'instance-one',
              connectionWithTools(
                'template',
                [{ name: 'first_tool', description: 'First instance', inputSchema: {} }],
                ['session-one'],
              ),
            ],
            [
              'instance-two',
              connectionWithTools(
                'template',
                [{ name: 'second_tool', description: 'Second instance', inputSchema: {} }],
                ['session-two'],
              ),
            ],
          ]),
      ),
    };
    const handler = createToolsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(filteredScopeMiddleware, { query: {} }, res);
    await invokeInspectRoute(handler, { query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      totalCount: 1,
      servers: ['template'],
      tools: [{ name: 'first_tool', server: 'template', description: 'First instance' }],
    });
  });

  it('reports only servers with matching tools in fallback mode', async () => {
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(
        () =>
          new Map([
            [
              'alpha',
              connectionWithTools('alpha', [{ name: 'alpha_tool', description: 'Alpha tool', inputSchema: {} }]),
            ],
            ['beta', connectionWithTools('beta', [{ name: 'beta_tool', description: 'Beta tool', inputSchema: {} }])],
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
              connectionWithTools('alpha', [
                { name: 'alpha_one', description: 'First', inputSchema: {} },
                { name: 'alpha_two', description: 'Second', inputSchema: {} },
              ]),
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
    );
    expect(res.body).toEqual(mockResult);
  });

  it('serves the current Capability Snapshot through the Capability Catalog without refreshing', async () => {
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
    expect(callMetaTool).toHaveBeenCalledWith(
      'tool_list',
      expect.any(Object),
      expect.objectContaining({ sessionId: 'header-session', serverCandidates: expect.any(Map) }),
    );
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
    expect(callMetaTool).toHaveBeenCalledWith(
      'tool_list',
      expect.any(Object),
      expect.objectContaining({ sessionId: 'derived-session-id', serverCandidates: expect.any(Map) }),
    );
    expect(res.setHeader).toHaveBeenCalledWith('mcp-session-id', 'derived-session-id');
  });

  it('keeps unsigned context out of template rendering when verification rejects it', async () => {
    mockedLoadConfigWithTemplates.mockClear();
    mockedExtractRequestContext.mockReturnValue({
      project: { name: 'untrusted', path: '/tmp/untrusted' },
      user: { username: 'remote' },
      environment: { variables: {} },
      sessionId: 'untrusted-session',
    });
    mockedAuthorizeRequestTemplateContext.mockReturnValue({
      status: 'untrusted',
      reason: 'proof_missing',
      contextHash: 'hash',
    });
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(() => new Map()),
    };
    const handler = createToolsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(handler, { query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(mockedLoadConfigWithTemplates).not.toHaveBeenCalled();
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
