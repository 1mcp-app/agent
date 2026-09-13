import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { CapabilityCatalog } from '@src/core/capabilities/capabilityCatalog.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { SchemaCache } from '@src/core/capabilities/schemaCache.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';

import { schemaBoundary } from './schemaBoundary.js';

describe('catalog schema admission and invocation journeys', () => {
  const valid = {
    name: 'good',
    inputSchema: { type: 'object', required: ['x'], properties: { x: { type: 'number' } } },
    outputSchema: { type: 'number' },
  };
  function fixture(tools: unknown[]) {
    let current = tools;
    const connection = createMockOutboundConnection({
      name: 'server',
      capabilities: { tools: {} },
      adapter: { request: vi.fn(async () => ({ tools: current }) as never) },
    });
    return {
      connections: new Map([['server', connection]]),
      change: (next: unknown[]) => {
        current = next;
      },
    };
  }
  it('quarantines one invalid sibling and validates before side effects and before success', async () => {
    const f = fixture([valid, { name: 'bad', inputSchema: { type: 'object', $ref: '#/missing' } }]);
    const snapshot = await acquireRuntimeCapabilityCatalog(f.connections);
    expect(snapshot.generation.entries.map((entry) => entry.route.upstreamIdentity)).toEqual(['good']);
    expect(snapshot.resolve('tools', 'server_1mcp_bad')).toBeUndefined();
    const sideEffect = vi.fn();
    await expect(snapshot.prepareToolCall('server_1mcp_good', { x: 'wrong' }).then(sideEffect)).rejects.toThrow(
      'schema_input_invalid',
    );
    expect(sideEffect).not.toHaveBeenCalled();
    const finish = await snapshot.prepareToolCall('server_1mcp_good', { x: 3 });
    await expect(finish({ content: [], structuredContent: 'wrong' })).rejects.toThrow('schema_output_invalid');
    await expect(finish({ content: [] })).rejects.toThrow('schema_output_invalid');
    await expect(finish({ content: [], structuredContent: 3 })).resolves.toBeUndefined();
    await expect(finish({ isError: true, content: [] })).resolves.toBeUndefined();
  });
  it('pins admitted output while preventing new calls using a changed generation', async () => {
    const f = fixture([valid]);
    const first = await acquireRuntimeCapabilityCatalog(f.connections);
    const finish = await first.prepareToolCall('server_1mcp_good', { x: 3 });
    f.change([{ ...valid, outputSchema: { type: 'string' } }]);
    await acquireRuntimeCapabilityCatalog(f.connections);
    await expect(first.prepareToolCall('server_1mcp_good', { x: 3 })).rejects.toThrow('schema_invalid');
    await expect(finish({ content: [], structuredContent: 3 })).resolves.toBeUndefined();
    await expect(finish({ content: [], structuredContent: 'new' })).rejects.toThrow('schema_output_invalid');
  });
  it('does not publish infrastructure-incomplete admission or authorize stale source afterward', async () => {
    const f = fixture([valid]);
    const first = await acquireRuntimeCapabilityCatalog(f.connections);
    f.change([{ ...valid, inputSchema: { type: 'object', required: ['new'] } }]);
    const mock = vi
      .spyOn(schemaBoundary, 'admit')
      .mockRejectedValueOnce(Object.assign(new Error('schema_evaluation_unavailable'), { retryable: true }));
    await expect(acquireRuntimeCapabilityCatalog(f.connections)).rejects.toThrow('schema_evaluation_unavailable');
    mock.mockRestore();
    await expect(first.prepareToolCall('server_1mcp_good', { x: 3 })).rejects.toThrow('schema_invalid');
    const recovered = await acquireRuntimeCapabilityCatalog(f.connections);
    await expect(recovered.prepareToolCall('server_1mcp_good', { new: true })).resolves.toBeTypeOf('function');
  });
  it.each(['2024-11-05', '2025-11-25', '2026-07-28'])(
    'preserves implicit %s source dialect in projected schema',
    async (revision) => {
      const f = fixture([valid]);
      Object.defineProperty(f.connections.get('server')!.adapter, 'protocolRevision', { value: revision });
      const snapshot = await acquireRuntimeCapabilityCatalog(f.connections);
      const list = await snapshot.list<{ inputSchema: { $schema: string } }>('tools', { enablePagination: false });
      expect(list.items[0].inputSchema.$schema).toBe(
        revision < '2025-11-25'
          ? 'http://json-schema.org/draft-07/schema#'
          : 'https://json-schema.org/draft/2020-12/schema',
      );
    },
  );
});

describe('lazy schema invocation fences', () => {
  function setup() {
    const definition = { name: 'tool', inputSchema: { type: 'object' as const } };
    const connection = createMockOutboundConnection({ name: 'server' });
    const registry = ToolRegistry.fromToolsWithServer([
      { server: 'server', connectionKey: 'server', tool: definition },
    ]).withConnections(new Map([['server', connection]]));
    const catalog = new CapabilityCatalog({
      getToolRegistry: () => registry,
      schemaCache: new SchemaCache({ maxEntries: 10 }),
      outboundConnections: new Map([['server', connection]]),
      getServerConfigs: () => ({}),
    });
    return { catalog, connection };
  }
  it('does not dispatch a replaced adapter after input validation', async () => {
    const { catalog, connection } = setup();
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = connection.adapter;
    const spy = vi.spyOn(schemaBoundary, 'evaluate').mockImplementationOnce(async () => {
      entered();
      await gate;
      return { valid: true };
    });
    const pending = catalog.invokeVisibleTool({ server: 'server', toolName: 'tool', args: {} });
    await ready;
    const replacement = createMockOutboundConnection().adapter;
    Object.defineProperty(connection, 'adapter', { value: replacement });
    release();
    expect(await pending).toMatchObject({ error: { type: 'upstream', message: 'schema_invalid' } });
    expect(original.request).not.toHaveBeenCalled();
    expect(replacement.request).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('preserves source-era dialect for lazy list and describe, and forwards cancellation', async () => {
    const { catalog, connection } = setup();
    Object.defineProperty(connection.adapter, 'protocolRevision', { value: '2024-11-05' });
    const described = await catalog.describeVisibleTool({ server: 'server', toolName: 'tool' });
    expect(described.schema).toMatchObject({ inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#' } });
    const listed = await catalog.listVisibleTools();
    expect(listed.tools[0].inputSchema).toMatchObject({ $schema: 'http://json-schema.org/draft-07/schema#' });
    const controller = new AbortController();
    controller.abort();
    expect(
      await catalog.invokeVisibleTool({ server: 'server', toolName: 'tool', args: {} }, undefined, {
        signal: controller.signal,
      }),
    ).toMatchObject({ error: { message: 'schema_evaluation_unavailable' } });
    expect(connection.adapter.request).not.toHaveBeenCalled();
  });
});
