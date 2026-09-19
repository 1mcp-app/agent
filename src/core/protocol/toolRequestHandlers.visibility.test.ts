import { createMockLegacyInboundConnection, createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import type { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/index.js';

import { describe, expect, it, vi } from 'vitest';

import { registerToolHandlers } from './toolRequestHandlers.js';

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return { getTemplateServerManager: () => undefined };
    },
  },
}));

describe('registerToolHandlers capability visibility', () => {
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
});
