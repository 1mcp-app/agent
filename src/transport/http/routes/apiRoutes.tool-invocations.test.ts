import { createMockLegacySdkAdapter, createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/index.js';
import { type JsonValue, OneMcpProtocolError, toJsonValue, toProtocolTool } from '@src/sdk/contracts/index.js';

import type { Request, RequestHandler, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiRoutes, createToolInvocationsHandler } from './apiRoutes.js';

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

function createToolCallAdapter(callTool: (params: JsonValue | undefined) => Promise<unknown>) {
  return createMockLegacySdkAdapter({
    request: vi.fn(async ({ method, params }) => {
      if (method !== 'tools/call') return {};
      return toJsonValue(await callTool(params));
    }),
  });
}

async function invokeInspectRoute(handler: RequestHandler, req: Partial<Request>, res: Response): Promise<void> {
  await handler(req as Request, res, () => undefined);
}
describe('apiRoutes /api/tool-invocations', () => {
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

  it('rate limits tool invocations before authorization', async () => {
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClient: vi.fn(() => undefined),
      getClients: vi.fn(() => new Map()),
    };
    const authorizationAttempts = vi.fn((_req: Request, _res: Response, next: () => void) => next());
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createApiRoutes(serverManager as never, authorizationAttempts, { windowMs: 60_000, max: 1 }));

    const firstResponse = await request(app).post('/api/v1/tool-invocations').send({ tool: 'server/tool' });
    const secondResponse = await request(app).post('/api/v1/tool-invocations').send({ tool: 'server/tool' });

    expect(firstResponse.status).toBe(503);
    expect(secondResponse.status).toBe(429);
    expect(authorizationAttempts).toHaveBeenCalledTimes(1);
  });

  it('allows tool invocation bursts above the OAuth rate limit by default', async () => {
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClient: vi.fn(() => undefined),
      getClients: vi.fn(() => new Map()),
    };
    const authorizationAttempts = vi.fn((_req: Request, _res: Response, next: () => void) => next());
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createApiRoutes(serverManager as never, authorizationAttempts));

    const responses = await Promise.all(
      Array.from({ length: 101 }, () => request(app).post('/api/v1/tool-invocations').send({ tool: 'server/tool' })),
    );

    expect(responses.every((response) => response.status === 503)).toBe(true);
    expect(authorizationAttempts).toHaveBeenCalledTimes(101);
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
    const callTool = vi.fn().mockRejectedValue({ detail: 'boom' });
    const connection = createMockOutboundConnection({
      name: 'server',
      adapter: createToolCallAdapter(callTool),
    });
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(() => new Map()),
      getClient: vi.fn(() => connection),
    };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'server/tool' } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'server/tool' } }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'Upstream error: Upstream error' });
  });

  it('recovers OAuth for a non-lazy HTTP direct tool invocation', async () => {
    const oauthProvider = { invalidateCredentials: vi.fn().mockResolvedValue(undefined) };
    const transport = { oauthProvider, close: vi.fn().mockResolvedValue(undefined) };
    const unauthorized = new OneMcpProtocolError(401, 'Server returned 401 after successful authentication');
    const client = {
      callTool: vi.fn().mockRejectedValue(unauthorized),
      close: vi.fn().mockResolvedValue(undefined),
      transport,
    };
    let connection: ReturnType<typeof createMockOutboundConnection> & {
      client: typeof client;
      transport: typeof transport;
    };
    const adapter = createToolCallAdapter(async (params) => {
      try {
        return await client.callTool(params);
      } catch (error) {
        connection.status = ClientStatus.AwaitingOAuth;
        await oauthProvider.invalidateCredentials('tokens');
        await client.close();
        connection.transport = { ...transport };
        throw error;
      }
    });
    connection = Object.assign(createMockOutboundConnection({ name: 'server', adapter }), { client, transport });
    const connections = new Map([['server', connection]]) as OutboundConnections;
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(() => connections),
      getClient: vi.fn(() => connection),
    };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'server/tool' } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'server/tool' } }, res);

    expect(res.statusCode).toBe(502);
    expect(connection.status).toBe(ClientStatus.AwaitingOAuth);
    expect(oauthProvider.invalidateCredentials).toHaveBeenCalledWith('tokens');
    expect(connection.client.close).toHaveBeenCalledOnce();
    expect(connection.transport).not.toBe(transport);
  });

  it('returns 404 for disabled direct invocations and does not call upstream', async () => {
    mockedGetTransportConfig.mockReturnValue({
      server: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['tool'],
      },
    });

    const callTool = vi.fn();
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(() => new Map()),
      getClient: vi.fn(() => ({
        client: { callTool },
      })),
    };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'server/tool' } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'server/tool' } }, res);

    expect(res.statusCode).toBe(404);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('does not reveal disabled tool details for filtered-out direct invocation servers', async () => {
    mockedGetTransportConfig.mockReturnValue({
      hidden: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['tool'],
      },
    });

    const hiddenCallTool = vi.fn();
    const visibleConnections = new Map([
      [
        'visible',
        {
          name: 'visible',
          transport: { tags: ['public'] } as never,
          client: { callTool: vi.fn() } as never,
          status: ClientStatus.Connected,
        },
      ],
    ]);
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(() => visibleConnections),
      getClient: vi.fn(() => ({
        client: { callTool: hiddenCallTool },
      })),
    };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();

    res.locals.tagFilterMode = 'simple-or';
    res.locals.tags = ['public'];
    await invokeInspectRoute(handler, { body: { tool: 'hidden/tool' } }, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Server not found: hidden' });
    expect(hiddenCallTool).not.toHaveBeenCalled();
  });

  it('does not call upstream before direct invocation while checking disabled tool visibility', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'done' }],
      isError: false,
    });
    const connections = new Map([
      [
        'server',
        {
          name: 'server',
          adapter: createToolCallAdapter(callTool),
          transport: {} as never,
          client: { callTool } as never,
          status: ClientStatus.Connected,
        },
      ],
    ]) as unknown as OutboundConnections;
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(() => connections),
      getClient: vi.fn((name: string) => connections.get(name)),
    };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'server/tool', args: { x: 1 } } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'server/tool', args: { x: 1 } } }, res);

    expect(res.statusCode).toBe(200);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith({
      name: 'tool',
      arguments: { x: 1 },
    });
  });

  it('returns 404 for disabled lazy invocations and does not call meta-tool', async () => {
    mockedGetTransportConfig.mockReturnValue({
      alpha: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['alpha_1mcp_mytool'],
      },
    });

    const callMetaTool = vi.fn();
    const serverManager = { getLazyLoadingOrchestrator: vi.fn(() => ({ callMetaTool })) };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'alpha/mytool', args: { x: 1 } } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'alpha/mytool', args: { x: 1 } } }, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: "Tool is disabled: alpha:mytool. Use '1mcp mcp tools enable alpha mytool' to re-enable it.",
    });
    expect(callMetaTool).not.toHaveBeenCalled();
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
          adapter: createToolCallAdapter(callTool),
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

  it('routes lazy template invocations through the request session rendered hash only', async () => {
    const firstCallTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'first' }],
      isError: false,
    });
    const secondCallTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'second' }],
      isError: false,
    });
    const connections = new Map([
      [
        'serena:first',
        {
          name: 'serena',
          adapter: createToolCallAdapter(firstCallTool),
          transport: { tags: ['serena'] } as never,
          client: { callTool: firstCallTool } as never,
          status: ClientStatus.Connected,
        },
      ],
      [
        'serena:second',
        {
          name: 'serena',
          adapter: createToolCallAdapter(secondCallTool),
          transport: { tags: ['serena'] } as never,
          client: { callTool: secondCallTool } as never,
          status: ClientStatus.Connected,
        },
      ],
    ]) as unknown as OutboundConnections;
    const lazyOrchestrator = {
      getToolRegistry: vi.fn(() =>
        ToolRegistry.fromToolsMap(
          new Map([['serena', [toProtocolTool({ name: 'list_memories', inputSchema: { type: 'object' } })]]]),
        ),
      ),
      getSchemaCache: vi.fn(() => ({
        getIfCached: () => null,
        getOrLoad: vi.fn(),
      })),
      callMetaTool: vi.fn(),
    };
    const getRenderedHashForSession = vi.fn((sessionId: string, templateName: string) =>
      sessionId === 'rest-session' && templateName === 'serena' ? 'second' : undefined,
    );
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => lazyOrchestrator),
      getClients: vi.fn(() => connections),
      getTemplateServerManager: vi.fn(() => ({
        getRenderedHashForSession,
        getAllRenderedHashesForSession: vi.fn(() => undefined),
      })),
    };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(
      scopeAuthMiddleware,
      {
        headers: { 'mcp-session-id': 'rest-session' },
        body: { tool: 'serena/list_memories' },
      },
      res,
    );
    await invokeInspectRoute(
      handler,
      {
        headers: { 'mcp-session-id': 'rest-session' },
        body: { tool: 'serena/list_memories' },
      },
      res,
    );

    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(firstCallTool).not.toHaveBeenCalled();
    expect(secondCallTool).toHaveBeenCalledTimes(1);
    expect(secondCallTool).toHaveBeenCalledWith({
      name: 'list_memories',
      arguments: {},
    });
    expect(lazyOrchestrator.callMetaTool).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      result: { content: [{ type: 'text', text: 'second' }], isError: false },
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
      expect.objectContaining({ sessionId: 'rest-session-123', serverCandidates: expect.any(Map) }),
    );
  });
});
