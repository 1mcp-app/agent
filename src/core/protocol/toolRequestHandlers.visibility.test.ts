import type { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import { createSessionScopedConnections } from '@src/core/server/connectionResolver.js';
import { ClientStatus, type InboundConnection, type OutboundConnections } from '@src/core/types/index.js';

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
  it('re-resolves the Server Candidate Set for each meta-tool request', async () => {
    type CapturedHandler = (request: { params: { name: string; arguments: unknown } }) => Promise<unknown>;
    const handlers: CapturedHandler[] = [];
    const inbound = {
      context: { sessionId: 'session-1' },
      tags: ['safe'],
      tagFilterMode: 'simple-or',
      server: {
        setRequestHandler: vi.fn((_schema, handler) => handlers.push(handler)),
      },
    } as unknown as InboundConnection;
    const connections = new Map([
      [
        'ready',
        {
          name: 'ready',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          transport: { tags: ['safe'] },
        },
      ],
      [
        'late',
        {
          name: 'late',
          status: ClientStatus.Restarting,
          capabilities: { tools: {} },
          transport: { tags: ['safe'] },
        },
      ],
      [
        'excluded',
        {
          name: 'excluded',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          transport: { tags: ['private'] },
        },
      ],
    ]) as OutboundConnections;
    const callMetaTool = vi.fn().mockResolvedValue({ tools: [] });
    const orchestrator = {
      isEnabled: () => true,
      isMetaTool: () => true,
      callMetaTool,
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

  it('keeps a captured session-scoped view live without exposing another session template', async () => {
    type CapturedHandler = (request: { params: { name: string; arguments: unknown } }) => Promise<unknown>;
    const handlers: CapturedHandler[] = [];
    const inbound = {
      context: { sessionId: 'owner-session' },
      tags: ['safe'],
      tagFilterMode: 'simple-or',
      server: {
        setRequestHandler: vi.fn((_schema, handler) => handlers.push(handler)),
      },
    } as unknown as InboundConnection;
    const outboundConnections = new Map([
      [
        'static',
        {
          name: 'static',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          transport: { tags: ['safe'] },
        },
      ],
      [
        'template:other-session',
        {
          name: 'template',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          transport: { tags: ['safe'] },
          templateIdentity: { mode: 'session', ownerSessionId: 'other-session', renderedHash: 'other-rendered' },
        },
      ],
    ]) as OutboundConnections;
    const scopedConnections = createSessionScopedConnections(outboundConnections, 'owner-session');
    const callMetaTool = vi.fn().mockResolvedValue({ tools: [] });
    const orchestrator = {
      isEnabled: () => true,
      isMetaTool: () => true,
      callMetaTool,
    } as unknown as LazyLoadingOrchestrator;

    registerToolHandlers(scopedConnections, inbound, orchestrator);
    const callHandler = handlers[1];

    await callHandler({ params: { name: 'tool_list', arguments: {} } });
    expect(Array.from(callMetaTool.mock.calls[0][2].serverCandidates.entries())).toEqual([['static', 'static']]);

    outboundConnections.set('template:owner-session', {
      name: 'template',
      status: ClientStatus.Connected,
      capabilities: { tools: {} },
      transport: { tags: ['safe'] },
      templateIdentity: { mode: 'session', ownerSessionId: 'owner-session', renderedHash: 'owner-rendered' },
    } as never);
    outboundConnections.set('late-static', {
      name: 'late-static',
      status: ClientStatus.Connected,
      capabilities: { tools: {} },
      transport: { tags: ['safe'] },
    } as never);

    await callHandler({ params: { name: 'tool_list', arguments: {} } });
    expect(Array.from(callMetaTool.mock.calls[1][2].serverCandidates.entries())).toEqual([
      ['static', 'static'],
      ['template:owner-session', 'template'],
      ['late-static', 'late-static'],
    ]);
  });
});
