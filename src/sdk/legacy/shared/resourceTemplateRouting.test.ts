import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { createCapabilityVisibility } from '@src/core/capabilities/capabilityVisibility.js';
import {
  acquireRuntimeCapabilityCatalog,
  evictRuntimeCapabilityCatalogSession,
} from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { buildPublicResourceUri, isValidResourceUri } from '@src/utils/core/resourceUris.js';

import { projectResourceUri, resolveResourceRoute } from './resourceTemplateRouting.js';

async function snapshot(templates: unknown[], resources: unknown[] = [], server = 'server_1mcp_part') {
  const connection = createMockOutboundConnection({
    name: server,
    capabilities: { resources: {} },
    adapter: {
      request: vi.fn(
        async ({ method }) => (method === 'resources/list' ? { resources } : { resourceTemplates: templates }) as never,
      ),
    },
  });
  return acquireRuntimeCapabilityCatalog(new Map([['backend', connection]]));
}

describe('catalog resource template routing', () => {
  it('derives a template namespace from its stored public identity and rejects inconsistent aliases', async () => {
    const original = await snapshot([{ name: 'r', uriTemplate: 'file:///{id}' }]);
    const entry = original.generation.entries[0];
    const custom = {
      ...original,
      generation: {
        ...original.generation,
        entries: [{ ...entry, route: { ...entry.route, publicIdentity: 'owned-file:///{id}' } }],
      },
    };
    expect(resolveResourceRoute(custom, 'owned-file:///value%2f').upstreamIdentity).toBe('file:///value%2f');
    expect(projectResourceUri(custom, 'backend', 'file:///value%2f')).toBe('owned-file:///value%2f');
    custom.generation.entries[0].route.publicIdentity = 'unrelated:///{id}';
    expect(() => resolveResourceRoute(custom, 'unrelated:///value')).toThrow('Unknown resource');
  });

  it('retains opaque unlisted routes across refreshes only for their session and original backend', async () => {
    const connection = createMockOutboundConnection({ name: 'server', capabilities: {} });
    const connections = new Map([['backend', connection]]);
    const visibility = createCapabilityVisibility([['backend', 'server']], 'session');
    const catalog = await acquireRuntimeCapabilityCatalog(connections, visibility);
    const upstream = 'custom:///unlisted%2f?q=a%20b#x';
    const identity = projectResourceUri(catalog, 'backend', upstream);
    expect(identity).toMatch(/^urn:1mcp:resource:/);
    const refreshed = await acquireRuntimeCapabilityCatalog(connections, visibility);
    expect(resolveResourceRoute(refreshed, identity).upstreamIdentity).toBe(upstream);
    expect(projectResourceUri(refreshed, 'backend', upstream)).toBe(identity);
    const other = await acquireRuntimeCapabilityCatalog(
      connections,
      createCapabilityVisibility([['backend', 'server']], 'other'),
    );
    expect(() => resolveResourceRoute(other, identity)).toThrow('Unknown resource');
    evictRuntimeCapabilityCatalogSession(connections, 'session');
    const reopened = await acquireRuntimeCapabilityCatalog(connections, visibility);
    expect(() => resolveResourceRoute(reopened, identity)).toThrow('Unknown resource');
    const newIdentity = projectResourceUri(reopened, 'backend', upstream);
    Object.assign(connection, { adapter: createMockOutboundConnection().adapter });
    const replaced = await acquireRuntimeCapabilityCatalog(connections, visibility);
    expect(() => resolveResourceRoute(replaced, newIdentity)).toThrow('Unknown resource');
  });

  it('matches whole public templates and expands the original URI without parsing the server', async () => {
    const catalog = await snapshot([{ name: 'r', uriTemplate: 'file:///{id}' }]);
    const route = resolveResourceRoute(catalog, buildPublicResourceUri('server_1mcp_part', 'file:///value_1mcp_tail'));
    expect(route.upstreamIdentity).toBe('file:///value_1mcp_tail');
    expect(projectResourceUri(catalog, 'backend', route.upstreamIdentity)).toBe(
      buildPublicResourceUri('server_1mcp_part', 'file:///value_1mcp_tail'),
    );
    expect(() => resolveResourceRoute(catalog, 'server_1mcp_file:///value')).toThrow('Invalid resource URI');
  });

  it('rejects overlapping template matches deterministically', async () => {
    const catalog = await snapshot([
      { name: 'a', uriTemplate: 'file:///{id}' },
      { name: 'b', uriTemplate: 'file:///{name}' },
    ]);
    expect(() => resolveResourceRoute(catalog, buildPublicResourceUri('server_1mcp_part', 'file:///value'))).toThrow(
      'Ambiguous resource',
    );
  });

  it('prefers an exact resource route over template matches', async () => {
    const catalog = await snapshot(
      [{ name: 'r', uriTemplate: 'file:///{id}' }],
      [{ name: 'exact', uri: 'file:///one' }],
    );
    expect(
      resolveResourceRoute(catalog, buildPublicResourceUri('server_1mcp_part', 'file:///one')).entry.route.kind,
    ).toBe('resources');
  });

  it.each([
    ['file:///{user.name}', 'file:///a%20b'],
    ['file:///{%61.name}', 'file:///one'],
    ['file:///{id}', 'file:///a%20b'],
    ['file:///{id}', 'file:///a%2fb%3F%23%25'],
    ['https://example.test/search{?q}', 'https://example.test/search?q=a%2fb%26x%3Dy'],
    ['https://example.test/path{#fragment}', 'https://example.test/path#part%2fdetail'],
  ])('preserves encoded URI bytes for %s', async (uriTemplate, upstreamIdentity) => {
    const catalog = await snapshot([{ name: 'r', uriTemplate }]);
    const publicIdentity = buildPublicResourceUri('server_1mcp_part', upstreamIdentity);
    const route = resolveResourceRoute(catalog, publicIdentity);
    expect(route.upstreamIdentity).toBe(upstreamIdentity);
    expect(projectResourceUri(catalog, 'backend', route.upstreamIdentity)).toBe(publicIdentity);
  });

  it('ignores a malformed manual template without blocking a healthy sibling', async () => {
    const catalog = await snapshot([
      { name: 'bad', uriTemplate: 'file:///{' },
      { name: 'good', uriTemplate: 'file:///{id}' },
    ]);
    expect(
      resolveResourceRoute(catalog, buildPublicResourceUri('server_1mcp_part', 'file:///one')).upstreamIdentity,
    ).toBe('file:///one');
    expect(projectResourceUri(catalog, 'backend', 'file:///one')).toBe(
      buildPublicResourceUri('server_1mcp_part', 'file:///one'),
    );
  });

  it('projects additional read contents using the selected route backend authority', async () => {
    const catalog = await snapshot([], [{ name: 'selected', uri: 'file:///one' }]);
    const route = resolveResourceRoute(catalog, buildPublicResourceUri('server_1mcp_part', 'file:///one'));
    const projected = projectResourceUri(catalog, route.entry.route.connectionKey, 'file:///unlisted%2f?q=a%20b#x');
    expect(resolveResourceRoute(catalog, projected).upstreamIdentity).toBe('file:///unlisted%2f?q=a%20b#x');
  });
  it.each([
    ['{scheme}:///{id}', 'file:///one%2f'],
    ['{+uri}', 'https://[::1]/one%2f?q=a%20b#part'],
  ])('round-trips absolute expansions from variable URI template %s', async (uriTemplate, upstreamIdentity) => {
    const catalog = await snapshot([{ name: 'variable', uriTemplate }]);
    const publicIdentity = buildPublicResourceUri('server_1mcp_part', upstreamIdentity);
    expect(resolveResourceRoute(catalog, publicIdentity).upstreamIdentity).toBe(upstreamIdentity);
    expect(projectResourceUri(catalog, 'backend', upstreamIdentity)).toBe(publicIdentity);
    expect(isValidResourceUri(publicIdentity)).toBe(true);
  });

  it('advertises relative templates but rejects relative or malformed expansions before routing', async () => {
    const catalog = await snapshot(
      [
        { name: 'relative', uriTemplate: '/path/{id}' },
        { name: 'variable', uriTemplate: '{+uri}' },
      ],
      [{ name: 'healthy', uri: 'file:///one' }],
    );
    const relative = catalog.generation.entries.find((entry) => entry.route.upstreamIdentity === '/path/{id}');
    expect(relative).toBeDefined();
    expect(() => resolveResourceRoute(catalog, relative!.route.publicIdentity.replace('{id}', 'one'))).toThrow(
      'Invalid resource URI',
    );
    expect(() => projectResourceUri(catalog, 'backend', '/path/one')).toThrow('Invalid upstream resource URI');
    expect(() => projectResourceUri(catalog, 'backend', 'file:///bad%')).toThrow('Invalid upstream resource URI');
    const identity = buildPublicResourceUri('server_1mcp_part', 'file:///one');
    expect(resolveResourceRoute(catalog, identity).upstreamIdentity).toBe('file:///one');
  });
  it.each(['custom:', 'custom:?q=one', 'custom:#part'])(
    'routes valid empty-path URI %s without changing source bytes',
    async (upstreamIdentity) => {
      const catalog = await snapshot([], [{ name: 'empty', uri: upstreamIdentity }]);
      const identity = buildPublicResourceUri('server_1mcp_part', upstreamIdentity);
      expect(resolveResourceRoute(catalog, identity).upstreamIdentity).toBe(upstreamIdentity);
      expect(projectResourceUri(catalog, 'backend', upstreamIdentity)).toBe(identity);
    },
  );

  it('does not turn expression-like server names into template variables or break resource parity', async () => {
    const server = 'urn:{tenant}';
    const catalog = await snapshot([{ name: 'template', uriTemplate: 'file:///{id}' }], [], server);
    const identity = buildPublicResourceUri(server, 'file:///one');
    expect(catalog.generation.entries[0].route.publicIdentity).not.toContain('{tenant}');
    expect(resolveResourceRoute(catalog, identity).upstreamIdentity).toBe('file:///one');
    expect(projectResourceUri(catalog, 'backend', 'file:///one')).toBe(identity);
  });
});
