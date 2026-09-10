import { describe, expect, it } from 'vitest';

import {
  buildCatalogGeneration,
  type CapabilityKind,
  type CapabilitySource,
  readPublicCapabilityRoute,
} from './catalogGeneration.js';

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
      expect(entry.publicObject[fields[kind]]).toBe(`files_1mcp_${identity}`);
      expect(generation.resolve(kind, `files_1mcp_${identity}`)).toBe(entry);
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
});
