import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createToolInvocationsHandler } from './apiRoutes.js';

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

  it('prepares request context before direct tool invocation', async () => {
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
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'done' }], isError: false });
    mockedExtractRequestContext.mockReturnValue(context);
    mockedLoadConfigWithTemplates.mockResolvedValue({
      staticServers: {},
      templateServers: { serena: templateConfig },
      errors: [],
    });

    const createTemplateBasedServers = vi.fn();
    const registerTemplate = vi.fn();
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(() => new Map()),
      getClientTransports: vi.fn(() => ({})),
      getClient: vi.fn(() => undefined),
      getTemplateServerManager: vi.fn(() => ({
        getRenderedHashForSession: vi.fn(() => undefined),
        createTemplateBasedServers,
      })),
      getServerRegistry: vi.fn(() => ({
        has: vi.fn(() => false),
        registerTemplate,
        resolveConnection: vi.fn(() => ({ client: { callTool } })),
      })),
    };
    const handler = createToolInvocationsHandler(serverManager as never);
    const res = createMockResponse();

    await invokeInspectRoute(scopeAuthMiddleware, { body: { tool: 'serena/list_memories' } }, res);
    await invokeInspectRoute(handler, { body: { tool: 'serena/list_memories' } }, res);

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
    expect(callTool).toHaveBeenCalledWith({ name: 'list_memories', arguments: {} });
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
