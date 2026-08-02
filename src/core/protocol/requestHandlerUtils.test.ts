import { ClientStatus, type InboundConnection, type OutboundConnections } from '@src/core/types/index.js';

import { describe, expect, it, vi } from 'vitest';

import { resolveLazyCapabilityVisibility } from './requestHandlerUtils.js';

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return { getTemplateServerManager: () => undefined };
    },
  },
}));

describe('resolveLazyCapabilityVisibility', () => {
  it('derives a public server name when the connection name is empty', () => {
    const connections = new Map([
      [
        'unnamed:session-1',
        { name: '', status: ClientStatus.Connected, capabilities: { tools: {} }, transport: { tags: ['safe'] } },
      ],
    ]) as OutboundConnections;
    const inbound = { tags: ['safe'], tagFilterMode: 'simple-or' } as InboundConnection;

    const visibility = resolveLazyCapabilityVisibility(connections, inbound, 'session-1');

    expect(Array.from(visibility.serverCandidates.entries())).toEqual([['unnamed:session-1', 'unnamed']]);
  });

  it('re-evaluates template scope, tags, connection state, and tool capability for each request', () => {
    const connections = new Map([
      [
        'visible',
        { name: 'visible', status: ClientStatus.Connected, capabilities: { tools: {} }, transport: { tags: ['safe'] } },
      ],
      [
        'hidden',
        {
          name: 'hidden',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          transport: { tags: ['private'] },
        },
      ],
      [
        'late',
        { name: 'late', status: ClientStatus.Restarting, capabilities: { tools: {} }, transport: { tags: ['safe'] } },
      ],
      [
        'not-a-tool',
        { name: 'not-a-tool', status: ClientStatus.Connected, capabilities: {}, transport: { tags: ['safe'] } },
      ],
      [
        'template:other-session',
        {
          name: 'template',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          transport: { tags: ['safe'] },
        },
      ],
      [
        'template:session-1',
        {
          name: 'template',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          transport: { tags: ['safe'] },
        },
      ],
    ]) as OutboundConnections;
    const inbound = { tags: ['safe'], tagFilterMode: 'simple-or' } as InboundConnection;

    const initialVisibility = resolveLazyCapabilityVisibility(connections, inbound, 'session-1');
    expect(Array.from(initialVisibility.serverCandidates.entries()).sort()).toEqual([
      ['template:session-1', 'template'],
      ['visible', 'visible'],
    ]);
    expect(initialVisibility.sessionId).toBe('session-1');

    connections.get('late')!.status = ClientStatus.Connected;

    expect(
      Array.from(resolveLazyCapabilityVisibility(connections, inbound, 'session-1').serverCandidates.entries()).sort(),
    ).toEqual([
      ['late', 'late'],
      ['template:session-1', 'template'],
      ['visible', 'visible'],
    ]);

    connections.get('late')!.status = ClientStatus.Disconnected;
    connections.delete('visible');

    expect(
      Array.from(resolveLazyCapabilityVisibility(connections, inbound, 'session-1').serverCandidates.entries()),
    ).toEqual([['template:session-1', 'template']]);
  });
});
