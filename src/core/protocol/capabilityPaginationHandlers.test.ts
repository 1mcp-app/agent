import {
  createMockClient,
  createMockLegacyOutboundConnection,
  createMockTransport,
} from '@test/unit-utils/MockFactories.js';

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  ErrorCode,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ResourceListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  registerCapabilityPaginationNotifications,
  unregisterCapabilityPaginationForwarder,
} from '@src/core/capabilities/capabilityPagination.js';
import type { OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import { ClientStatus, ServerStatus } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupClientToServerNotifications } from './notificationHandlers.js';
import { registerPromptHandlers } from './promptRequestHandlers.js';
import { registerResourceHandlers } from './resourceRequestHandlers.js';
import { registerToolHandlers } from './toolRequestHandlers.js';

const mockGetTransportConfig = vi.fn(() => ({}));
const mockGetAvailableTools = vi.fn(() => [
  { name: 'runtime_status', description: 'Runtime status', inputSchema: { type: 'object' } },
]);

vi.mock('@src/config/mcpConfigManager.js', () => ({
  McpConfigManager: {
    getInstance: () => ({ getTransportConfig: mockGetTransportConfig }),
  },
}));

vi.mock('@src/core/capabilities/internalCapabilitiesProvider.js', () => ({
  InternalCapabilitiesProvider: {
    getInstance: () => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      getAvailableTools: mockGetAvailableTools,
      executeTool: vi.fn(),
    }),
  },
}));

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return { getTemplateServerManager: () => undefined };
    },
  },
}));

