import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import type { OutboundConnections } from '@src/core/types/index.js';
import { schemaBoundary, SchemaBoundaryError } from '@src/core/validation/schemaBoundary.js';
import { ErrorCode, type JsonValue, OneMcpProtocolError } from '@src/sdk/contracts/index.js';
import { buildPublicResourceTemplate } from '@src/utils/core/resourceUris.js';

import * as pagination from './capabilityPagination.js';
import {
  CapabilityCursorCapacityError,
  CapabilityProvidersUnavailableError,
  getCapabilityFailureFacts,
} from './capabilityPagination.js';
import {
  createCapabilityVisibility,
  createResourceRouteOwner,
  revokeResourceRouteOwner,
} from './capabilityVisibility.js';
import {
  isConfiguredToolSnapshotComplete,
  readConfiguredToolSnapshot,
  readLastConfiguredToolSnapshot,
} from './configuredToolSnapshot.js';
import {
  acquireRuntimeCapabilityCatalog,
  evictRuntimeCapabilityCatalogSession,
  isIssuedRuntimeResourceEntry,
  pruneRuntimeResourceRoutes,
  RUNTIME_CATALOG_SCOPE_TTL_MS,
} from './runtimeCapabilityCatalog.js';

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
  it('injects the native selected paths before validating inputs and keeps disabled tools inaccessible', async () => {
    const connection = fixture('native', () => ({
      tools: [
        {
          name: 'search',
          inputSchema: {
            type: 'object',
            properties: { projects: { type: 'array', items: { type: 'string' }, minItems: 2 } },
            required: ['projects'],
            additionalProperties: false,
          },
        },
      ],
    }));
    const projectContext = {
      project: {},
      user: {},
      environment: {},
      sessionId: 'agent',
      projectSet: {
        projects: [
          { label: 'front', path: '/front' },
          { label: 'back', path: '/back' },
        ],
        selection: ['front', 'back'],
      },
    };
    const visibility = { ...createCapabilityVisibility([['native', 'native']], 'target-binding'), projectContext };
    const config = {
      type: 'stdio' as const,
      command: 'node',
      projectTarget: { mode: 'native-set' as const, argument: 'projects' },
      disabledTools: [] as string[],
    };
    const connections = new Map([['native', connection]]);
    const snapshot = await acquireRuntimeCapabilityCatalog(connections, visibility, {
      serverConfigs: { native: config },
    });
    expect((await snapshot.prepareToolCall('native_1mcp_search', {})).targetArguments).toEqual({
      projects: ['/front', '/back'],
    });
    await expect(snapshot.prepareToolCall('native_1mcp_search', { projects: ['/other'] })).rejects.toThrow('conflicts');
    config.disabledTools.push('search');
    const disabled = await acquireRuntimeCapabilityCatalog(connections, visibility, {
      serverConfigs: { native: config },
    });
    expect(disabled.resolve('tools', 'native_1mcp_search')).toBeUndefined();
    await expect(disabled.prepareToolCall('native_1mcp_search', {})).rejects.toThrow('schema_invalid');
  });

  it('recognizes only exact catalog-minted unlisted resource entries as issued provenance', async () => {
    const connection = createMockOutboundConnection({
      name: 'provider',
      capabilities: { resources: {} },
      adapter: {
        request: vi.fn(async ({ method }): Promise<JsonValue> =>
          method === 'resources/list'
            ? { resources: [{ name: 'listed', uri: 'file:///listed' }] }
            : { resourceTemplates: [] },
        ),
      },
    });
    const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['provider', connection]]));
    const listed = snapshot.generation.entries.find((entry) => entry.route.kind === 'resources')!;
    const uri = snapshot.projectUnlistedResource('provider', 'urn:provider:opaque');
    const issued = snapshot.resolve('resources', uri)!.entry;
    expect(isIssuedRuntimeResourceEntry(issued)).toBe(true);
    expect(isIssuedRuntimeResourceEntry(listed)).toBe(false);
    expect(isIssuedRuntimeResourceEntry(structuredClone(issued))).toBe(false);
    expect(snapshot.generation.entries).not.toContain(issued);
  });

  it('exposes the admitted tools/list schema projection and retains its source fence', async () => {
    let schema = {
      type: 'object',
      properties: { region: { type: 'string', 'x-mcp-header': 'Region' } },
      required: ['region'],
    };
    const connection = fixture('header-catalog', () => ({ tools: [{ name: 'region', inputSchema: schema }] }));
    const connections = new Map([['header-catalog', connection]]);
    const snapshot = await acquireRuntimeCapabilityCatalog(connections);
    const definition = snapshot.getToolDefinition('header-catalog_1mcp_region');
    expect(definition?.tool).toEqual((await snapshot.list('tools', { enablePagination: false })).items[0]);
    expect(definition?.tool.inputSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      properties: { region: { 'x-mcp-header': 'Region' } },
    });
    expect(snapshot.getToolDefinition('unknown')).toBeUndefined();
    schema = { ...schema, required: [] };
    await acquireRuntimeCapabilityCatalog(connections);
    expect(() => definition?.assertCurrent()).toThrow('schema_invalid');
  });

  it.each(['listing', 'admission'] as const)(
    'exposes synchronous captured %s failure facts before any listing walk',
    async (failure) => {
      const connection = fixture('snapshot-meta', () => {
        if (failure === 'listing') throw new Error('untrusted provider details');
        return { tools: [tool('echo')] };
      });
      const admit = schemaBoundary.admit.bind(schemaBoundary);
      const admission = vi.spyOn(schemaBoundary, 'admit').mockImplementation(async (schema, binding) => {
        if (failure === 'admission') throw new SchemaBoundaryError('schema_evaluation_timeout', true, 'admission');
        return admit(schema, binding);
      });
      try {
        const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['private-capture-key', connection]]));
        const category = failure === 'listing' ? 'upstream_list_failed' : 'upstream_tool_admission_timeout';
        expect(snapshot.capabilityMeta?.tools).toMatchObject({
          'app.1mcp/capability-pagination': {
            partial: true,
            complete: false,
            generation: String(snapshot.generation.id),
            failedSourceCount: 1,
            failureCategories: { [category]: 1 },
            retryable: true,
            recovery: 'restart-walk',
          },
        });
        expect([...getCapabilityFailureFacts(snapshot.capabilityMeta?.tools)]).toEqual([
          ['private-capture-key', { [category]: 1 }],
        ]);
        expect(snapshot.capabilityMeta?.resources).toBeUndefined();
        expect(JSON.stringify(snapshot.capabilityMeta)).not.toContain('private-capture-key');
        expect(JSON.stringify(snapshot.capabilityMeta)).not.toContain('untrusted');
        if (failure === 'listing') {
          await expect(snapshot.list('tools', { enablePagination: false })).rejects.toBeInstanceOf(
            CapabilityProvidersUnavailableError,
          );
        }
      } finally {
        admission.mockRestore();
      }
    },
  );

  it('omits captured failure metadata for a complete healthy observation', async () => {
    const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['server', fixture()]]));
    expect(snapshot.capabilityMeta).toBeUndefined();
  });

  it('blocks old calls when a timeout completes behind a newer pending acquisition', async () => {
    const connection = fixture('overlap');
    const connections = new Map([['overlap', connection]]);
    const original = await acquireRuntimeCapabilityCatalog(connections);
    const prepared = await original.prepareToolCall('overlap_1mcp_echo', {});
    let rejectAdmission!: (reason: unknown) => void;
    const admission = vi.spyOn(schemaBoundary, 'admit').mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectAdmission = reject;
        }),
    );
    try {
      const older = acquireRuntimeCapabilityCatalog(connections);
      await vi.waitFor(() => expect(rejectAdmission).toBeDefined());
      let rejectListing!: (reason: unknown) => void;
      vi.mocked(connection.adapter.request).mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectListing = reject;
          }),
      );
      const newer = acquireRuntimeCapabilityCatalog(connections);
      expect(rejectListing).toBeDefined();
      rejectAdmission(new SchemaBoundaryError('schema_evaluation_timeout', true, 'admission'));
      const partial = await older;
      expect((await partial.list('tools', { enablePagination: false }))._meta).toMatchObject({
        'app.1mcp/capability-pagination': { partial: true },
      });
      await expect(original.prepareToolCall('overlap_1mcp_echo', {})).rejects.toMatchObject({
        code: 'schema_evaluation_timeout',
        retryable: true,
        phase: 'admission',
      });
      expect(() => prepared.assertCurrent()).toThrow('schema_evaluation_timeout');
      expect(isConfiguredToolSnapshotComplete(connection)).toBe(false);
      rejectListing(new Error('listing unavailable'));
      await newer;
      await expect(original.prepareToolCall('overlap_1mcp_echo', {})).rejects.toThrow('schema_evaluation_timeout');
      const recovered = await acquireRuntimeCapabilityCatalog(connections);
      const validation = await recovered.prepareToolCall('overlap_1mcp_echo', {});
      await expect(validation({ content: [] })).resolves.toBeUndefined();
      expect(isConfiguredToolSnapshotComplete(connection)).toBe(true);
    } finally {
      admission.mockRestore();
    }
  });

  it('does not let an older timeout overwrite a newer successful admission', async () => {
    const connection = fixture('ordered');
    const connections = new Map([['ordered', connection]]);
    const original = await acquireRuntimeCapabilityCatalog(connections);
    const prepared = await original.prepareToolCall('ordered_1mcp_echo', {});
    let rejectAdmission!: (reason: unknown) => void;
    const admission = vi.spyOn(schemaBoundary, 'admit').mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectAdmission = reject;
        }),
    );
    try {
      const older = acquireRuntimeCapabilityCatalog(connections);
      await vi.waitFor(() => expect(rejectAdmission).toBeDefined());
      const newer = await acquireRuntimeCapabilityCatalog(connections);
      rejectAdmission(new SchemaBoundaryError('schema_evaluation_timeout', true, 'admission'));
      const partial = await older;
      expect(partial.resolve('tools', 'ordered_1mcp_echo')).toBeUndefined();
      expect(() => prepared.assertCurrent()).not.toThrow();
      const validation = await original.prepareToolCall('ordered_1mcp_echo', {});
      await expect(validation({ content: [] })).resolves.toBeUndefined();
      await expect(newer.prepareToolCall('ordered_1mcp_echo', {})).resolves.toBeDefined();
      expect(isConfiguredToolSnapshotComplete(connection)).toBe(true);
    } finally {
      admission.mockRestore();
    }
  });

  it.each([true, false])(
    'isolates upstream admission timeout and preserves discovery with pagination=%s',
    async (enablePagination) => {
      const connection = fixture('server', () => ({ tools: [tool('healthy'), tool('slow')] }));
      const connections = new Map([['server', connection]]);
      const previous = await acquireRuntimeCapabilityCatalog(connections);
      const inventory = readConfiguredToolSnapshot(connection);
      const completeTarget = readLastConfiguredToolSnapshot('server');
      const admit = schemaBoundary.admit.bind(schemaBoundary);
      const admission = vi.spyOn(schemaBoundary, 'admit').mockImplementation(async (schema, binding) => {
        if (JSON.parse(binding.routeKey)[1] === 'slow') {
          throw new SchemaBoundaryError('schema_evaluation_timeout', true, 'admission');
        }
        return admit(schema, binding);
      });
      try {
        const partial = await acquireRuntimeCapabilityCatalog(connections);
        const result = await partial.list<{ name: string }>('tools', { enablePagination });
        expect(result.items.map(({ name }) => name)).toEqual(['server_1mcp_healthy']);
        expect(result._meta).toMatchObject({
          'app.1mcp/capability-pagination': {
            partial: true,
            complete: false,
            failedSourceCount: 1,
            failureCategories: { upstream_tool_admission_timeout: 1 },
            retryable: true,
            recovery: 'restart-walk',
          },
        });
        expect(partial.resolve('tools', 'server_1mcp_slow')).toBeUndefined();
        await expect(partial.prepareToolCall('server_1mcp_slow', {})).rejects.toThrow('schema_invalid');
        await expect(previous.prepareToolCall('server_1mcp_slow', {})).rejects.toThrow('schema_evaluation_timeout');
        const validate = await partial.prepareToolCall('server_1mcp_healthy', {});
        await expect(validate({ content: [] })).resolves.toBeUndefined();
        expect(readConfiguredToolSnapshot(connection)).toBe(inventory);
        expect(readLastConfiguredToolSnapshot('server')).toBe(completeTarget);
      } finally {
        admission.mockRestore();
      }
      const recovered = await acquireRuntimeCapabilityCatalog(connections);
      expect((await recovered.list('tools', { enablePagination: false }))._meta).toBeUndefined();
      expect(recovered.resolve('tools', 'server_1mcp_slow')).toBeDefined();
    },
  );

  it.each([true, false])(
    'returns explicit partial emptiness when every upstream tool times out with pagination=%s',
    async (enablePagination) => {
      const connection = fixture('all-timeout', () => ({ tools: [tool('one'), tool('two')] }));
      const admission = vi
        .spyOn(schemaBoundary, 'admit')
        .mockRejectedValue(new SchemaBoundaryError('schema_evaluation_timeout', true, 'admission'));
      try {
        const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['all-timeout', connection]]));
        const result = await snapshot.list('tools', { enablePagination });
        expect(result.items).toEqual([]);
        expect(result.nextCursor).toBeUndefined();
        expect(result._meta).toMatchObject({
          'app.1mcp/capability-pagination': {
            complete: false,
            failedSourceCount: 1,
            failureCategories: { upstream_tool_admission_timeout: 2 },
          },
        });
        expect(readConfiguredToolSnapshot(connection)).toBeUndefined();
      } finally {
        admission.mockRestore();
      }
    },
  );

  it.each([
    new SchemaBoundaryError('schema_evaluation_unavailable', true, 'admission'),
    new SchemaBoundaryError('schema_evaluation_unavailable', false, 'admission'),
    new SchemaBoundaryError('schema_evaluation_timeout', true, 'input'),
    new SchemaBoundaryError('schema_evaluation_timeout', true, 'output'),
    new SchemaBoundaryError('schema_evaluation_timeout', false, 'input'),
    new SchemaBoundaryError('schema_evaluation_timeout', false, 'output'),
    new Error('unexpected admission failure'),
  ])('keeps shared and non-admission failures fatal: %s', async (error) => {
    const admission = vi.spyOn(schemaBoundary, 'admit').mockRejectedValueOnce(error);
    try {
      await expect(acquireRuntimeCapabilityCatalog(new Map([['server', fixture()]]))).rejects.toBe(error);
    } finally {
      admission.mockRestore();
    }
  });

  it.each(['internalTools', 'unprefixedTools'] as const)(
    'keeps runtime-owned %s admission failure fatal',
    async (key) => {
      const error = new SchemaBoundaryError('schema_evaluation_timeout', true, 'admission');
      const admission = vi.spyOn(schemaBoundary, 'admit').mockRejectedValueOnce(error);
      try {
        await expect(acquireRuntimeCapabilityCatalog(new Map(), undefined, { [key]: [tool('internal')] })).rejects.toBe(
          error,
        );
      } finally {
        admission.mockRestore();
      }
    },
  );

  it('keeps an admission-partial continuation pinned without retrying, then retries a fresh walk', async () => {
    const connection = fixture('server', () => ({ tools: [tool('a'), tool('b'), tool('slow')] }));
    const connections = new Map([['server', connection]]);
    const admit = schemaBoundary.admit.bind(schemaBoundary);
    const admission = vi.spyOn(schemaBoundary, 'admit').mockImplementation(async (schema, binding) => {
      if (JSON.parse(binding.routeKey)[1] === 'slow') throw new SchemaBoundaryError('schema_evaluation_timeout', true);
      return admit(schema, binding);
    });
    try {
      const snapshot = await acquireRuntimeCapabilityCatalog(connections);
      const first = await snapshot.list<{ name: string }>('tools', { enablePagination: true, pageSize: 1 });
      const admissionCalls = admission.mock.calls.length;
      const continued = await acquireRuntimeCapabilityCatalog(connections, undefined, {
        continuation: { kind: 'tools', cursor: first.nextCursor!, enablePagination: true, pageSize: 1 },
      });
      const final = await continued.list<{ name: string }>('tools', {
        enablePagination: true,
        pageSize: 1,
        cursor: first.nextCursor,
      });
      expect(continued).toBe(snapshot);
      expect(final.items.map(({ name }) => name)).toEqual(['server_1mcp_b']);
      expect(final.nextCursor).toBeUndefined();
      expect(final._meta).toEqual(first._meta);
      expect(admission).toHaveBeenCalledTimes(admissionCalls);
      expect(connection.adapter.request).toHaveBeenCalledTimes(1);
      admission.mockRestore();
      const recovered = await acquireRuntimeCapabilityCatalog(connections);
      expect(recovered.resolve('tools', 'server_1mcp_slow')).toBeDefined();
      await recovered.list('tools', { enablePagination: true, pageSize: 1 });
      await expect(
        snapshot.list('tools', { enablePagination: true, pageSize: 1, cursor: first.nextCursor }),
      ).rejects.toMatchObject({
        data: { reason: 'stale_generation' },
      });
    } finally {
      admission.mockRestore();
    }
  });

  it('reports independent listing and tool admission failures together', async () => {
    const failed = fixture('failed', () => {
      throw new Error('untrusted backend details');
    });
    const healthy = fixture('healthy', () => ({ tools: [tool('ok'), tool('slow')] }));
    const admit = schemaBoundary.admit.bind(schemaBoundary);
    const admission = vi.spyOn(schemaBoundary, 'admit').mockImplementation(async (schema, binding) => {
      if (JSON.parse(binding.routeKey)[1] === 'slow') throw new SchemaBoundaryError('schema_evaluation_timeout', true);
      return admit(schema, binding);
    });
    try {
      const snapshot = await acquireRuntimeCapabilityCatalog(
        new Map([
          ['failed', failed],
          ['healthy', healthy],
        ]),
      );
      const result = await snapshot.list('tools', { enablePagination: false });
      expect(result._meta).toMatchObject({
        'app.1mcp/capability-pagination': {
          failedSourceCount: 2,
          failureCategories: { upstream_list_failed: 1, upstream_tool_admission_timeout: 1 },
        },
      });
      expect(JSON.stringify(result._meta)).not.toContain('untrusted backend details');
    } finally {
      admission.mockRestore();
    }
  });

  it.each(['reject', 'resolve'] as const)('preserves published tools when a cancelled refresh %ss', async (outcome) => {
    const connection = fixture();
    const connections = new Map([['server', connection]]);
    const snapshot = await acquireRuntimeCapabilityCatalog(connections);
    const published = readConfiguredToolSnapshot(connection);
    const controller = new AbortController();
    let finish!: () => void;
    vi.mocked(connection.adapter.request).mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () => {
            if (outcome === 'reject') reject(new Error('Request cancelled'));
            else resolve({ tools: [] } as never);
          };
        }),
    );
    const refresh = acquireRuntimeCapabilityCatalog(connections, undefined, { signal: controller.signal });
    const reason = new Error('caller cancelled');
    controller.abort(reason);
    finish();
    await expect(refresh).rejects.toBe(reason);
    expect(readConfiguredToolSnapshot(connection)).toBe(published);
    expect(snapshot.resolve('tools', 'server_1mcp_echo')).toBeDefined();
    const validate = await snapshot.prepareToolCall('server_1mcp_echo', {});
    await expect(validate({ content: [] })).resolves.toBeUndefined();
  });

  it.each(['echo', 'replacement'])(
    'retains inventory but respects observed %s contract after admission cancellation',
    async (observedName) => {
      const connection = fixture();
      const connections = new Map([['server', connection]]);
      const snapshot = await acquireRuntimeCapabilityCatalog(connections);
      const published = readConfiguredToolSnapshot(connection);
      vi.mocked(connection.adapter.request).mockResolvedValueOnce({ tools: [tool(observedName)] } as never);
      const controller = new AbortController();
      const reason = new Error('cancel during admission');
      const admission = vi.spyOn(schemaBoundary, 'admit').mockImplementationOnce(async () => {
        controller.abort(reason);
        throw reason;
      });
      try {
        await expect(
          acquireRuntimeCapabilityCatalog(connections, undefined, { signal: controller.signal }),
        ).rejects.toBe(reason);
      } finally {
        admission.mockRestore();
      }
      expect(readConfiguredToolSnapshot(connection)).toBe(published);
      if (observedName === 'replacement') {
        await expect(snapshot.prepareToolCall('server_1mcp_echo', {})).rejects.toThrow('schema_invalid');
        return;
      }
      const validate = await snapshot.prepareToolCall('server_1mcp_echo', {});
      await expect(validate({ content: [] })).resolves.toBeUndefined();
    },
  );

  it('keeps identical external contracts callable across concurrent publications', async () => {
    const connection = fixture();
    const connections = new Map([['server', connection]]);
    const snapshots = await Promise.all(Array.from({ length: 3 }, () => acquireRuntimeCapabilityCatalog(connections)));
    for (const snapshot of snapshots) {
      const finish = await snapshot.prepareToolCall('server_1mcp_echo', {});
      await expect(finish({ content: [] })).resolves.toBeUndefined();
    }
  });

  it('keeps a published contract callable during a pending read, then rejects an observed change', async () => {
    const connection = fixture();
    const connections = new Map([['server', connection]]);
    const first = await acquireRuntimeCapabilityCatalog(connections);
    let release!: (value: never) => void;
    vi.mocked(connection.adapter.request).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = acquireRuntimeCapabilityCatalog(connections);
    const finish = await first.prepareToolCall('server_1mcp_echo', {});
    await expect(finish({ content: [] })).resolves.toBeUndefined();
    expect(() => finish.assertCurrent()).not.toThrow();
    release({ tools: [{ ...tool('echo'), inputSchema: { type: 'object', required: ['new'] } }] } as never);
    await pending;
    expect(() => finish.assertCurrent()).toThrow('schema_invalid');
    await expect(finish({ content: [] })).resolves.toBeUndefined();
    await expect(first.prepareToolCall('server_1mcp_echo', {})).rejects.toThrow('schema_invalid');
  });

  it('keeps immutable internal contracts callable across concurrent same-scope acquisitions', async () => {
    const connections = new Map();
    const internalTools = [
      {
        name: 'internal',
        inputSchema: { type: 'object', required: ['value'] },
        outputSchema: { type: 'object', required: ['ok'] },
      },
    ];
    const snapshots = await Promise.all(
      Array.from({ length: 3 }, () => acquireRuntimeCapabilityCatalog(connections, undefined, { internalTools })),
    );
    for (const snapshot of snapshots) {
      const finish = await snapshot.prepareToolCall('1mcp_1mcp_internal', { value: 1 });
      await expect(finish({ content: [], structuredContent: { ok: true } })).resolves.toBeUndefined();
      await expect(snapshot.prepareToolCall('1mcp_1mcp_internal', {})).rejects.toThrow('schema_input_invalid');
      await expect(finish({ content: [], structuredContent: {} })).rejects.toThrow('schema_output_invalid');
    }
  });

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
    // A session-scoped template instance keeps its catalog scope private to the session.
    const connections = new Map([['server:instance', connection]]);
    const visibility = createCapabilityVisibility([['server:instance', 'server']], 'closed');
    const first = await acquireRuntimeCapabilityCatalog(connections, visibility);
    const extra = await acquireRuntimeCapabilityCatalog(connections, visibility, { internalResources: [] });
    const other = await acquireRuntimeCapabilityCatalog(
      connections,
      createCapabilityVisibility([['server:instance', 'server']], 'other'),
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
    expect(snapshot.resolve('resourceTemplates', buildPublicResourceTemplate('server', 'file:///{id}'))).toBeDefined();
  });

  it('treats an unimplemented resource template listing as no templates', async () => {
    const connection = fixture('server', (method) => {
      if (method === 'resources/templates/list')
        throw new OneMcpProtocolError(ErrorCode.MethodNotFound, 'Method not found');
      if (method === 'resources/list') return { resources: [{ name: 'r', uri: 'file:///one' }] };
      return { tools: [tool('echo')] };
    });
    connection.capabilities = { tools: {}, resources: {} };
    const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['server', connection]]));

    const templates = await snapshot.list('resourceTemplates', { enablePagination: false });
    expect(templates).toEqual({ items: [] });
    expect(snapshot.hasFailedSources('resourceTemplates')).toBe(false);
  });

  it('still reports other resource template listing failures as partial', async () => {
    const connection = fixture('server', (method) => {
      if (method === 'resources/templates/list') throw new OneMcpProtocolError(ErrorCode.InternalError, 'boom');
      if (method === 'resources/list') return { resources: [] };
      return { tools: [tool('echo')] };
    });
    connection.capabilities = { tools: {}, resources: {} };
    const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['server', connection]]));

    expect(snapshot.hasFailedSources('resourceTemplates')).toBe(true);
    expect(snapshot.hasFailedSources('tools')).toBe(false);
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
      const connections = new Map([['server:instance', fixture()]]);
      const visibility = (sessionId: string) => createCapabilityVisibility([['server:instance', 'server']], sessionId);
      const original = await acquireRuntimeCapabilityCatalog(connections, visibility('session-0'));
      for (let index = 1; index < 256; index++)
        await acquireRuntimeCapabilityCatalog(connections, visibility(`session-${index}`));
      await expect(acquireRuntimeCapabilityCatalog(connections, visibility('overflow'))).rejects.toThrow('capacity');
      vi.advanceTimersByTime(15 * 60 * 1000);
      await expect(acquireRuntimeCapabilityCatalog(connections, visibility('recovered'))).resolves.toBeDefined();
      expect(original.isCurrent()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes a static-server cursor from a fresh stateless session after the first one closes', async () => {
    const connections = new Map([
      ['a', fixture('a')],
      ['b', fixture('b')],
    ]);
    const visibility = (sessionId: string) =>
      createCapabilityVisibility(
        [
          ['a', 'a'],
          ['b', 'b'],
        ],
        sessionId,
      );
    const first = await acquireRuntimeCapabilityCatalog(connections, visibility('request-1'));
    const page = await first.list<{ name: string }>('tools', { enablePagination: true });
    evictRuntimeCapabilityCatalogSession(connections, 'request-1');

    const resumed = await acquireRuntimeCapabilityCatalog(connections, visibility('request-2'), {
      continuation: { kind: 'tools', cursor: page.nextCursor!, enablePagination: true },
    });
    const last = await resumed.list<{ name: string }>('tools', { cursor: page.nextCursor, enablePagination: true });

    expect(page.items.map((item) => item.name)).toEqual(['a_1mcp_echo']);
    expect(last.items.map((item) => item.name)).toEqual(['b_1mcp_echo']);
  });

  it('keeps unlisted resource routes private to the session that received them', async () => {
    const connection = fixture('server');
    const connections = new Map([['server', connection]]);
    const visibility = (sessionId: string) => createCapabilityVisibility([['server', 'server']], sessionId);
    const owner = await acquireRuntimeCapabilityCatalog(connections, visibility('owner'));
    const identity = owner.projectUnlistedResource('server', 'file:///hidden');
    const other = await acquireRuntimeCapabilityCatalog(connections, visibility('other'));

    expect(owner.resolve('resources', identity)).toBeDefined();
    expect(other.resolve('resources', identity)).toBeUndefined();
    expect(other.projectUnlistedResource('server', 'file:///hidden')).not.toBe(identity);
    evictRuntimeCapabilityCatalogSession(connections, 'owner');
    expect(owner.resolve('resources', identity)).toBeUndefined();
  });

  it('retains a trusted resource owner across bridge closure without sharing aliases with other owners or runtimes', async () => {
    const connection = fixture('server');
    const connections = new Map([['server', connection]]);
    const owner = createResourceRouteOwner();
    const visibility = (session: string, currentOwner = owner) =>
      createCapabilityVisibility([['server', 'server']], session, { tags: ['safe'] }, currentOwner);
    const first = await acquireRuntimeCapabilityCatalog(connections, visibility('private-first'));
    const uri = first.projectUnlistedResource('server', 'custom:///unlisted%2f?q=one#part');
    evictRuntimeCapabilityCatalogSession(connections, 'private-first');
    const second = await acquireRuntimeCapabilityCatalog(connections, visibility('private-second'));
    expect(second.resolve('resources', uri)?.entry.route.upstreamIdentity).toBe('custom:///unlisted%2f?q=one#part');
    expect(second.projectUnlistedResource('server', 'custom:///unlisted%2f?q=one#part')).toBe(uri);
    const other = await acquireRuntimeCapabilityCatalog(connections, visibility('other', createResourceRouteOwner()));
    const filtered = await acquireRuntimeCapabilityCatalog(
      connections,
      createCapabilityVisibility([['server', 'server']], 'filtered', { tags: ['different'] }, owner),
    );
    const foreign = await acquireRuntimeCapabilityCatalog(new Map(connections), visibility('foreign'));
    const requestsBeforeLookup = vi.mocked(connection.adapter.request).mock.calls.length;
    expect(other.resolve('resources', uri)).toBeUndefined();
    expect(filtered.resolve('resources', uri)).toBeUndefined();
    expect(foreign.resolve('resources', uri)).toBeUndefined();
    expect(second.resolve('resources', 'urn:1mcp:resource:guessed')).toBeUndefined();
    expect(connection.adapter.request).toHaveBeenCalledTimes(requestsBeforeLookup);
    revokeResourceRouteOwner(owner);
    pruneRuntimeResourceRoutes(connections);
    expect(second.resolve('resources', uri)).toBeUndefined();
    expect(() => second.projectUnlistedResource('server', 'file:///new')).toThrow('owner is unavailable');
  });

  it('expires handles at issuance time even when shared catalog access keeps the scope alive', async () => {
    vi.useFakeTimers();
    try {
      const connections = new Map([['server', fixture('server')]]);
      const owner = createResourceRouteOwner();
      const visibility = createCapabilityVisibility([['server', 'server']], 'private', undefined, owner);
      const first = await acquireRuntimeCapabilityCatalog(connections, visibility);
      const uri = first.projectUnlistedResource('server', 'file:///hidden');
      vi.advanceTimersByTime(RUNTIME_CATALOG_SCOPE_TTL_MS - 1);
      const refreshed = await acquireRuntimeCapabilityCatalog(connections, visibility);
      expect(refreshed.resolve('resources', uri)).toBeDefined();
      vi.advanceTimersByTime(1);
      expect(refreshed.resolve('resources', uri)).toBeUndefined();
      expect(refreshed.projectUnlistedResource('server', 'file:///hidden')).not.toBe(uri);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['backend', 'adapter'] as const)('invalidates handles after %s replacement', async (replacement) => {
    const connection = fixture('server');
    const connections = new Map([['server', connection]]);
    const visibility = createCapabilityVisibility(
      [['server', 'server']],
      'private',
      undefined,
      createResourceRouteOwner(),
    );
    const first = await acquireRuntimeCapabilityCatalog(connections, visibility);
    const uri = first.projectUnlistedResource('server', 'file:///hidden');
    if (replacement === 'backend') connections.set('server', fixture('server'));
    else Object.defineProperty(connection, 'adapter', { value: fixture('server').adapter });
    const second = await acquireRuntimeCapabilityCatalog(connections, visibility);
    expect(second.resolve('resources', uri)).toBeUndefined();
  });

  it('bounds handle retention and reclaims expired capacity in a live scope', async () => {
    vi.useFakeTimers();
    try {
      const connections = new Map([['server', fixture('server')]]);
      const visibility = createCapabilityVisibility(
        [['server', 'server']],
        'private',
        undefined,
        createResourceRouteOwner(),
      );
      const first = await acquireRuntimeCapabilityCatalog(connections, visibility);
      for (let index = 0; index < 1000; index++) first.projectUnlistedResource('server', `file:///hidden-${index}`);
      expect(() => first.projectUnlistedResource('server', 'file:///overflow')).toThrow('capacity');
      vi.advanceTimersByTime(RUNTIME_CATALOG_SCOPE_TTL_MS - 1);
      const refreshed = await acquireRuntimeCapabilityCatalog(connections, visibility);
      vi.advanceTimersByTime(1);
      expect(() => refreshed.projectUnlistedResource('server', 'file:///recovered')).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['resources', 'resourceTemplates'] as const)(
    'invalidates a handle at the provider %s epoch and removes its observer on revocation',
    async (kind) => {
      const connection = fixture('server');
      const connections = new Map([['server', connection]]);
      const owner = createResourceRouteOwner();
      const visibility = createCapabilityVisibility([['server', 'server']], 'private', undefined, owner);
      const registration = vi.spyOn(pagination, 'registerCapabilityPaginationNotifications');
      const unregister = vi.spyOn(pagination, 'unregisterCapabilityPaginationConnections');
      try {
        const snapshot = await acquireRuntimeCapabilityCatalog(connections, visibility);
        const uri = snapshot.projectUnlistedResource('server', 'file:///hidden');
        const source = registration.mock.calls.find(([, provider]) => provider === connection)?.[0];
        expect(source).toBeDefined();
        pagination.advanceCapabilityPaginationGeneration(source!, kind);
        expect(snapshot.resolve('resources', uri)).toBeUndefined();
        snapshot.projectUnlistedResource('server', 'file:///new');
        const currentSource = registration.mock.calls.at(-1)?.[0];
        unregister.mockClear();
        revokeResourceRouteOwner(owner);
        pruneRuntimeResourceRoutes(connections);
        expect(unregister).toHaveBeenCalledWith(currentSource);
      } finally {
        registration.mockRestore();
        unregister.mockRestore();
      }
    },
  );

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

  it.each([true, false])(
    'retains healthy internal tools after an upstream cursor loop with pagination=%s',
    async (enablePagination) => {
      const connection = fixture('a', (_method, params) => ({
        tools: [tool((params as { cursor?: string })?.cursor === undefined ? 'z' : 'a')],
        nextCursor: 'loop',
      }));
      const snapshot = await acquireRuntimeCapabilityCatalog(new Map([['a', connection]]), undefined, {
        unprefixedTools: [{ name: 'tool_list', inputSchema: { type: 'object' } }],
      });
      const names: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const result = await snapshot.list<{ name: string }>('tools', { enablePagination, cursor });
        names.push(...result.items.map((item) => item.name));
        expect(result._meta).toMatchObject({
          'app.1mcp/capability-pagination': { partial: true, failedSourceCount: 1 },
        });
        cursor = result.nextCursor;
        expect(++pages).toBeLessThanOrEqual(3);
      } while (cursor !== undefined);
      expect(names).toEqual(['a_1mcp_a', 'a_1mcp_z', 'tool_list']);
      expect(connection.adapter.request).toHaveBeenCalledTimes(2);
    },
  );

  it('bounds concurrent acquisitions of one scope and releases admission after completion', async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const connection = fixture('server', () => pending);
    const connections = new Map([['server', connection]]);
    // An early rejection must also release admission.
    await expect(
      acquireRuntimeCapabilityCatalog(connections, undefined, {
        serverConfigs: { bad: { unsupported: () => {} } } as never,
      }),
    ).rejects.toThrow();
    const acquisitions = Array.from({ length: 256 }, () => acquireRuntimeCapabilityCatalog(connections));
    try {
      await expect(acquireRuntimeCapabilityCatalog(connections)).rejects.toBeInstanceOf(CapabilityCursorCapacityError);
      expect(connection.adapter.request).toHaveBeenCalledTimes(256);
    } finally {
      finish({ tools: [] });
      await Promise.all(acquisitions);
    }
    await expect(acquireRuntimeCapabilityCatalog(connections)).resolves.toBeDefined();
  });
});
