import { createMockLegacyInboundConnection, createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { ClientStatus, type OutboundConnections } from '@src/core/types/index.js';
import { MCPError } from '@src/utils/core/errorTypes.js';

import { describe, expect, it, vi } from 'vitest';

import { registerToolHandlers } from './toolRequestHandlers.js';

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return { getTemplateServerManager: () => undefined };
    },
  },
}));

const catalogBinding = vi.hoisted(() => ({ connectionsPerAttempt: [] as unknown[][] }));

vi.mock('@src/sdk/legacy/server/protocol/resourceSubscriptions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@src/sdk/legacy/server/protocol/resourceSubscriptions.js')>();
  return {
    ...actual,
    bindOwnedCatalogConnections: (...args: Parameters<typeof actual.bindOwnedCatalogConnections>) => {
      catalogBinding.connectionsPerAttempt.push(Array.from(args[0].values()));
      return actual.bindOwnedCatalogConnections(...args);
    },
  };
});

type ListToolsHandler = (request: { params: Record<string, unknown> }) => Promise<unknown>;

const echo = { name: 'echo', inputSchema: { type: 'object' } };

function registerListTools(connections: OutboundConnections): ListToolsHandler {
  const handlers: ListToolsHandler[] = [];
  const inbound = createMockLegacyInboundConnection({
    context: { sessionId: 'session-1' },
    server: {
      setRequestHandler: vi.fn((_schema, handler) => handlers.push(handler as ListToolsHandler)),
    } as never,
  });
  registerToolHandlers(connections, inbound);
  return handlers[0];
}

function backend(overrides: Parameters<typeof createMockOutboundConnection>[0] = {}) {
  return createMockOutboundConnection({
    name: 'backend',
    status: ClientStatus.Connected,
    capabilities: { tools: {} },
    ...overrides,
  });
}

describe('registerToolHandlers backend replacement', () => {
  it('returns the catalog when an upstream adapter is replaced during the first listing', async () => {
    const connections: OutboundConnections = new Map();
    const replacement = backend({
      adapter: { request: vi.fn(async () => ({ tools: [echo] }) as never) },
    });
    const original = backend({
      adapter: {
        request: vi.fn(async () => {
          connections.set('backend', replacement);
          return { tools: [echo] } as never;
        }),
      },
    });
    connections.set('backend', original);

    const listTools = registerListTools(connections);
    const result = (await listTools({ params: {} })) as { tools: Array<{ name: string }> };

    expect(result.tools.map((tool) => tool.name)).toEqual(['backend_1mcp_echo']);
  });

  it('binds catalog coverage for the backend each attempt lists', async () => {
    const connections: OutboundConnections = new Map();
    const replacement = backend({ adapter: { request: vi.fn(async () => ({ tools: [echo] }) as never) } });
    const original = backend({
      adapter: {
        request: vi.fn(async () => {
          connections.set('backend', replacement);
          return { tools: [echo] } as never;
        }),
      },
    });
    connections.set('backend', original);
    catalogBinding.connectionsPerAttempt.length = 0;

    await registerListTools(connections)({ params: {} });

    expect(catalogBinding.connectionsPerAttempt).toHaveLength(2);
    expect(catalogBinding.connectionsPerAttempt[0]).toContain(original);
    expect(catalogBinding.connectionsPerAttempt[1]).toContain(replacement);
    expect(catalogBinding.connectionsPerAttempt[1]).not.toContain(original);
  });

  it('surfaces a gateway error when the backend changes again on the retry', async () => {
    const connections: OutboundConnections = new Map();
    const swapOnRequest = () => {
      const next = backend({
        adapter: { request: vi.fn(async () => swapOnRequest() as never) },
      });
      connections.set('backend', next);
      return { tools: [echo] };
    };
    connections.set(
      'backend',
      backend({
        adapter: {
          request: vi.fn(async () => swapOnRequest() as never),
        },
      }),
    );

    const listTools = registerListTools(connections);

    await expect(listTools({ params: {} })).rejects.toMatchObject({
      name: 'MCPError',
      message: 'Error listing tools',
      code: -32603,
    } satisfies Partial<MCPError>);
  });
});
