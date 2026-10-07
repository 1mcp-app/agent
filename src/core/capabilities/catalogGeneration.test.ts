import { buildPublicResourceTemplate, buildPublicResourceUri } from '@src/utils/core/resourceUris.js';
import { buildPublicToolName } from '@src/utils/core/toolNames.js';

import { describe, expect, it } from 'vitest';

import {
  buildCatalogGeneration,
  type CapabilityKind,
  type CapabilitySource,
  readPublicCapabilityRoute,
} from './catalogGeneration.js';
import { ToolRegistry } from './toolRegistry.js';

const objects = {
  tools: { name: 'read', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  prompts: { name: 'read', arguments: [{ name: 'query', required: true }] },
  resources: { name: 'read', uri: 'file:///read', mimeType: 'text/plain' },
  resourceTemplates: { name: 'read', uriTemplate: 'file:///{query}', mimeType: 'text/plain' },
};
const fields = { tools: 'name', prompts: 'name', resources: 'uri', resourceTemplates: 'uriTemplate' } as const;
const source = (kind: CapabilityKind, overrides: Partial<CapabilitySource> = {}): CapabilitySource => ({
  kind,
  server: 'files',
  connectionKey: 'files:1',
  object: objects[kind],
  ...overrides,
});

describe('immutable catalog generations', () => {
  it.each(Object.keys(objects) as CapabilityKind[])(
    'captures all %s data and preserves canonical identity exactly',
    (kind) => {
      const object = {
        ...objects[kind],
        title: 'Read',
        future: { values: [null, true, 4, { label: 'kept' }] },
        _meta: { vendor: { nested: [1] } },
      };
      const generation = buildCatalogGeneration(1, [source(kind, { object })]);
      const entry = generation.entries[0];
      const identity = (objects[kind] as Record<string, unknown>)[fields[kind]] as string;
      expect(generation.quarantine).toEqual([]);
      expect(entry.sourceObject).toEqual(object);
      const publicIdentity =
        kind === 'resources'
          ? buildPublicResourceUri('files', identity)
          : kind === 'resourceTemplates'
            ? buildPublicResourceTemplate('files', identity)
            : `files_1mcp_${identity}`;
      expect(entry.publicObject[fields[kind]]).toBe(publicIdentity);
      expect(generation.resolve(kind, publicIdentity)).toBe(entry);
      expect(entry.route.upstreamIdentity).toBe(identity);
      expect(readPublicCapabilityRoute(entry.publicObject)).toEqual({
        kind,
        server: 'files',
        upstreamIdentity: identity,
      });
      object.future.values.push(99);
      object._meta.vendor.nested.push(2);
      expect(entry.sourceObject).not.toEqual(object);
      expect(entry.publicObject.future).toEqual({ values: [null, true, 4, { label: 'kept' }] });
      expect(Object.isFrozen(entry.publicObject.future)).toBe(true);
      expect(Object.isFrozen(entry.route)).toBe(true);
      expect(Object.isFrozen(generation.entries)).toBe(true);
      expect(() => Object.assign(entry.route, { server: 'attacker' })).toThrow();
    },
  );

  it('quarantines an invalid individual object while retaining its healthy siblings', () => {
    const generation = buildCatalogGeneration(1, [source('tools', { object: { name: 'bad' } }), source('resources')]);
    expect(generation.entries).toHaveLength(1);
    expect(generation.entries[0].route.kind).toBe('resources');
    expect(generation.quarantine[0].reason).toBe('invalid-source');
  });

  it.each(['_meta', 'annotations', 'extensions', 'namespaces'])('rejects reserved ownership inside %s', (field) => {
    for (const key of ['app.1mcp', 'app.1mcp/route', 'app.1mcp.tasks']) {
      const generation = buildCatalogGeneration(1, [
        source('tools', { object: { ...objects.tools, [field]: { nested: [{ [key]: { server: 'spoofed' } }] } } }),
      ]);
      expect(generation.entries).toEqual([]);
      expect(generation.quarantine).toHaveLength(1);
    }
  });

  it('allows opaque schema property names without interpreting them as namespace ownership', () => {
    const generation = buildCatalogGeneration(1, [
      source('tools', {
        object: { name: 'data', inputSchema: { type: 'object', properties: { 'app.1mcp': { type: 'string' } } } },
      }),
    ]);
    expect(generation.entries).toHaveLength(1);
  });

  it('reserves the logical internal server and permits only explicit trusted internal aliases', () => {
    expect(buildCatalogGeneration(1, [source('tools', { server: '1mcp' })]).entries).toEqual([]);
    expect(buildCatalogGeneration(1, [source('tools', { publicIdentity: 'raw' })]).entries).toEqual([]);
    const internal = buildCatalogGeneration(1, [
      source('tools', { server: '1mcp', origin: 'internal', publicIdentity: 'raw' }),
    ]);
    expect(internal.resolve('tools', 'raw')?.route.origin).toBe('internal');
  });

  it('rejects every duplicate without first-wins behavior in either enumeration order', () => {
    for (const kind of Object.keys(objects) as CapabilityKind[]) {
      const sources = [source(kind), source(kind, { object: { ...objects[kind], description: 'different' } })];
      for (const ordered of [sources, [...sources].reverse()]) {
        const generation = buildCatalogGeneration(1, ordered);
        expect(generation.entries).toEqual([]);
        expect(generation.quarantine.map((item) => item.reason)).toEqual(['identity-collision', 'identity-collision']);
      }
    }
  });

  it('rejects delimiter and whitespace collisions without ever parsing the public identity', () => {
    for (let index = 0; index < 30; index++) {
      const first = source('prompts', { server: `s${index}`, object: { name: 'nested_1mcp_read' } });
      const second = source('prompts', {
        server: `s${index}_1mcp_nested`,
        connectionKey: 'other',
        object: { name: 'read' },
      });
      expect(buildCatalogGeneration(index, [first, second]).entries).toEqual([]);
      expect(
        buildCatalogGeneration(index, [
          source('prompts'),
          source('prompts', { connectionKey: 'other', object: { name: ' read ' } }),
        ]).entries,
      ).toEqual([]);
    }
  });

  it('keeps independent template instances but requires one visible exact route', () => {
    const generation = buildCatalogGeneration(
      1,
      [source('tools'), source('tools', { connectionKey: 'files:2' }), source('prompts')],
      { allowTemplateInstances: true },
    );
    expect(generation.entries).toHaveLength(3);
    expect(generation.resolve('tools', 'files_1mcp_read')).toBeUndefined();
    expect(generation.resolve('tools', 'files_1mcp_read', new Set(['files:2']))?.route.connectionKey).toBe('files:2');
    expect(generation.resolve('tools', 'read', new Set(['files:2']))).toBeUndefined();
    expect(generation.resolve('prompts', 'files_1mcp_read')).toBeDefined();
  });

  it('rejects duplicate source identities even when trusted aliases differ', () => {
    const generation = buildCatalogGeneration(1, [
      source('tools', { server: '1mcp', origin: 'internal', publicIdentity: 'first' }),
      source('tools', { server: '1mcp', origin: 'internal', publicIdentity: 'second' }),
    ]);
    expect(generation.entries).toEqual([]);
    expect(generation.quarantine).toHaveLength(2);
  });

  it('quarantines non-JSON input without retaining mutable transport objects', () => {
    const cyclic: Record<string, unknown> = { ...objects.tools };
    cyclic.self = cyclic;
    for (const object of [
      cyclic,
      { ...objects.tools, future: () => undefined },
      { ...objects.tools, future: Infinity },
    ]) {
      expect(buildCatalogGeneration(1, [source('tools', { object })]).entries).toEqual([]);
    }
  });

  it('rejects invalid generation identifiers without affecting a previously built generation', () => {
    const previous = buildCatalogGeneration(1, [source('tools')]);
    expect(() => buildCatalogGeneration(NaN, [])).toThrow();
    expect(previous.resolve('tools', 'files_1mcp_read')).toBeDefined();
    expect(
      readPublicCapabilityRoute({ _meta: { 'app.1mcp/route': { kind: 'tasks', server: 'x', upstreamIdentity: 'a' } } }),
    ).toBeUndefined();
  });

  it('bounds tool names while retaining the exact upstream route across reload and visibility changes', () => {
    const upstreamIdentity = ` long tool_1mcp_${'x'.repeat(70)} `;
    const first = source('tools', { object: { ...objects.tools, name: upstreamIdentity } });
    const second = { ...first, connectionKey: 'files:2' };
    const generation = buildCatalogGeneration(1, [first, second], { allowTemplateInstances: true });
    const identity = generation.entries[0].route.publicIdentity;
    expect(identity).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
    expect(generation.resolve('tools', identity)).toBeUndefined();
    const route = generation.resolve('tools', identity, new Set(['files:2']));
    expect(route?.route.upstreamIdentity).toBe(upstreamIdentity);
    expect(route?.sourceObject.name).toBe(upstreamIdentity);
    expect(route?.route.connectionKey).toBe('files:2');
    expect(readPublicCapabilityRoute(route?.publicObject)?.upstreamIdentity).toBe(upstreamIdentity);
    const registry = ToolRegistry.fromGeneration(generation).filterByConnectionKeys(new Set(['files:2']));
    expect(registry.getTool('files', upstreamIdentity)?.route).toEqual(route?.route);
    expect(registry.getAllTools()).toHaveLength(1);
    const reloaded = buildCatalogGeneration(2, [source('tools'), second]);
    expect(reloaded.resolve('tools', identity)?.route.upstreamIdentity).toBe(upstreamIdentity);
    expect(reloaded.resolve('tools', `files_1mcp_${upstreamIdentity.trim()}`)).toBeUndefined();
    expect(generation.resolve('tools', identity, new Set(['files:1']))?.route.connectionKey).toBe('files:1');
  });

  it('quarantines deliberate generated-to-valid collisions in both enumeration orders', () => {
    const longName = 'x'.repeat(80);
    const identity = buildPublicToolName('files', longName);
    const shortName = identity.slice('files_1mcp_'.length);
    const colliding = [
      source('tools', { object: { ...objects.tools, name: longName } }),
      source('tools', { object: { ...objects.tools, name: shortName } }),
    ];
    for (const ordered of [colliding, [...colliding].reverse()]) {
      const generation = buildCatalogGeneration(1, [...ordered, source('tools')]);
      expect(generation.resolve('tools', identity)).toBeUndefined();
      expect(generation.entries.map((entry) => entry.route.publicIdentity)).toEqual(['files_1mcp_read']);
      expect(generation.quarantine.map((item) => item.reason)).toEqual(['identity-collision', 'identity-collision']);
    }
  });

  it('retains whitespace collision semantics for names requiring a generated identity', () => {
    const name = 'long name'.repeat(10);
    const generation = buildCatalogGeneration(1, [
      source('tools', { object: { ...objects.tools, name } }),
      source('tools', { object: { ...objects.tools, name: ` ${name} ` } }),
    ]);
    expect(generation.entries).toEqual([]);
    expect(generation.quarantine.map((item) => item.reason)).toEqual(['identity-collision', 'identity-collision']);
  });

  it('rejects invalid trusted public tool names and malformed server identities', () => {
    for (const publicIdentity of ['tool name', 'x'.repeat(65), 'tool_list\n']) {
      expect(
        buildCatalogGeneration(1, [source('tools', { server: '1mcp', origin: 'internal', publicIdentity })]).entries,
      ).toEqual([]);
    }
    expect(buildCatalogGeneration(1, [source('tools', { server: 'bad-\ud800' })]).entries).toEqual([]);
  });

  it('leaves prompt identities unchanged when tool-only formatting is required', () => {
    const name = 'long name'.repeat(10);
    for (const kind of ['prompts'] as const) {
      const generation = buildCatalogGeneration(1, [
        source(kind, { object: { ...objects[kind], [fields[kind]]: name } }),
      ]);
      expect(generation.entries[0].route.publicIdentity).toBe(`files_1mcp_${name}`);
    }
  });
  it.each(Object.keys(objects) as CapabilityKind[])(
    'quarantines unpaired surrogates and keeps valid astral %s identities',
    (kind) => {
      const valid = kind === 'resources' ? 'file:///valid-%F0%9F%98%80' : 'valid-\ud83d\ude00';
      const generation = buildCatalogGeneration(1, [
        source(kind, { object: { ...objects[kind], [fields[kind]]: 'bad-\ud800' } }),
        source(kind, { object: { ...objects[kind], [fields[kind]]: 'bad-\udc00' } }),
        source(kind, { object: { ...objects[kind], [fields[kind]]: valid } }),
      ]);
      expect(generation.entries).toHaveLength(1);
      expect(generation.entries[0].route.upstreamIdentity).toBe(valid);
      expect(generation.quarantine).toHaveLength(2);
    },
  );
  it.each(['resources', 'resourceTemplates'] as const)(
    'retains valid legacy %s and explicit trusted aliases',
    (kind) => {
      const identity = kind === 'resources' ? objects.resources.uri : objects.resourceTemplates.uriTemplate;
      const generation = buildCatalogGeneration(1, [
        source(kind, { server: 'urn:tenant' }),
        source(kind, {
          server: '1mcp',
          origin: 'internal',
          publicIdentity: kind === 'resources' ? 'urn:internal:read' : 'urn:internal:{id}',
        }),
      ]);
      expect(generation.quarantine).toEqual([]);
      expect(generation.resolve(kind, `urn:tenant_1mcp_${identity}`)?.route.upstreamIdentity).toBe(identity);
      expect(generation.entries[1].route.publicIdentity).toBe(
        kind === 'resources' ? 'urn:internal:read' : 'urn:internal:{id}',
      );
    },
  );

  it.each(['resources', 'resourceTemplates'] as const)(
    'keeps generated %s references stable across reload and exact backend filtering',
    (kind) => {
      const sources = [source(kind), source(kind, { connectionKey: 'files:2' })];
      const generation = buildCatalogGeneration(1, sources, { allowTemplateInstances: true });
      const identity = generation.entries[0].route.publicIdentity;
      expect(generation.resolve(kind, identity)).toBeUndefined();
      expect(generation.resolve(kind, identity, new Set(['files:2']))?.route.connectionKey).toBe('files:2');
      const reloaded = buildCatalogGeneration(2, [sources[1]]);
      expect(reloaded.resolve(kind, identity)?.route.upstreamIdentity).toBe(
        kind === 'resources' ? objects.resources.uri : objects.resourceTemplates.uriTemplate,
      );
    },
  );

  it.each(['resources', 'resourceTemplates'] as const)(
    'quarantines generated-to-valid %s collisions without enumeration preference',
    (kind) => {
      const identity =
        kind === 'resources'
          ? buildPublicResourceUri('files', 'file:///read')
          : buildPublicResourceTemplate('files', 'file:///{query}');
      const colliding = [
        source(kind),
        source(kind, {
          server: '1mcp',
          origin: 'internal',
          publicIdentity: identity,
          object: { ...objects[kind], [fields[kind]]: kind === 'resources' ? 'file:///other' : 'file:///{other}' },
        }),
      ];
      for (const ordered of [colliding, [...colliding].reverse()]) {
        const generation = buildCatalogGeneration(1, [...ordered, source('prompts')]);
        expect(generation.resolve(kind, identity)).toBeUndefined();
        expect(generation.entries.map((entry) => entry.route.kind)).toEqual(['prompts']);
        expect(generation.quarantine.map((item) => item.reason)).toEqual(['identity-collision', 'identity-collision']);
      }
    },
  );

  it('quarantines malformed resource identities and invalid trusted public URIs without hiding healthy siblings', () => {
    const generation = buildCatalogGeneration(1, [
      source('resources', { object: { ...objects.resources, uri: 'file:///bad%' } }),
      source('resources', { object: { ...objects.resources, uri: '/relative' } }),
      source('resourceTemplates', { object: { ...objects.resourceTemplates, uriTemplate: 'file:///{' } }),
      source('resources', { server: '1mcp', origin: 'internal', publicIdentity: 'invalid_uri' }),
      source('resources'),
      source('resourceTemplates', { object: { ...objects.resourceTemplates, uriTemplate: '/relative/{id}' } }),
    ]);
    expect(generation.quarantine).toHaveLength(4);
    expect(generation.quarantine.every((item) => item.reason === 'invalid-source')).toBe(true);
    expect(generation.entries).toHaveLength(2);
    expect(generation.entries[1].route.upstreamIdentity).toBe('/relative/{id}');
  });
  it('retains dotted RFC6570 variables and empty-path source URIs alongside healthy siblings', () => {
    const generation = buildCatalogGeneration(1, [
      source('resourceTemplates', { object: { name: 'dotted', uriTemplate: 'file:///{user.name}' } }),
      ...['custom:', 'custom:?q=one', 'custom:#part'].map((uri) =>
        source('resources', { object: { name: 'empty', uri } }),
      ),
      source('resources'),
    ]);
    expect(generation.quarantine).toEqual([]);
    expect(generation.entries).toHaveLength(5);
    expect(generation.entries[0].route.upstreamIdentity).toBe('file:///{user.name}');
    for (const uri of ['custom:', 'custom:?q=one', 'custom:#part']) {
      expect(generation.resolve('resources', buildPublicResourceUri('files', uri))?.route.upstreamIdentity).toBe(uri);
    }
  });
});
