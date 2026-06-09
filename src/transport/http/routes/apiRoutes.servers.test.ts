import { type ServerAdapter, ServerStatus, ServerType } from '@src/core/server/adapters/types.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/index.js';

import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServersHandler } from './apiRoutes.js';

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
