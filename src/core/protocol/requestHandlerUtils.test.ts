import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import {
  bindCatalogCursorOwner,
  CapabilityCatalog,
  createCatalogCursorOwner,
  revokeCatalogCursorOwner,
} from '@src/core/capabilities/capabilityCatalog.js';
import { bindResourceRouteOwner, createResourceRouteOwner } from '@src/core/capabilities/capabilityVisibility.js';
import { SchemaCache } from '@src/core/capabilities/schemaCache.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { ClientStatus, type InboundConnection, type OutboundConnections } from '@src/core/types/index.js';

import { describe, expect, it, vi } from 'vitest';

import {
  createCapabilityCatalogFromConnections,
  resolveCapabilityVisibility,
  resolveLazyCapabilityVisibility,
} from './requestHandlerUtils.js';

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return { getTemplateServerManager: () => undefined };
    },
  },
}));

describe('createCapabilityCatalogFromConnections', () => {
  it('preserves healthy tools when another backend times out and recovers on the next construction', async () => {
    const recoveredTool = { name: 'recovered', inputSchema: { type: 'object' as const } };
    const healthyTool = { name: 'healthy', inputSchema: { type: 'object' as const } };
    const slowListTools = vi
      .fn()
      .mockRejectedValueOnce(new Error('Request timed out'))
      .mockResolvedValueOnce({ tools: [recoveredTool] });
    const healthyListTools = vi.fn().mockResolvedValue({ tools: [healthyTool] });
    const connections: OutboundConnections = new Map([
      [
        'slow',
        createMockOutboundConnection({
          name: 'slow',
          capabilities: { tools: {} },
          adapter: { request: slowListTools },
        }),
      ],
      [
        'healthy',
        createMockOutboundConnection({
          name: 'healthy',
          capabilities: { tools: {} },
          adapter: { request: healthyListTools },
        }),
      ],
    ]);

    const partialCatalog = await createCapabilityCatalogFromConnections(connections, () => ({}));
    const partial = await partialCatalog.listVisibleTools();
    expect(partial.tools.map((tool) => tool.name)).toEqual(['healthy']);

    const recoveredCatalog = await createCapabilityCatalogFromConnections(connections, () => ({}));
    const recovered = await recoveredCatalog.listVisibleTools();
    expect(recovered.tools.map((tool) => tool.name).sort()).toEqual(['healthy', 'recovered']);
    expect(slowListTools).toHaveBeenCalledTimes(2);
  });
});

describe('resolveLazyCapabilityVisibility', () => {
  it('projects cursor ownership only from the actual context and only into tool visibility', async () => {
    const owner = createCatalogCursorOwner();
    const context = { sessionId: 'actual-private-session' };
    bindCatalogCursorOwner(context, owner);
    const connections = new Map();
    const config = { context, tags: ['safe'], tagFilterMode: 'simple-or' as const };
    const tools = resolveCapabilityVisibility(connections, config, context.sessionId, 'tools');
    const resources = resolveCapabilityVisibility(connections, config, context.sessionId, 'resources');
    const copied = resolveCapabilityVisibility(
      connections,
      JSON.parse(JSON.stringify(config)),
      context.sessionId,
      'tools',
    );
    expect(tools.sessionId).toBe(context.sessionId);
    expect(tools.filterSelection?.tags).toEqual(['safe']);
    expect(JSON.stringify(tools)).not.toContain('owner');
    revokeCatalogCursorOwner(owner);
    const catalog = new CapabilityCatalog({
      getToolRegistry: ToolRegistry.empty,
      schemaCache: new SchemaCache({ maxEntries: 10 }),
      outboundConnections: connections,
      getServerConfigs: () => ({}),
    });
    await expect(catalog.listVisibleTools({}, tools)).rejects.toThrow('Capability cursor owner is unavailable');
    await expect(catalog.listVisibleTools({}, copied)).resolves.toMatchObject({ tools: [] });
    await expect(catalog.listVisibleTools({}, resources)).resolves.toMatchObject({ tools: [] });
  });

  it('carries only internally bound resource ownership through current capability and tag filtering', () => {
    const owner = createResourceRouteOwner();
    const context = { sessionId: 'private-bridge' };
    bindResourceRouteOwner(context, owner);
    const connections = new Map([
      [
        'visible',
        createMockOutboundConnection({ name: 'visible', capabilities: { resources: {}, tools: {} }, tags: ['safe'] }),
      ],
      ['hidden', createMockOutboundConnection({ name: 'hidden', capabilities: { resources: {} }, tags: ['private'] })],
      ['tools-only', createMockOutboundConnection({ name: 'tools-only', capabilities: { tools: {} }, tags: ['safe'] })],
    ]);
    const config = { context, tags: ['safe'], tagFilterMode: 'simple-or' as const, enablePagination: false };
    const visibility = resolveCapabilityVisibility(connections, config, context.sessionId, 'resources');
    expect(visibility.resourceOwner).toBe(owner);
    expect([...visibility.serverCandidates.keys()]).toEqual(['visible']);
    expect(visibility.filterSelection).not.toHaveProperty('enablePagination');
    expect(
      resolveCapabilityVisibility(connections, JSON.parse(JSON.stringify(config)), context.sessionId, 'resources')
        .resourceOwner,
    ).toBeUndefined();
    expect(resolveCapabilityVisibility(connections, config, context.sessionId, 'tools').resourceOwner).toBeUndefined();
  });
  it('derives a public server name when the connection name is empty', () => {
    const connections: OutboundConnections = new Map([
      [
        'unnamed:session-1',
        createMockOutboundConnection({
          name: '',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          tags: ['safe'],
        }),
      ],
    ]);
    const inbound = { tags: ['safe'], tagFilterMode: 'simple-or' } as InboundConnection;

    const visibility = resolveLazyCapabilityVisibility(connections, inbound, 'session-1');

    expect(Array.from(visibility.serverCandidates.entries())).toEqual([['unnamed:session-1', 'unnamed']]);
  });

  it('re-evaluates template scope, tags, connection state, and tool capability for each request', () => {
    const connections: OutboundConnections = new Map([
      [
        'visible',
        createMockOutboundConnection({
          name: 'visible',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          tags: ['safe'],
        }),
      ],
      [
        'hidden',
        createMockOutboundConnection({
          name: 'hidden',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          tags: ['private'],
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
        'not-a-tool',
        createMockOutboundConnection({
          name: 'not-a-tool',
          status: ClientStatus.Connected,
          capabilities: {},
          tags: ['safe'],
        }),
      ],
      [
        'template:other-session',
        createMockOutboundConnection({
          name: 'template',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          tags: ['safe'],
        }),
      ],
      [
        'template:session-1',
        createMockOutboundConnection({
          name: 'template',
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
          tags: ['safe'],
        }),
      ],
    ]);
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