describe('capability pagination protocol handlers', () => {
  let handlers: Map<unknown, (request: { params?: { cursor?: string } }) => Promise<unknown>>;

  beforeEach(() => {
    handlers = new Map();
    mockGetTransportConfig.mockReturnValue({});
  });

  function connection(name: string, client: Partial<Client>, tags: string[] = []): OutboundConnection {
    const outbound = createMockLegacyOutboundConnection({
      name,
      status: ClientStatus.Connected,
      capabilities: { resources: {}, prompts: {}, tools: {} },
      client: createMockClient(client) as Client,
      transport: { ...createMockTransport(), timeout: 5000, tags },
    });
    return outbound;
  }

  function registerResources(connections: OutboundConnections) {
    registerResourceHandlers(connections, {
      enablePagination: true,
      status: ServerStatus.Connected,
      server: {
        setRequestHandler: vi.fn((schema, handler) => handlers.set(schema, handler)),
      },
    } as never);

    const handler = handlers.get(ListResourcesRequestSchema);
    if (!handler) throw new Error('resources/list handler was not registered');
    return handler;
  }

  it('walks providers in canonical order and preserves opaque upstream cursors', async () => {
    const alphaList = vi
      .fn()
      .mockResolvedValueOnce({ resources: [{ uri: 'alpha-1', name: 'alpha-1' }], nextCursor: 'alpha-next' })
      .mockResolvedValueOnce({ resources: [{ uri: 'alpha-2', name: 'alpha-2' }] });
    const zetaList = vi.fn().mockResolvedValue({ resources: [{ uri: 'zeta-1', name: 'zeta-1' }] });
    const connections: OutboundConnections = new Map([
      ['zeta-key', connection('zeta', { listResources: zetaList })],
      ['alpha-key', connection('alpha', { listResources: alphaList })],
    ]);
    const handler = registerResources(connections);

    const first = (await handler({ params: {} })) as {
      resources: Array<{ name: string }>;
      nextCursor?: string;
    };
    const second = (await handler({ params: { cursor: first.nextCursor } })) as typeof first;
    const third = (await handler({ params: { cursor: second.nextCursor } })) as typeof first;

    expect(first.resources.map((resource) => resource.name)).toEqual(['alpha-1']);
    expect(second.resources.map((resource) => resource.name)).toEqual(['alpha-2']);
    expect(third.resources.map((resource) => resource.name)).toEqual(['zeta-1']);
    expect(first.nextCursor).toBeDefined();
    expect(first.nextCursor).not.toBe('alpha-next');
    expect(third.nextCursor).toBeUndefined();
    expect(alphaList).toHaveBeenNthCalledWith(1, { cursor: undefined }, expect.anything());
    expect(alphaList).toHaveBeenNthCalledWith(2, { cursor: 'alpha-next' }, expect.anything());
    expect(zetaList).toHaveBeenCalledTimes(1);
  });

  it('uses the same canonical walk for resource templates', async () => {
    const alphaList = vi.fn().mockResolvedValue({
      resourceTemplates: [{ uriTemplate: 'alpha://{id}', name: 'alpha-template' }],
    });
    const zetaList = vi.fn().mockResolvedValue({
      resourceTemplates: [{ uriTemplate: 'zeta://{id}', name: 'zeta-template' }],
    });
    const connections: OutboundConnections = new Map([
      ['zeta-key', connection('zeta', { listResourceTemplates: zetaList })],
      ['alpha-key', connection('alpha', { listResourceTemplates: alphaList })],
    ]);

    registerResources(connections);
    const handler = handlers.get(ListResourceTemplatesRequestSchema);
    if (!handler) throw new Error('resources/templates/list handler was not registered');

    const first = (await handler({ params: {} })) as {
      resourceTemplates: Array<{ name: string }>;
      nextCursor?: string;
    };
    const second = (await handler({ params: { cursor: first.nextCursor } })) as typeof first;

    expect(first.resourceTemplates.map((template) => template.name)).toEqual(['alpha-template']);
    expect(second.resourceTemplates.map((template) => template.name)).toEqual(['zeta-template']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('uses the same canonical walk for prompts', async () => {
    const alphaList = vi.fn().mockResolvedValue({ prompts: [{ name: 'alpha-prompt' }] });
    const zetaList = vi.fn().mockResolvedValue({ prompts: [{ name: 'zeta-prompt' }] });
    const connections: OutboundConnections = new Map([
      ['zeta-key', connection('zeta', { listPrompts: zetaList })],
      ['alpha-key', connection('alpha', { listPrompts: alphaList })],
    ]);
    registerPromptHandlers(connections, {
      enablePagination: true,
      status: ServerStatus.Connected,
      server: {
        setRequestHandler: vi.fn((schema, handler) => handlers.set(schema, handler)),
      },
    } as never);
    const handler = handlers.get(ListPromptsRequestSchema);
    if (!handler) throw new Error('prompts/list handler was not registered');

    const first = (await handler({ params: {} })) as { prompts: Array<{ name: string }>; nextCursor?: string };
    const second = (await handler({ params: { cursor: first.nextCursor } })) as typeof first;

    expect(first.prompts.map((prompt) => prompt.name)).toEqual(['alpha_1mcp_alpha-prompt']);
    expect(second.prompts.map((prompt) => prompt.name)).toEqual(['zeta_1mcp_zeta-prompt']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('walks upstream tool pages and includes internal tools exactly once', async () => {
    const alphaList = vi
      .fn()
      .mockResolvedValueOnce({
        tools: [{ name: 'alpha-1', inputSchema: { type: 'object' } }],
        nextCursor: 'alpha-next',
      })
      .mockResolvedValueOnce({ tools: [{ name: 'alpha-2', inputSchema: { type: 'object' } }] });
    const zetaList = vi.fn().mockResolvedValue({
      tools: [{ name: 'zeta-1', inputSchema: { type: 'object' } }],
    });
    const connections: OutboundConnections = new Map([
      ['zeta-key', connection('zeta', { listTools: zetaList })],
      ['alpha-key', connection('alpha', { listTools: alphaList })],
    ]);
    registerToolHandlers(connections, {
      enablePagination: true,
      status: ServerStatus.Connected,
      server: {
        setRequestHandler: vi.fn((schema, handler) => handlers.set(schema, handler)),
      },
    } as never);
    const handler = handlers.get(ListToolsRequestSchema);
    if (!handler) throw new Error('tools/list handler was not registered');

    const pages: Array<Array<string>> = [];
    let cursor: string | undefined;
    do {
      const result = (await handler({ params: cursor ? { cursor } : {} })) as {
        tools: Array<{ name: string }>;
        nextCursor?: string;
      };
      pages.push(result.tools.map((tool) => tool.name));
      cursor = result.nextCursor;
    } while (cursor);

    expect(pages).toEqual([
      ['1mcp_1mcp_runtime_status'],
      ['alpha_1mcp_alpha-1'],
      ['alpha_1mcp_alpha-2'],
      ['zeta_1mcp_zeta-1'],
    ]);
    expect(alphaList).toHaveBeenNthCalledWith(2, { cursor: 'alpha-next' }, expect.anything());
  });

  it('rejects a tool cursor after a configured description override changes', async () => {
    const listTools = vi
      .fn()
      .mockResolvedValueOnce({
        tools: [{ name: 'search', description: 'Search upstream', inputSchema: { type: 'object' } }],
        nextCursor: 'alpha-next',
      })
      .mockResolvedValueOnce({ tools: [] });
    const connections = new Map([['alpha', connection('alpha', { listTools })]]) as OutboundConnections;
    registerToolHandlers(connections, {
      enablePagination: true,
      status: ServerStatus.Connected,
      server: { setRequestHandler: vi.fn((schema, handler) => handlers.set(schema, handler)) },
    } as never);
    const handler = handlers.get(ListToolsRequestSchema);
    if (!handler) throw new Error('tools/list handler was not registered');
    const first = (await handler({ params: {} })) as { nextCursor?: string };
    listTools.mockClear();

    mockGetTransportConfig.mockReturnValue({
      alpha: { type: 'stdio', command: 'node', toolDescriptionOverrides: { search: 'Search safely' } },
    });

    await expect(handler({ params: { cursor: first.nextCursor } })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      data: { reason: 'stale_generation' },
    });
    expect(listTools).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed text', 'not-a-cursor!'],
    ['legacy cursor', Buffer.from('alpha:upstream-cursor').toString('base64')],
    ['valid base64 garbage', Buffer.from('not-json').toString('base64url')],
  ])('rejects %s without calling a provider', async (_label, cursor) => {
    const listResources = vi.fn().mockResolvedValue({ resources: [] });
    const handler = registerResources(new Map([['alpha', connection('alpha', { listResources })]]));

    await expect(handler({ params: { cursor } })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      message: 'Invalid capability pagination cursor',
    });
    expect(listResources).not.toHaveBeenCalled();
  });

  it('rejects a cursor used for a different capability kind', async () => {
    const listTools = vi.fn().mockResolvedValue({ tools: [{ name: 'alpha-tool', inputSchema: { type: 'object' } }] });
    const listResources = vi.fn().mockResolvedValue({ resources: [{ uri: 'alpha-resource', name: 'alpha-resource' }] });
    const connections = new Map([['alpha', connection('alpha', { listTools, listResources })]]) as OutboundConnections;

    registerToolHandlers(connections, {
      enablePagination: true,
      status: ServerStatus.Connected,
      server: { setRequestHandler: vi.fn((schema, handler) => handlers.set(schema, handler)) },
    } as never);
    const toolsHandler = handlers.get(ListToolsRequestSchema);
    if (!toolsHandler) throw new Error('tools/list handler was not registered');
    const toolsPage = (await toolsHandler({ params: {} })) as { nextCursor?: string };
    expect(toolsPage.nextCursor).toBeDefined();

    const resourcesHandler = registerResources(connections);
    await expect(resourcesHandler({ params: { cursor: toolsPage.nextCursor } })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      data: { reason: 'capability_kind_mismatch' },
    });
    expect(listResources).not.toHaveBeenCalled();
  });

  it('rejects a cursor after provider availability changes', async () => {
    const alphaList = vi.fn().mockResolvedValue({
      resources: [{ uri: 'alpha-resource', name: 'alpha-resource' }],
      nextCursor: 'alpha-next',
    });
    const zetaList = vi.fn().mockResolvedValue({ resources: [{ uri: 'zeta-resource', name: 'zeta-resource' }] });
    const connections = new Map([
      ['alpha', connection('alpha', { listResources: alphaList })],
      ['zeta', connection('zeta', { listResources: zetaList })],
    ]) as OutboundConnections;
    const handler = registerResources(connections);
    const first = (await handler({ params: {} })) as { nextCursor?: string };

    connections.get('zeta')!.status = ClientStatus.Disconnected;

    await expect(handler({ params: { cursor: first.nextCursor } })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      data: { reason: 'stale_generation' },
    });
    expect(alphaList).toHaveBeenCalledTimes(1);
  });

  it('continues past failures with sanitized partial metadata through the final page', async () => {
    const alphaList = vi.fn().mockRejectedValue(new Error('secret token must never escape'));
    const betaList = vi
      .fn()
      .mockResolvedValueOnce({
        resources: [{ uri: 'beta-1', name: 'beta-1' }],
        nextCursor: 'beta-next',
      })
      .mockResolvedValueOnce({ resources: [{ uri: 'beta-2', name: 'beta-2' }] });
    const handler = registerResources(
      new Map([
        ['beta', connection('beta', { listResources: betaList })],
        ['alpha', connection('alpha', { listResources: alphaList })],
      ]),
    );

    const first = (await handler({ params: {} })) as {
      resources: Array<{ name: string }>;
      nextCursor?: string;
      _meta?: Record<string, unknown>;
    };
    const second = (await handler({ params: { cursor: first.nextCursor } })) as typeof first;

    expect(first.resources.map((resource) => resource.name)).toEqual(['beta-1']);
    expect(second.resources.map((resource) => resource.name)).toEqual(['beta-2']);
    expect(second.nextCursor).toBeUndefined();
    expect(second._meta).toEqual(first._meta);
    expect(first._meta).toEqual({
      'app.1mcp/capability-pagination': {
        partial: true,
        failures: [{ provider: 'alpha', code: 'upstream_list_failed' }],
        recovery: {
          action: 'restart_without_cursor',
          description: 'Restart the capability listing without a cursor to retry unavailable providers.',
        },
      },
    });
    expect(JSON.stringify(first._meta)).not.toContain('secret token');
  });

  it('drains healthy pages when pagination is disabled and retains items before a later failure', async () => {
    const alphaList = vi
      .fn()
      .mockResolvedValueOnce({
        resources: [{ uri: 'alpha-1', name: 'alpha-1' }],
        nextCursor: 'alpha-next',
      })
      .mockRejectedValueOnce(new Error('private failure detail'));
    const zetaList = vi.fn().mockResolvedValue({ resources: [{ uri: 'zeta-1', name: 'zeta-1' }] });
    const connections = new Map([
      ['zeta', connection('zeta', { listResources: zetaList })],
      ['alpha', connection('alpha', { listResources: alphaList })],
    ]) as OutboundConnections;
    registerResourceHandlers(connections, {
      enablePagination: false,
      status: ServerStatus.Connected,
      server: { setRequestHandler: vi.fn((schema, handler) => handlers.set(schema, handler)) },
    } as never);
    const handler = handlers.get(ListResourcesRequestSchema);
    if (!handler) throw new Error('resources/list handler was not registered');

    const result = (await handler({ params: {} })) as {
      resources: Array<{ name: string }>;
      nextCursor?: string;
      _meta?: Record<string, unknown>;
    };

    expect(result.resources.map((resource) => resource.name)).toEqual(['alpha-1', 'zeta-1']);
    expect(result.nextCursor).toBeUndefined();
    expect(result._meta).toMatchObject({
      'app.1mcp/capability-pagination': {
        partial: true,
        failures: [{ provider: 'alpha', code: 'upstream_list_failed' }],
      },
    });
    expect(JSON.stringify(result._meta)).not.toContain('private failure detail');
  });

  it('stops pagination-disabled draining when an upstream cursor repeats', async () => {
    const listResources = vi.fn().mockResolvedValue({
      resources: [{ uri: 'alpha-resource', name: 'alpha-resource' }],
      nextCursor: 'repeated-cursor',
    });
    const connections = new Map([['alpha', connection('alpha', { listResources })]]) as OutboundConnections;
    registerResourceHandlers(connections, {
      enablePagination: false,
      status: ServerStatus.Connected,
      server: { setRequestHandler: vi.fn((schema, handler) => handlers.set(schema, handler)) },
    } as never);
    const handler = handlers.get(ListResourcesRequestSchema);
    if (!handler) throw new Error('resources/list handler was not registered');

    const result = (await handler({ params: {} })) as {
      resources: Array<{ name: string }>;
      _meta?: Record<string, unknown>;
    };

    expect(result.resources).toHaveLength(2);
    expect(listResources).toHaveBeenCalledTimes(2);
    expect(result._meta).toMatchObject({
      'app.1mcp/capability-pagination': {
        partial: true,
        failures: [{ provider: 'alpha', code: 'upstream_list_failed' }],
      },
    });
  });

  it('caps pagination-disabled draining for unique upstream cursors', async () => {
    let page = 0;
    const listResources = vi.fn().mockImplementation(async () => {
      page += 1;
      return {
        resources: [{ uri: `alpha-${page}`, name: `alpha-${page}` }],
        nextCursor: `cursor-${page}`,
      };
    });
    const connections = new Map([['alpha', connection('alpha', { listResources })]]) as OutboundConnections;
    registerResourceHandlers(connections, {
      enablePagination: false,
      status: ServerStatus.Connected,
      server: { setRequestHandler: vi.fn((schema, handler) => handlers.set(schema, handler)) },
    } as never);
    const handler = handlers.get(ListResourcesRequestSchema);
    if (!handler) throw new Error('resources/list handler was not registered');

    const result = (await handler({ params: {} })) as {
      resources: Array<{ name: string }>;
      _meta?: Record<string, unknown>;
    };

    expect(result.resources).toHaveLength(1000);
    expect(listResources).toHaveBeenCalledTimes(1000);
    expect(result._meta).toMatchObject({
      'app.1mcp/capability-pagination': {
        partial: true,
        failures: [{ provider: 'alpha', code: 'upstream_list_failed' }],
      },
    });
  });

  it('invalidates a resource walk when an upstream list-changed notification arrives', async () => {
    const notificationHandlers = new Map<unknown, (notification: unknown) => Promise<unknown>>();
    const listResources = vi.fn().mockResolvedValue({
      resources: [{ uri: 'alpha-1', name: 'alpha-1' }],
      nextCursor: 'alpha-next',
    });
    const outbound = connection('alpha', {
      listResources,
      setNotificationHandler: vi.fn((schema, handler) => notificationHandlers.set(schema, handler)),
    });
    const connections = new Map([['alpha', outbound]]) as OutboundConnections;
    const inboundNotification = vi.fn().mockResolvedValue(undefined);
    const inbound = {
      enablePagination: true,
      status: ServerStatus.Connected,
      server: {
        transport: {},
        notification: inboundNotification,
        setRequestHandler: vi.fn((schema, handler) => handlers.set(schema, handler)),
      },
    } as never;
    registerResourceHandlers(connections, inbound);
    registerCapabilityPaginationNotifications(connections, outbound);
    setupClientToServerNotifications(connections, inbound);
    // Re-registering replaces the SDK handlers while preserving the shared inbound forwarder.
    registerCapabilityPaginationNotifications(connections, outbound);
    const listHandler = handlers.get(ListResourcesRequestSchema);
    const notificationHandler = notificationHandlers.get(ResourceListChangedNotificationSchema);
    if (!listHandler || !notificationHandler) throw new Error('required handlers were not registered');
    const first = (await listHandler({ params: {} })) as { nextCursor?: string };

    await notificationHandler({ method: 'notifications/resources/list_changed', params: {} });

    await expect(listHandler({ params: { cursor: first.nextCursor } })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      data: { reason: 'stale_generation' },
    });
    expect(listResources).toHaveBeenCalledTimes(1);
    expect(inboundNotification).toHaveBeenCalledWith({
      method: 'notifications/resources/list_changed',
      params: { server: 'alpha' },
    });
  });

  it('applies the cursor contract to the lazy tool surface', async () => {
    const connections = new Map() as OutboundConnections;
    const lazyLoadingOrchestrator = {
      isEnabled: () => true,
      getCapabilitiesForVisibility: vi.fn().mockResolvedValue({
        tools: [
          { name: 'tool_schema', inputSchema: { type: 'object' } },
          { name: 'tool_list', inputSchema: { type: 'object' } },
        ],
      }),
    } as never;
    registerToolHandlers(
      connections,
      {
        enablePagination: true,
        status: ServerStatus.Connected,
        server: { setRequestHandler: vi.fn((schema, handler) => handlers.set(schema, handler)) },
      } as never,
      lazyLoadingOrchestrator,
    );
    const handler = handlers.get(ListToolsRequestSchema);
    if (!handler) throw new Error('tools/list handler was not registered');

    const result = (await handler({ params: {} })) as { tools: Array<{ name: string }>; nextCursor?: string };

    expect(result.tools.map((tool) => tool.name)).toEqual(['1mcp_1mcp_runtime_status', 'tool_list', 'tool_schema']);
    expect(result.nextCursor).toBeUndefined();
    await expect(handler({ params: { cursor: 'legacy!' } })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
  });

  it('rejects a cursor when the filter selection changes without changing providers', async () => {
    const listResources = vi.fn().mockResolvedValue({
      resources: [{ uri: 'alpha-1', name: 'alpha-1' }],
      nextCursor: 'alpha-next',
    });
    const connections = new Map([['alpha', connection('alpha', { listResources }, ['safe'])]]) as OutboundConnections;
    const inbound = {
      enablePagination: true,
      tagFilterMode: 'simple-or',
      tags: ['safe'],
      status: ServerStatus.Connected,
      server: { setRequestHandler: vi.fn((schema, handler) => handlers.set(schema, handler)) },
    } as never;
    registerResourceHandlers(connections, inbound);
    const handler = handlers.get(ListResourcesRequestSchema);
    if (!handler) throw new Error('resources/list handler was not registered');
    const first = (await handler({ params: {} })) as { nextCursor?: string };

    (inbound as { tags: string[] }).tags = ['safe', 'still-visible'];

    await expect(handler({ params: { cursor: first.nextCursor } })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      data: { reason: 'filter_mismatch' },
    });
    expect(listResources).toHaveBeenCalledTimes(1);
  });

  it('skips empty final providers without consuming an aggregate page', async () => {
    const alphaList = vi.fn().mockResolvedValue({ resources: [] });
    const betaList = vi.fn().mockResolvedValue({ resources: [{ uri: 'beta-1', name: 'beta-1' }] });
    const handler = registerResources(
      new Map([
        ['beta', connection('beta', { listResources: betaList })],
        ['alpha', connection('alpha', { listResources: alphaList })],
      ]),
    );

    const result = (await handler({ params: {} })) as {
      resources: Array<{ name: string }>;
      nextCursor?: string;
    };

    expect(result.resources.map((resource) => resource.name)).toEqual(['beta-1']);
    expect(result.nextCursor).toBeUndefined();
    expect(alphaList).toHaveBeenCalledTimes(1);
    expect(betaList).toHaveBeenCalledTimes(1);
  });

  it('invalidates from a list-changed notification on a provider added after handler setup', async () => {
    const connections = new Map([
      [
        'alpha',
        connection('alpha', {
          listResources: vi.fn().mockResolvedValue({
            resources: [{ uri: 'alpha-1', name: 'alpha-1' }],
            nextCursor: 'alpha-next',
          }),
        }),
      ],
    ]) as OutboundConnections;
    const handler = registerResources(connections);
    const lateHandlers = new Map<unknown, (notification: unknown) => Promise<unknown>>();
    const late = connection('late', {
      listResources: vi.fn().mockResolvedValue({ resources: [{ uri: 'late-1', name: 'late-1' }] }),
      setNotificationHandler: vi.fn((schema, notificationHandler) => lateHandlers.set(schema, notificationHandler)),
    });
    connections.set('late', late);
    registerCapabilityPaginationNotifications(connections, late);
    const first = (await handler({ params: {} })) as { nextCursor?: string };
    const lateListChanged = lateHandlers.get(ResourceListChangedNotificationSchema);
    if (!lateListChanged) throw new Error('late provider list-changed handler was not registered');

    await lateListChanged({ method: 'notifications/resources/list_changed', params: {} });

    await expect(handler({ params: { cursor: first.nextCursor } })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      data: { reason: 'stale_generation' },
    });
  });

  it('round-trips partial state for more than one hundred failed providers', async () => {
    const entries: Array<[string, OutboundConnection]> = Array.from({ length: 130 }, (_, index) => {
      const name = `failed-${String(index).padStart(3, '0')}`;
      return [name, connection(name, { listResources: vi.fn().mockRejectedValue(new Error('private')) })];
    });
    const healthyList = vi
      .fn()
      .mockResolvedValueOnce({
        resources: [{ uri: 'healthy-1', name: 'healthy-1' }],
        nextCursor: 'healthy-next',
      })
      .mockResolvedValueOnce({ resources: [{ uri: 'healthy-2', name: 'healthy-2' }] });
    entries.push(['healthy', connection('healthy', { listResources: healthyList })]);
    const handler = registerResources(new Map(entries));

    const first = (await handler({ params: {} })) as {
      nextCursor?: string;
      _meta: { 'app.1mcp/capability-pagination': { failures: unknown[] } };
    };
    const second = (await handler({ params: { cursor: first.nextCursor } })) as typeof first;

    expect(first.nextCursor?.length).toBeLessThan(8192);
    expect(first._meta['app.1mcp/capability-pagination'].failures).toHaveLength(130);
    expect(second._meta).toEqual(first._meta);
  });

  it('round-trips an opaque upstream cursor larger than the legacy aggregate limit', async () => {
    const upstreamCursor = 'opaque-'.repeat(1500);
    const listResources = vi
      .fn()
      .mockResolvedValueOnce({
        resources: [{ uri: 'alpha-1', name: 'alpha-1' }],
        nextCursor: upstreamCursor,
      })
      .mockResolvedValueOnce({ resources: [{ uri: 'alpha-2', name: 'alpha-2' }] });
    const handler = registerResources(new Map([['alpha', connection('alpha', { listResources })]]));

    const first = (await handler({ params: {} })) as { nextCursor?: string };
    const second = (await handler({ params: { cursor: first.nextCursor } })) as {
      resources: Array<{ name: string }>;
    };

    expect(first.nextCursor?.length).toBeGreaterThan(8192);
    expect(second.resources.map((resource) => resource.name)).toEqual(['alpha-2']);
    expect(listResources).toHaveBeenLastCalledWith(
      { cursor: upstreamCursor },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('removes a disconnected inbound forwarder without disturbing active sessions', async () => {
    const notificationHandlers = new Map<unknown, (notification: unknown) => Promise<unknown>>();
    const outbound = connection('alpha', {
      setNotificationHandler: vi.fn((schema, handler) => notificationHandlers.set(schema, handler)),
    });
    const connections = new Map([['alpha', outbound]]) as OutboundConnections;
    const disconnectedInbound = {};
    const activeInbound = {};
    const disconnectedForwarder = vi.fn().mockResolvedValue(undefined);
    const activeForwarder = vi.fn().mockResolvedValue(undefined);
    registerCapabilityPaginationNotifications(connections, outbound, disconnectedInbound, disconnectedForwarder);
    registerCapabilityPaginationNotifications(connections, outbound, activeInbound, activeForwarder);

    unregisterCapabilityPaginationForwarder(connections, disconnectedInbound);
    const listChanged = notificationHandlers.get(ResourceListChangedNotificationSchema);
    if (!listChanged) throw new Error('resource list-changed handler was not registered');
    await listChanged({ method: 'notifications/resources/list_changed', params: {} });

    expect(disconnectedForwarder).not.toHaveBeenCalled();
    expect(activeForwarder).toHaveBeenCalledOnce();
  });
});
