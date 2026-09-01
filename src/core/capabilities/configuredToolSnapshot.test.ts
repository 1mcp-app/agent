import type { Tool } from '@src/sdk/contracts/index.js';

import { ClientStatus, type OutboundConnection, type OutboundConnections } from '@src/core/types/index.js';

import { describe, expect, it, vi } from 'vitest';

import {
  clearCompleteConfiguredToolTargetSnapshot,
  clearLastConfiguredToolSnapshot,
  collectConfiguredToolPages,
  publishCompleteConfiguredToolInspection,
  publishCompleteConfiguredToolTargetSnapshots,
  publishConfiguredToolPage,
  publishConfiguredToolSnapshot,
  readCompleteConfiguredToolTargetSnapshot,
  readConfiguredToolSnapshot,
  readLastConfiguredToolSnapshot,
} from './configuredToolSnapshot.js';

function connection(name: string): OutboundConnection {
  return {
    name,
    status: ClientStatus.Connected,
    client: {},
    transport: {},
  } as unknown as OutboundConnection;
}

describe('configured tool snapshots', () => {
  it('evicts a durable target snapshot only when its definition is removed', () => {
    const outbound = connection('removed-target');
    publishConfiguredToolSnapshot(outbound, [{ name: 'old', inputSchema: { type: 'object' } }]);
    publishCompleteConfiguredToolTargetSnapshots(new Map([['removed-target', outbound]]));

    clearLastConfiguredToolSnapshot('removed-target');

    expect(readLastConfiguredToolSnapshot('removed-target')).toEqual([]);
  });

  it('clears only the requested source-qualified target snapshot', () => {
    const staticConnection = connection('shared-target');
    const templateConnection = connection('shared-target');
    publishCompleteConfiguredToolInspection({
      source: 'mcpServers',
      targetName: 'shared-target',
      instances: [{ instanceId: 'static', connections: [staticConnection], tools: [] }],
    });
    publishCompleteConfiguredToolInspection({
      source: 'mcpTemplates',
      targetName: 'shared-target',
      instances: [{ instanceId: 'template', connections: [templateConnection], tools: [] }],
    });

    clearCompleteConfiguredToolTargetSnapshot('mcpTemplates', 'shared-target');

    expect(readCompleteConfiguredToolTargetSnapshot('mcpTemplates', 'shared-target')).toBeUndefined();
    expect(readCompleteConfiguredToolTargetSnapshot('mcpServers', 'shared-target')).toMatchObject({
      instances: [{ instanceId: 'static' }],
    });
  });

  it('publishes only after an ordered protocol page sequence is complete', () => {
    const outbound = connection('paged-target');

    publishConfiguredToolPage(outbound, [{ name: 'first', inputSchema: { type: 'object' } }], undefined, 'page-2');
    expect(readConfiguredToolSnapshot(outbound)).toBeUndefined();
    publishConfiguredToolPage(outbound, [{ name: 'second', inputSchema: { type: 'object' } }], 'page-2', undefined);

    expect(readConfiguredToolSnapshot(outbound)?.map((tool) => tool.name)).toEqual(['first', 'second']);
  });

  it('rejects a cyclic protocol page sequence without retaining partial state', () => {
    const outbound = connection('cyclic-target');

    publishConfiguredToolPage(outbound, [{ name: 'first', inputSchema: { type: 'object' } }], undefined, 'page-2');
    publishConfiguredToolPage(outbound, [{ name: 'second', inputSchema: { type: 'object' } }], 'page-2', 'page-2');
    publishConfiguredToolPage(outbound, [{ name: 'third', inputSchema: { type: 'object' } }], 'page-2', undefined);

    expect(readConfiguredToolSnapshot(outbound)).toBeUndefined();
  });

  it('collects every upstream page for runtime discovery', async () => {
    const listPage = vi.fn(async (cursor: string | undefined) =>
      cursor === undefined
        ? { tools: [{ name: 'first', inputSchema: { type: 'object' as const } }], nextCursor: 'page-2' }
        : { tools: [{ name: 'second', inputSchema: { type: 'object' as const } }] },
    );

    const result = await collectConfiguredToolPages(listPage);

    expect(result.tools.map((tool) => tool.name)).toEqual(['first', 'second']);
    expect(listPage).toHaveBeenNthCalledWith(2, 'page-2');
  });

  it('rejects pagination that exceeds the bounded page limit', async () => {
    let page = 0;
    const listPage = vi.fn(async () => ({
      tools: [],
      nextCursor: `page-${++page}`,
    }));

    await expect(collectConfiguredToolPages(listPage)).rejects.toThrow('Tool pagination exceeded 1000 pages');
    expect(listPage).toHaveBeenCalledTimes(1_000);
  });

  it('promotes a complete per-instance union to the bounded target fallback', () => {
    const first = connection('snapshot-target');
    const second = connection('snapshot-target');
    const connections: OutboundConnections = new Map([
      ['snapshot-target:first', first],
      ['snapshot-target:second', second],
    ]);
    const firstTools: Tool[] = [{ name: 'search', inputSchema: { type: 'object' } }];
    const secondTools: Tool[] = [{ name: 'read', inputSchema: { type: 'object' } }];

    publishConfiguredToolSnapshot(first, firstTools);
    publishConfiguredToolSnapshot(second, secondTools);
    publishCompleteConfiguredToolTargetSnapshots(connections);

    connections.clear();
    expect(
      readLastConfiguredToolSnapshot('snapshot-target')
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(['read', 'search']);
  });

  it('does not replace the last complete target fallback with a partial observation', () => {
    const complete = connection('partial-snapshot-target');
    publishConfiguredToolSnapshot(complete, [{ name: 'known', inputSchema: { type: 'object' } }]);
    publishCompleteConfiguredToolTargetSnapshots(new Map([['complete', complete]]));

    const observed = connection('partial-snapshot-target');
    const unknown = connection('partial-snapshot-target');
    publishConfiguredToolSnapshot(observed, [{ name: 'partial', inputSchema: { type: 'object' } }]);
    publishCompleteConfiguredToolTargetSnapshots(
      new Map([
        ['observed', observed],
        ['unknown', unknown],
      ]),
    );

    expect(readLastConfiguredToolSnapshot('partial-snapshot-target').map((tool) => tool.name)).toEqual(['known']);
  });
});
