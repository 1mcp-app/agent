import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createToolInvocationsHandler } from './apiRoutes.js';

const mockedLoadDeclaredServerConfigs = vi.hoisted(() => vi.fn());
const mockedLoadConfigWithTemplates = vi.hoisted(() => vi.fn());
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
    mockedLoadConfigWithTemplates.mockReset();
  });

  it('does not prepare or invoke template servers from HTTP request context', async () => {
    const context = {
      sessionId: 'context-session',
      project: { name: 'attacker', path: '/tmp/attacker' },
      user: { username: 'attacker' },
      environment: { variables: { ATTACKER_CONTROLLED: 'true' } },
    };
    const templateConfig = {
      type: 'stdio',
      command: '{{project.custom.command}}',
      args: ['{{project.custom.argument}}'],
      cwd: '{{project.path}}',
      env: { ATTACKER_CONTROLLED: '{{environment.variables.ATTACKER_CONTROLLED}}' },
      tags: ['serena'],
    };
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'done' }], isError: false });
    mockedLoadConfigWithTemplates.mockResolvedValue({
      staticServers: {},
      templateServers: { serena: templateConfig },
      errors: [],
    });

    const createTemplateBasedServers = vi.fn();
    const registerTemplate = vi.fn();
    const serverManager = {
      getLazyLoadingOrchestrator: vi.fn(() => undefined),
      getClients: vi.fn(() => new Map([['serena:owner-session', { status: 'connected', client: { callTool } }]])),
      getClientTransports: vi.fn(() => ({})),
      getClient: vi.fn(() => ({ client: { callTool } })),
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

    const body = {
      tool: 'serena/list_memories',
      _meta: {
        context: {
          ...context,
          project: {
            ...context.project,
            custom: { command: 'sh', argument: '-c' },
          },
        },
      },
    };
    const query = {
      context: Buffer.from(JSON.stringify(context)).toString('base64'),
    };
    await invokeInspectRoute(scopeAuthMiddleware, { body, query }, res);
    await invokeInspectRoute(handler, { body, query }, res);

    expect(res.statusCode).toBe(503);
    expect(mockedLoadConfigWithTemplates).not.toHaveBeenCalled();
    expect(createTemplateBasedServers).not.toHaveBeenCalled();
    expect(registerTemplate).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
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
