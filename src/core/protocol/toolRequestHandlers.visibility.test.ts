import { createMockLegacyInboundConnection, createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import * as toolSchemaBoundary from '@src/core/validation/toolSchemaBoundary.js';
import { CAPABILITY_PAGINATION_META_KEY } from '@src/core/capabilities/capabilityPagination.js';
import type { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import { MetaToolProvider } from '@src/core/capabilities/metaToolProvider.js';
import { SchemaCache } from '@src/core/capabilities/schemaCache.js';
import type { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/index.js';
import { SchemaBoundaryError } from '@src/core/validation/schemaBoundary.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerToolHandlers } from './toolRequestHandlers.js';

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return { getTemplateServerManager: () => undefined };
    },
  },
}));

describe('registerToolHandlers capability visibility', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    {
      name: 'tool_list',
      args: { limit: 'invalid' },
      schema: { type: 'object', properties: { limit: { type: 'number' } } },
      defaults: { tools: [], totalCount: 0, servers: [], hasMore: false },
    },
    {
      name: 'tool_schema',
      args: {},
      schema: { type: 'object', required: ['server', 'toolName'] },
      defaults: { schema: {} },
    },
    {
      name: 'tool_invoke',
      args: { args: {} },
      schema: { type: 'object', required: ['server', 'toolName', 'args'] },
      defaults: { result: {}, server: '', tool: '' },
    },
  ])('preserves the structured $name validation error without invocation', async ({ name, args, schema, defaults }) => {
    const handlers: Array<(request: { params: { name: string; arguments: unknown } }) => Promise<unknown>> = [];
    const inbound = createMockLegacyInboundConnection({
      server: { setRequestHandler: vi.fn((_schema, handler) => handlers.push(handler)) } as never,
    });
    const callMetaTool = vi.fn();
    const orchestrator = {
      isEnabled: () => true,
      callMetaTool,
      getCapabilitiesForVisibility: vi.fn().mockResolvedValue({ tools: [{ name, inputSchema: schema }] }),
    } as unknown as LazyLoadingOrchestrator;
    registerToolHandlers(new Map(), inbound, orchestrator);
    const result = (await handlers[1]({ params: { name, arguments: args } })) as {
      isError: boolean;
      content: Array<{ text: string }>;
      structuredContent: unknown;
    };
    const expected = { ...defaults, error: { type: 'validation', message: 'schema_input_invalid' } };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual(expected);
    expect(result.structuredContent).toEqual(expected);
    expect(callMetaTool).not.toHaveBeenCalled();
  });

  it('re-resolves the Server Candidate Set for each meta-tool request', async () => {
    type CapturedHandler = (request: { params: { name: string; arguments: unknown } }) => Promise<unknown>;
    const handlers: CapturedHandler[] = [];
    const inbound = createMockLegacyInboundConnection({
      context: { sessionId: 'session-1' },
      tags: ['safe'],
      tagFilterMode: 'simple-or',
      server: {
        setRequestHandler: vi.fn((_schema, handler) => handlers.push(handler)),
      } as never,
    });
    const connections: OutboundConnections = new Map([
      [
        'ready',
        createMockOutboundConnection({
          name: 'ready',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          tags: ['safe'],
        }),
      ],
      [
        'late',
        createMockOutboundConnection({
          name: 'late',
          status: ClientStatus.Restarting,
          capabilities: { tools: {} },
          tags: ['safe'],
        }),
      ],
      [
        'excluded',
        createMockOutboundConnection({
          name: 'excluded',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          tags: ['private'],
        }),
      ],
    ]);
    const callMetaTool = vi.fn().mockResolvedValue({ tools: [] });
    const orchestrator = {
      isEnabled: () => true,
      isMetaTool: () => true,
      callMetaTool,
      getCapabilitiesForVisibility: vi.fn().mockResolvedValue({
        tools: [{ name: 'tool_list', inputSchema: { type: 'object' } }],
      }),
    } as unknown as LazyLoadingOrchestrator;

    registerToolHandlers(connections, inbound, orchestrator);
    const callHandler = handlers[1];

    await callHandler({ params: { name: 'tool_list', arguments: {} } });
    expect(Array.from(callMetaTool.mock.calls[0][2].serverCandidates.entries())).toEqual([['ready', 'ready']]);

    connections.get('late')!.status = ClientStatus.Connected;
    await callHandler({ params: { name: 'tool_list', arguments: {} } });

    expect(Array.from(callMetaTool.mock.calls[1][2].serverCandidates.entries())).toEqual([
      ['ready', 'ready'],
      ['late', 'late'],
    ]);
    expect(callMetaTool.mock.calls[1][2].sessionId).toBe('session-1');
  });

  it('lists lazy tools without enumerating upstream servers', async () => {
    type CapturedHandler = (request: { params: Record<string, unknown> }) => Promise<unknown>;
    const handlers: CapturedHandler[] = [];
    const inbound = createMockLegacyInboundConnection({
      server: { setRequestHandler: vi.fn((_schema, handler) => handlers.push(handler)) } as never,
    });
    const request = vi.fn(async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }) as never);
    const connections: OutboundConnections = new Map([
      [
        'slow',
        createMockOutboundConnection({
          name: 'slow',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          adapter: { request },
        }),
      ],
    ]);
    const orchestrator = {
      isEnabled: () => true,
      callMetaTool: vi.fn(),
      getCapabilitiesForVisibility: vi.fn().mockResolvedValue({
        tools: [{ name: 'tool_list', inputSchema: { type: 'object' } }],
      }),
    } as unknown as LazyLoadingOrchestrator;

    registerToolHandlers(connections, inbound, orchestrator);
    const result = (await handlers[0]({ params: {} })) as { tools: Array<{ name: string }> };

    expect(result.tools.map((tool) => tool.name)).toEqual(['tool_list']);
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps an embedded partial tool_list walk stable without upstream enumeration on continuation', async () => {
    type Handler = (request: { params: { name: string; arguments: unknown } }) => Promise<{
      structuredContent: { tools: Array<{ name: string }>; nextCursor?: string; _meta?: Record<string, unknown> };
    }>;
    const handlers: Handler[] = [];
    const inbound = createMockLegacyInboundConnection({
      server: { setRequestHandler: vi.fn((_schema, handler) => handlers.push(handler)) } as never,
    });
    const request = vi.fn(
      async () =>
        ({
          tools: ['one', 'two', 'timed_out'].map((name) => ({ name, inputSchema: { type: 'object' } })),
        }) as never,
    );
    const connections: OutboundConnections = new Map([
      [
        'ready',
        createMockOutboundConnection({
          name: 'ready',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          adapter: { request },
        }),
      ],
    ]);
    const originalAdmission = toolSchemaBoundary.admitToolSchemas;
    let fail = true;
    vi.spyOn(toolSchemaBoundary, 'admitToolSchemas').mockImplementation(async (tool, binding) => {
      if (fail && tool.name === 'timed_out') throw new SchemaBoundaryError('schema_evaluation_timeout', true);
      return originalAdmission(tool, binding);
    });
    const globalRegistry = vi.fn((): ToolRegistry => {
      throw new Error('Unexpected shared registry acquisition');
    });
    const provider = new MetaToolProvider(globalRegistry, new SchemaCache({ maxEntries: 10 }), connections);
    const orchestrator = {
      isEnabled: () => true,
      getCapabilitiesForVisibility: vi.fn().mockResolvedValue({ tools: provider.getMetaTools() }),
      callMetaTool: provider.callMetaTool.bind(provider),
    } as unknown as LazyLoadingOrchestrator;
    registerToolHandlers(connections, inbound, orchestrator);
    const first = (await handlers[1]({ params: { name: 'tool_list', arguments: { limit: 1 } } })).structuredContent;
    expect(first.nextCursor).toBeDefined();
    expect(first._meta?.[CAPABILITY_PAGINATION_META_KEY]).toMatchObject({
      partial: true,
      failureCategories: { upstream_tool_admission_timeout: 1 },
    });
    expect(request).toHaveBeenCalledOnce();
    fail = false;
    const restarted = (await handlers[1]({ params: { name: 'tool_list', arguments: {} } })).structuredContent;
    expect(restarted.tools.map((tool) => tool.name)).toContain('timed_out');
    expect(request).toHaveBeenCalledTimes(2);
    const admissions = vi
      .mocked(toolSchemaBoundary.admitToolSchemas)
      .mock.calls.filter(([tool]) => ['one', 'two', 'timed_out'].includes(String(tool.name))).length;
    const last = (
      await handlers[1]({
        params: { name: 'tool_list', arguments: { limit: 1, cursor: first.nextCursor } },
      })
    ).structuredContent;
    expect(last._meta).toEqual(first._meta);
    expect(last.tools.map((tool) => tool.name)).not.toContain('timed_out');
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(toolSchemaBoundary.admitToolSchemas)
        .mock.calls.filter(([tool]) => ['one', 'two', 'timed_out'].includes(String(tool.name))),
    ).toHaveLength(admissions);
    expect(globalRegistry).not.toHaveBeenCalled();
  });

  it('preserves captured upstream list failure status without listing the captured snapshot', async () => {
    type Handler = (request: { params: { name: string; arguments: unknown } }) => Promise<{
      structuredContent: { tools: unknown[]; _meta?: Record<string, unknown> };
    }>;
    const handlers: Handler[] = [];
    const inbound = createMockLegacyInboundConnection({
      server: { setRequestHandler: vi.fn((_schema, handler) => handlers.push(handler)) } as never,
    });
    const connections: OutboundConnections = new Map([
      [
        'failed',
        createMockOutboundConnection({
          name: 'failed',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          adapter: { request: vi.fn().mockRejectedValue(new Error('Upstream unavailable')) },
        }),
      ],
    ]);
    const provider = new MetaToolProvider(
      () => {
        throw new Error('Unexpected shared registry');
      },
      new SchemaCache({ maxEntries: 10 }),
      connections,
    );
    const orchestrator = {
      isEnabled: () => true,
      getCapabilitiesForVisibility: vi.fn().mockResolvedValue({ tools: provider.getMetaTools() }),
      callMetaTool: provider.callMetaTool.bind(provider),
    } as unknown as LazyLoadingOrchestrator;
    registerToolHandlers(connections, inbound, orchestrator);
    const result = (await handlers[1]({ params: { name: 'tool_list', arguments: {} } })).structuredContent;
    expect(result.tools).toEqual([]);
    expect(result._meta?.[CAPABILITY_PAGINATION_META_KEY]).toMatchObject({
      partial: true,
      failedSourceCount: 1,
      failureCategories: { upstream_list_failed: 1 },
    });
  });

  it('answers meta-tools from the snapshot the request captured', async () => {
    type CapturedHandler = (request: { params: { name: string; arguments: unknown } }) => Promise<unknown>;
    const handlers: CapturedHandler[] = [];
    const inbound = createMockLegacyInboundConnection({
      server: { setRequestHandler: vi.fn((_schema, handler) => handlers.push(handler)) } as never,
    });
    const connections: OutboundConnections = new Map([
      [
        'ready',
        createMockOutboundConnection({
          name: 'ready',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          adapter: {
            request: vi.fn(async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }) as never),
          },
        }),
      ],
    ]);
    const callMetaTool = vi.fn().mockResolvedValue({ tools: [] });
    const orchestrator = {
      isEnabled: () => true,
      callMetaTool,
      getCapabilitiesForVisibility: vi.fn().mockResolvedValue({
        tools: [{ name: 'tool_list', inputSchema: { type: 'object' } }],
      }),
    } as unknown as LazyLoadingOrchestrator;

    registerToolHandlers(connections, inbound, orchestrator);
    await handlers[1]({ params: { name: 'tool_list', arguments: {} } });

    const registry = callMetaTool.mock.calls[0][4] as ToolRegistry;
    expect(registry.getAllTools().map((tool) => `${tool.server}:${tool.name}`)).toEqual(['ready:echo']);
  });
});
