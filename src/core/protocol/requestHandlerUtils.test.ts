import { ClientStatus, type InboundConnection, type OutboundConnections } from '@src/core/types/index.js';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return { getTemplateServerManager: () => undefined };
    },
  },
}));

import { resolveLazyAllowedServers } from './requestHandlerUtils.js';

describe('resolveLazyAllowedServers', () => {
  it('re-evaluates template scope, tags, connection state, and tool capability for each request', () => {
    const connections = new Map([
      ['visible', { name: 'visible', status: ClientStatus.Connected, capabilities: { tools: {} }, transport: { tags: ['safe'] } }],
      ['hidden', { name: 'hidden', status: ClientStatus.Connected, capabilities: { tools: {} }, transport: { tags: ['private'] } }],
      ['late', { name: 'late', status: ClientStatus.Restarting, capabilities: { tools: {} }, transport: { tags: ['safe'] } }],
      ['not-a-tool', { name: 'not-a-tool', status: ClientStatus.Connected, capabilities: {}, transport: { tags: ['safe'] } }],
      ['template:other-session', { name: 'template', status: ClientStatus.Connected, capabilities: { tools: {} }, transport: { tags: ['safe'] } }],
      ['template:session-1', { name: 'template', status: ClientStatus.Connected, capabilities: { tools: {} }, transport: { tags: ['safe'] } }],
    ]) as OutboundConnections;
    const inbound = { tags: ['safe'], tagFilterMode: 'simple-or' } as InboundConnection;

    expect(Array.from(resolveLazyAllowedServers(connections, inbound, 'session-1')).sort()).toEqual([
      'template',
      'visible',
    ]);

    connections.get('late')!.status = ClientStatus.Connected;

    expect(Array.from(resolveLazyAllowedServers(connections, inbound, 'session-1')).sort()).toEqual([
      'late',
      'template',
      'visible',
    ]);
  });
});
