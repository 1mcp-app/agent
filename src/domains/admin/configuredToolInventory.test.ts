import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { publishConfiguredToolSnapshot } from '@src/core/capabilities/configuredToolSnapshot.js';
import { ClientStatus, type OutboundConnection, type OutboundConnections } from '@src/core/types/index.js';

import { describe, expect, it, vi } from 'vitest';

import { createConfiguredToolInventory } from './configuredToolInventory.js';

function connection(name: string, tools: Tool[]): OutboundConnection {
  const outbound = createMockOutboundConnection({
    name,
    status: ClientStatus.Connected,
    adapter: { request: vi.fn(async () => ({ tools }) as never) },
  });
  publishConfiguredToolSnapshot(outbound, tools);
  return outbound;
}

describe('Configured Tool Inventory', () => {
  it('combines observed tools with retained unresolved configuration', async () => {
    const connections: OutboundConnections = new Map([
      [
        'filesystem',
        connection('filesystem', [
          { name: 'read_file', description: 'Read upstream', inputSchema: { type: 'object' } },
          { name: 'write_file', description: 'Write upstream', inputSchema: { type: 'object' } },
        ]),
      ],
    ]);

    const inventory = await createConfiguredToolInventory({
      targetName: 'filesystem',
      source: 'mcpServers',
      config: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['write_file', 'missing_tool'],
        toolDescriptionOverrides: {
          read_file: 'Read safely',
          removed_tool: 'Removed description',
        },
      },
      connections,
      model: 'gpt-4o',
    });

    expect(inventory.freshness).toBe('live');
    expect(inventory.rows).toMatchObject([
      {
        name: 'missing_tool',
        enabled: false,
        observed: false,
        unresolved: true,
      },
      {
        name: 'read_file',
        enabled: true,
        observed: true,
        upstreamDescription: 'Read upstream',
        effectiveDescription: 'Read safely',
        descriptionOverridden: true,
      },
      {
        name: 'removed_tool',
        enabled: true,
        observed: false,
        unresolved: true,
        effectiveDescription: 'Removed description',
        descriptionOverridden: true,
      },
      {
        name: 'write_file',
        enabled: false,
        observed: true,
      },
    ]);
    expect(inventory.rows.find((row) => row.name === 'read_file')?.approximateTokens).toBeGreaterThan(0);
    expect(connections.get('filesystem')?.adapter.request).not.toHaveBeenCalled();

    connections.clear();
    const disabledInventory = await createConfiguredToolInventory({
      targetName: 'filesystem',
      source: 'mcpServers',
      config: { type: 'stdio', command: 'node' },
      connections,
    });
    expect(disabledInventory.freshness).toBe('unavailable');
    expect(disabledInventory.rows.map((row) => row.name)).toEqual(['read_file', 'write_file']);
    expect(disabledInventory.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'read_file', observed: false, stale: true, unresolved: false }),
      ]),
    );
    expect(disabledInventory.counts.observed).toBe(0);
  });

  it('coalesces qualified disabled names into their observed logical row', async () => {
    const connections: OutboundConnections = new Map([
      [
        'filesystem',
        connection('filesystem', [{ name: 'write_file', description: 'Write', inputSchema: { type: 'object' } }]),
      ],
    ]);

    const inventory = await createConfiguredToolInventory({
      targetName: 'filesystem',
      source: 'mcpServers',
      config: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['filesystem_1mcp_write_file'],
      },
      connections,
    });

    expect(inventory.rows).toMatchObject([{ name: 'write_file', enabled: false, observed: true, unresolved: false }]);
  });

  it('unions Template Server tools and reports partial occurrence', async () => {
    const connections: OutboundConnections = new Map([
      [
        'project:one',
        connection('project', [
          { name: 'common', description: 'Common', inputSchema: { type: 'object' } },
          { name: 'only_one', description: 'One', inputSchema: { type: 'object' } },
        ]),
      ],
      [
        'project:two',
        connection('project', [{ name: 'common', description: 'Common', inputSchema: { type: 'object' } }]),
      ],
    ]);

    const inventory = await createConfiguredToolInventory({
      targetName: 'project',
      source: 'mcpTemplates',
      config: { type: 'stdio', command: 'node' },
      connections,
      model: 'gpt-4o',
    });

    expect(inventory.activeInstanceCount).toBe(2);
    expect(inventory.rows).toMatchObject([
      { name: 'common', observedInstanceCount: 2, activeInstanceCount: 2, observedInSomeInstances: false },
      { name: 'only_one', observedInstanceCount: 1, activeInstanceCount: 2, observedInSomeInstances: true },
    ]);
  });

  it('uses the configured-server disabled semantics for rendered string values', async () => {
    const inventory = await createConfiguredToolInventory({
      targetName: 'project',
      source: 'mcpTemplates',
      config: { type: 'stdio', command: 'node', disabled: 'yes' },
      connections: new Map(),
    });

    expect(inventory.targetEnabled).toBe(false);
  });

  it('changes generation for schema changes and snapshot availability', async () => {
    const outbound = connection('generation-target', [
      { name: 'read', description: 'Read', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    ]);
    const connections: OutboundConnections = new Map([['generation-target:first', outbound]]);
    const first = await createConfiguredToolInventory({
      targetName: 'generation-target',
      source: 'mcpTemplates',
      config: { type: 'stdio', command: 'node' },
      connections,
    });
    publishConfiguredToolSnapshot(outbound, [
      { name: 'read', description: 'Read', inputSchema: { type: 'object', properties: { path: { type: 'number' } } } },
    ]);
    const schemaChanged = await createConfiguredToolInventory({
      targetName: 'generation-target',
      source: 'mcpTemplates',
      config: { type: 'stdio', command: 'node' },
      connections,
    });
    connections.set('second', connection('generation-target', []));
    const availabilityChanged = await createConfiguredToolInventory({
      targetName: 'generation-target',
      source: 'mcpTemplates',
      config: { type: 'stdio', command: 'node' },
      connections,
    });

    expect(schemaChanged.generation).not.toBe(first.generation);
    expect(availabilityChanged.generation).not.toBe(schemaChanged.generation);
  });

  it('changes generation when tools move between logical instances without changing the union', async () => {
    const firstConnection = connection('redistributed', [{ name: 'first', inputSchema: { type: 'object' } }]);
    const secondConnection = connection('redistributed', [{ name: 'second', inputSchema: { type: 'object' } }]);
    const connections: OutboundConnections = new Map([
      ['redistributed:first', firstConnection],
      ['redistributed:second', secondConnection],
    ]);
    const first = await createConfiguredToolInventory({
      targetName: 'redistributed',
      source: 'mcpTemplates',
      config: { type: 'stdio', command: 'node' },
      connections,
    });

    publishConfiguredToolSnapshot(firstConnection, [
      { name: 'first', inputSchema: { type: 'object' } },
      { name: 'second', inputSchema: { type: 'object' } },
    ]);
    publishConfiguredToolSnapshot(secondConnection, []);
    const redistributed = await createConfiguredToolInventory({
      targetName: 'redistributed',
      source: 'mcpTemplates',
      config: { type: 'stdio', command: 'node' },
      connections,
    });

    expect(redistributed.rows.map((row) => row.name)).toEqual(first.rows.map((row) => row.name));
    expect(redistributed.generation).not.toBe(first.generation);
  });

  it('does not claim partial template occurrence when an active instance snapshot is unknown', async () => {
    const observed = connection('partial-project', [
      { name: 'search', description: 'Search', inputSchema: { type: 'object' } },
    ]);
    const listTools = vi.fn();
    const unknown = createMockOutboundConnection({
      name: 'partial-project',
      status: ClientStatus.Connected,
      adapter: { request: listTools },
    });
    const inventory = await createConfiguredToolInventory({
      targetName: 'partial-project',
      source: 'mcpTemplates',
      config: { type: 'stdio', command: 'node' },
      connections: new Map([
        ['partial-project:observed', observed],
        ['partial-project:unknown', unknown],
      ]),
    });

    expect(inventory.freshness).toBe('unavailable');
    expect(inventory.rows[0]).toMatchObject({ observedInstanceCount: 1, activeInstanceCount: 2 });
    expect(inventory.rows[0]?.observedInSomeInstances).toBe(false);
    expect(listTools).not.toHaveBeenCalled();
  });
});
