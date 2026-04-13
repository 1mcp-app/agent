import { type ServerAdapter, ServerStatus, ServerType } from '@src/core/server/adapters/types.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/index.js';

import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInspectHandler } from './apiRoutes.js';

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
});
