import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import type { OutboundConnections } from '@src/core/types/index.js';

import { createCapabilityVisibility } from './capabilityVisibility.js';
import { acquireRuntimeCapabilityCatalog } from './runtimeCapabilityCatalog.js';

const tool = (name: string) => ({ name, inputSchema: { type: 'object' } });
function fixture(
  name = 'server',
  list: (method: string, params: unknown) => unknown = () => ({ tools: [tool('echo')] }),
) {
  return createMockOutboundConnection({
    name,
    capabilities: { tools: {} },
    adapter: {
      request: vi.fn(async ({ method, params }) => list(method, params) as never),
    },
  });
}

describe('runtime capability catalog', () => {
  it('resolves before listing and keeps separator-bearing source names exact', async () => {
    const connection = fixture('a_1mcp_b', () => ({ tools: [tool('c_1mcp_d')] }));
    const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['backend', connection]]));
    const route = snapshot.resolve('tools', 'a_1mcp_b_1mcp_c_1mcp_d');
    expect(route?.entry.route.upstreamIdentity).toBe('c_1mcp_d');
    expect(route?.connection).toBe(connection);
    expect(snapshot.resolve('tools', 'a_1mcp_b_1mcp_missing')).toBeUndefined();
  });

  it('quarantines duplicate routes and malformed siblings without hiding a valid sibling', async () => {
    const connection = fixture('server', () => ({ tools: [tool('same'), tool('same'), { name: 4 }, tool('good')] }));
    const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['server', connection]]));
    expect(snapshot.resolve('tools', 'server_1mcp_same')).toBeUndefined();
    expect(snapshot.resolve('tools', 'server_1mcp_good')).toBeDefined();
    expect(
      (await snapshot.list<{ name: string }>('tools', { enablePagination: false })).items.map((item) => item.name),
    ).toEqual(['server_1mcp_good']);
  });

  it('scopes identical logical server instances before resolving', async () => {
    const first = fixture('template');
    const second = fixture('template');
    const connections = new Map([
      ['template:first', first],
      ['template:second', second],
    ]);
    const snapshot = await acquireRuntimeCapabilityCatalog(
      connections,
      createCapabilityVisibility([['template:second', 'template']], 'session'),
    );
    expect(snapshot.resolve('tools', 'template_1mcp_echo')?.connection).toBe(second);
    expect(first.adapter.request).not.toHaveBeenCalled();
  });

  it('retains captured backend ownership when a connection is replaced during collection', async () => {
    let finish!: (value: unknown) => void;
    const first = fixture(
      'server',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const connections: OutboundConnections = new Map([['server', first]]);
    const pending = acquireRuntimeCapabilityCatalog(connections);
    connections.set(
      'server',
      fixture('server', () => ({ tools: [tool('replacement')] })),
    );
    finish({ tools: [tool('original')] });
    await expect(pending).rejects.toThrow('backend changed');
    expect(
      (await acquireRuntimeCapabilityCatalog(connections)).resolve('tools', 'server_1mcp_replacement'),
    ).toBeDefined();
  });

  it('retains a previous complete generation on failed refresh without redirecting it to replacement backends', async () => {
    let fail = false;
    const connection = fixture('server', () => {
      if (fail) throw new Error('unavailable');
      return { tools: [tool('echo')] };
    });
    const connections = new Map([['server', connection]]);
    const first = await acquireRuntimeCapabilityCatalog(connections);
    fail = true;
    expect(await acquireRuntimeCapabilityCatalog(connections)).toBe(first);
    connections.set(
      'server',
      fixture('server', () => {
        throw new Error('replacement unavailable');
      }),
    );
    expect((await acquireRuntimeCapabilityCatalog(connections)).resolve('tools', 'server_1mcp_echo')).toBeUndefined();
  });

  it('keeps provider pagination and captured projections consistent across requests', async () => {
    const connection = fixture('server', (_method, params) =>
      (params as { cursor?: string })?.cursor === 'page2'
        ? { tools: [tool('second')] }
        : { tools: [tool('first')], nextCursor: 'page2' },
    );
    const connections = new Map([['server', connection]]);
    const first = await acquireRuntimeCapabilityCatalog(connections);
    const page = await first.list<{ name: string }>('tools', { enablePagination: true });
    expect(page.items.map((item) => item.name)).toEqual(['server_1mcp_first']);
    const next = await acquireRuntimeCapabilityCatalog(connections);
    const page2 = await next.list<{ name: string }>('tools', { enablePagination: true, cursor: page.nextCursor });
    expect(page2.items.map((item) => item.name)).toEqual(['server_1mcp_second']);
    expect(page2.nextCursor).toBeUndefined();
  });

  it('captures all four kinds and owns internal unprefixed meta-tool identities explicitly', async () => {
    const connection = fixture('server', (method) =>
      method === 'resources/templates/list'
        ? { resourceTemplates: [{ name: 'r', uriTemplate: 'file:///{id}' }] }
        : method === 'resources/list'
          ? { resources: [{ name: 'r', uri: 'file:///one' }] }
          : method === 'prompts/list'
            ? { prompts: [{ name: 'p' }] }
            : { tools: [tool('echo')] },
    );
    connection.capabilities = { tools: {}, prompts: {}, resources: {} };
    const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['server', connection]]), undefined, {
      unprefixedTools: [{ name: 'tool_list', inputSchema: { type: 'object' } }],
    });
    expect(snapshot.generation.entries).toHaveLength(5);
    expect(snapshot.resolve('tools', 'tool_list')?.entry.route.origin).toBe('internal');
    expect(snapshot.resolve('resourceTemplates', 'server_1mcp_file:///{id}')).toBeDefined();
  });

  it('does not publish an older concurrent refresh over a newer completed observation', async () => {
    let finish!: (value: unknown) => void;
    let call = 0;
    const connection = fixture('server', () => {
      call += 1;
      if (call === 1)
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (call === 2) return { tools: [tool('new')] };
      throw new Error('unavailable');
    });
    const connections = new Map([['server', connection]]);
    const first = acquireRuntimeCapabilityCatalog(connections);
    const latest = await acquireRuntimeCapabilityCatalog(connections);
    finish({ tools: [tool('old')] });
    await first;
    expect(await acquireRuntimeCapabilityCatalog(connections)).toBe(latest);
  });

  it('retains request configuration and prevents mutation of the captured connection index', async () => {
    const connection = fixture();
    const options = {
      serverConfigs: { server: { command: 'node', type: 'stdio' as const, disabledTools: [] as string[] } },
    };
    const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['server', connection]]), undefined, options);
    options.serverConfigs.server.disabledTools.push('echo');
    expect(snapshot.resolve('tools', 'server_1mcp_echo')).toBeDefined();
    expect('set' in snapshot.connections).toBe(false);
  });

  it('keeps interleaved users pagination generations independent with unchanged providers', async () => {
    const a = fixture('a');
    const b = fixture('b');
    const connections = new Map([
      ['a', a],
      ['b', b],
    ]);
    const firstVisibility = createCapabilityVisibility(
      [
        ['a', 'a'],
        ['b', 'b'],
      ],
      'first-user',
    );
    const secondVisibility = createCapabilityVisibility([['a', 'a']], 'second-user');
    const first = await acquireRuntimeCapabilityCatalog(connections, firstVisibility);
    const page = await first.list<{ name: string }>('tools', { enablePagination: true });
    expect(page.nextCursor).toBeDefined();
    const second = await acquireRuntimeCapabilityCatalog(connections, secondVisibility);
    await second.list('tools', { enablePagination: true });
    const resumed = await acquireRuntimeCapabilityCatalog(connections, firstVisibility, {
      continuation: { kind: 'tools', cursor: page.nextCursor!, enablePagination: true },
    });
    const last = await resumed.list<{ name: string }>('tools', { cursor: page.nextCursor, enablePagination: true });
    expect(last.items.map((item) => item.name)).toEqual(['b_1mcp_echo']);
    expect(last.nextCursor).toBeUndefined();
  });

  it('rejects adapter replacement on the same mutable connection during collection and after publication', async () => {
    let finish!: (value: unknown) => void;
    const connection = fixture(
      'server',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const connections = new Map([['server', connection]]);
    const pending = acquireRuntimeCapabilityCatalog(connections);
    const replacement = fixture().adapter;
    Object.assign(connection, { adapter: replacement });
    finish({ tools: [tool('old')] });
    await expect(pending).rejects.toThrow('backend changed');
    const snapshot = await acquireRuntimeCapabilityCatalog(connections);
    expect(snapshot.isCurrent()).toBe(true);
    Object.assign(connection, { adapter: fixture().adapter });
    expect(snapshot.isCurrent()).toBe(false);
    expect(() => snapshot.resolve('tools', 'server_1mcp_echo')).toThrow('backend changed');
  });
});
