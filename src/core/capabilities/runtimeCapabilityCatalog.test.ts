import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import type { OutboundConnections } from '@src/core/types/index.js';

import { createCapabilityVisibility } from './capabilityVisibility.js';
import { acquireRuntimeCapabilityCatalog, evictRuntimeCapabilityCatalogSession } from './runtimeCapabilityCatalog.js';

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
  it('does not reuse the unscoped template registry for a failed request-scoped refresh', async () => {
    const first = fixture('template');
    const second = fixture('template');
    const connections = new Map([
      ['first', first],
      ['second', second],
    ]);
    const registry = await acquireRuntimeCapabilityCatalog(connections);
    expect(registry.generation.entries).toHaveLength(2);
    vi.mocked(first.adapter.request).mockRejectedValue(new Error('unavailable'));
    vi.mocked(second.adapter.request).mockRejectedValue(new Error('unavailable'));
    const request = await acquireRuntimeCapabilityCatalog(
      connections,
      createCapabilityVisibility([
        ['first', 'template'],
        ['second', 'template'],
      ]),
    );
    expect(request).not.toBe(registry);
    expect(request.generation.entries).toEqual([]);
  });

  it('evicts every session scope and prevents in-flight work from republishing after teardown', async () => {
    const connection = fixture();
    const connections = new Map([['server', connection]]);
    const visibility = createCapabilityVisibility([['server', 'server']], 'closed');
    const first = await acquireRuntimeCapabilityCatalog(connections, visibility);
    const extra = await acquireRuntimeCapabilityCatalog(connections, visibility, { internalResources: [] });
    const other = await acquireRuntimeCapabilityCatalog(
      connections,
      createCapabilityVisibility([['server', 'server']], 'other'),
    );
    let finish!: (value: unknown) => void;
    vi.mocked(connection.adapter.request).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
    const pending = acquireRuntimeCapabilityCatalog(connections, visibility);
    evictRuntimeCapabilityCatalogSession(connections, 'closed');
    const reopened = await acquireRuntimeCapabilityCatalog(connections, visibility);
    finish({ tools: [tool('obsolete')] });
    await expect(pending).rejects.toThrow();
    expect(first.isCurrent()).toBe(false);
    expect(extra.isCurrent()).toBe(false);
    expect(other.isCurrent()).toBe(true);
    await expect(first.list('tools', { enablePagination: true, cursor: 'disposed' })).rejects.toMatchObject({
      data: { reason: 'stale_generation' },
    });
    vi.mocked(connection.adapter.request).mockRejectedValue(new Error('unavailable'));
    expect(
      (await acquireRuntimeCapabilityCatalog(connections, visibility)).resolve('tools', 'server_1mcp_echo'),
    ).toBeUndefined();
    expect(reopened.isCurrent()).toBe(true);
  });

  it('quarantines public routes shared by two simultaneously visible instances', async () => {
    const connections = new Map([
      ['first', fixture('template')],
      ['second', fixture('template')],
    ]);
    const snapshot = await acquireRuntimeCapabilityCatalog(
      connections,
      createCapabilityVisibility(
        [
          ['first', 'template'],
          ['second', 'template'],
        ],
        'session',
      ),
    );
    expect((await snapshot.list('tools', { enablePagination: false })).items).toEqual([]);
    expect(snapshot.generation.quarantine).toHaveLength(2);
    const scoped = await acquireRuntimeCapabilityCatalog(
      connections,
      createCapabilityVisibility([['second', 'template']], 'session'),
    );
    expect(scoped.resolve('tools', 'template_1mcp_echo')?.connection).toBe(connections.get('second'));
  });

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

  it('never serves a previous successful generation as a failed refresh result', async () => {
    let fail = false;
    const connection = fixture('server', () => {
      if (fail) throw new Error('unavailable');
      return { tools: [tool('echo')] };
    });
    const connections = new Map([['server', connection]]);
    await acquireRuntimeCapabilityCatalog(connections);
    fail = true;
    expect((await acquireRuntimeCapabilityCatalog(connections)).resolve('tools', 'server_1mcp_echo')).toBeUndefined();
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
    const connection = fixture('server', (method) => {
      switch (method) {
        case 'resources/templates/list':
          return { resourceTemplates: [{ name: 'r', uriTemplate: 'file:///{id}' }] };
        case 'resources/list':
          return { resources: [{ name: 'r', uri: 'file:///one' }] };
        case 'prompts/list':
          return { prompts: [{ name: 'p' }] };
        default:
          return { tools: [tool('echo')] };
      }
    });
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
    expect((await acquireRuntimeCapabilityCatalog(connections)).resolve('tools', 'server_1mcp_old')).toBeUndefined();
    expect(latest.resolve('tools', 'server_1mcp_new')).toBeDefined();
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
  it('reclaims expired scope capacity without retaining authority after expiry', async () => {
    vi.useFakeTimers();
    try {
      const connections = new Map([['server', fixture()]]);
      const original = await acquireRuntimeCapabilityCatalog(
        connections,
        createCapabilityVisibility([['server', 'server']], 'session-0'),
      );
      for (let index = 1; index < 256; index++)
        await acquireRuntimeCapabilityCatalog(
          connections,
          createCapabilityVisibility([['server', 'server']], `session-${index}`),
        );
      await expect(
        acquireRuntimeCapabilityCatalog(connections, createCapabilityVisibility([['server', 'server']], 'overflow')),
      ).rejects.toThrow('capacity');
      vi.advanceTimersByTime(15 * 60 * 1000);
      await expect(
        acquireRuntimeCapabilityCatalog(connections, createCapabilityVisibility([['server', 'server']], 'recovered')),
      ).resolves.toBeDefined();
      expect(original.isCurrent()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates a cursor when upstream page positions change despite identical objects', async () => {
    let token = 'old';
    const connection = fixture('server', (_method, params) =>
      (params as { cursor?: string })?.cursor === token
        ? { tools: [tool('two')] }
        : { tools: [tool('one')], nextCursor: token },
    );
    const connections = new Map([['server', connection]]);
    const first = await acquireRuntimeCapabilityCatalog(connections);
    const page = await first.list('tools', { enablePagination: true });
    token = 'new';
    const second = await acquireRuntimeCapabilityCatalog(connections);
    await second.list('tools', { enablePagination: true });
    await expect(second.list('tools', { enablePagination: true, cursor: page.nextCursor })).rejects.toMatchObject({
      data: { reason: 'stale_generation' },
    });
  });

  it('rejects an oversized upstream cursor before retaining it or requesting another page', async () => {
    const connection = fixture('server', () => ({ tools: [], nextCursor: 'x'.repeat(65537) }));
    const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['server', connection]]));
    expect(connection.adapter.request).toHaveBeenCalledTimes(1);
    await expect(snapshot.list('tools', { enablePagination: false })).rejects.toThrow(
      'Capability providers are unavailable',
    );
  });

  it('bounds empty cursor-only walks by retained bytes, not only item count', async () => {
    let page = 0;
    const connection = fixture('server', () => ({ tools: [], nextCursor: `${++page}`.padEnd(65536, 'x') }));
    const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['server', connection]]));
    expect(page).toBeLessThanOrEqual(513);
    await expect(snapshot.list('tools', { enablePagination: false })).rejects.toThrow(
      'Capability providers are unavailable',
    );
  });

  it('orders the complete public snapshot across upstream page boundaries', async () => {
    const connection = fixture('server', (_method, params) =>
      (params as { cursor?: string })?.cursor === 'next'
        ? { tools: [tool('a')] }
        : { tools: [tool('z')], nextCursor: 'next' },
    );
    const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['server', connection]]));
    const first = await snapshot.list<{ name: string }>('tools', { enablePagination: true });
    const second = await snapshot.list<{ name: string }>('tools', { enablePagination: true, cursor: first.nextCursor });
    expect([...first.items, ...second.items].map((item) => item.name)).toEqual(['server_1mcp_a', 'server_1mcp_z']);
  });
});
