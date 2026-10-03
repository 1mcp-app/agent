import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import * as toolSchemaBoundary from '@src/core/validation/toolSchemaBoundary.js';
import { executeWithPostAuthOAuthRecovery } from '@src/core/client/postAuthOAuthRecovery.js';
import type { TemplateHashProvider } from '@src/core/server/connectionResolver.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/client.js';
import { SchemaBoundaryError } from '@src/core/validation/schemaBoundary.js';
import { OneMcpProtocolError, type Tool } from '@src/sdk/contracts/index.js';

import { CapabilityCatalog } from './capabilityCatalog.js';
import {
  advanceCapabilityPaginationGeneration,
  CAPABILITY_PAGINATION_META_KEY,
  setCapabilityFailureFacts,
} from './capabilityPagination.js';
import { capabilityVisibilityFromServerNames, createCapabilityVisibility } from './capabilityVisibility.js';
import { buildCatalogGeneration } from './catalogGeneration.js';
import { SchemaCache } from './schemaCache.js';
import { ToolRegistry } from './toolRegistry.js';

describe('CapabilityCatalog', () => {
  let registry: ToolRegistry;
  let schemaCache: SchemaCache;
  let outboundConnections: OutboundConnections;
  let mockClient: { callTool: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const toolsByServer = new Map<string, Tool[]>([
      [
        'filesystem',
        [
          {
            name: 'read_file',
            description: 'Read file',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
            outputSchema: { type: 'object', properties: { content: { type: 'string' } } },
            annotations: { readOnlyHint: true },
          },
          { name: 'write_file', description: 'Write file', inputSchema: { type: 'object' } },
        ],
      ],
      ['template-server', [{ name: 'template_tool', description: 'Template tool', inputSchema: { type: 'object' } }]],
    ]);
    const tagsByServer = new Map<string, string[]>([
      ['filesystem', ['fs']],
      ['template-server', ['project']],
    ]);

    registry = ToolRegistry.fromGeneration(
      buildCatalogGeneration(
        1,
        Array.from(toolsByServer).flatMap(([server, tools]) =>
          tools.map((object) => ({
            kind: 'tools',
            object,
            server,
            connectionKey: server === 'template-server' ? 'template-server:rendered123' : server,
          })),
        ),
      ),
      new Map(
        Array.from(tagsByServer).map(([server, tags]) => [
          server === 'template-server' ? 'template-server:rendered123' : server,
          tags,
        ]),
      ),
    );
    schemaCache = new SchemaCache({ maxEntries: 100 });
    mockClient = {
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    };

    const connection = (name: string) => {
      let outbound: ReturnType<typeof createMockOutboundConnection>;
      outbound = createMockOutboundConnection({
        name,
        adapter: {
          request: vi.fn(async ({ method, params }) => {
            if (method === 'tools/call') {
              const callTool = mockClient.callTool as unknown as (input: unknown) => Promise<never>;
              return executeWithPostAuthOAuthRecovery(name, outbound, () => callTool(params));
            }
            return {};
          }),
        },
      });
      return outbound;
    };
    outboundConnections = new Map([
      ['filesystem', connection('filesystem')],
      ['template-server:rendered123', connection('template-server')],
    ]);
    registry = registry.withConnections(outboundConnections);
  });

  function createCatalog(templateHashProvider?: TemplateHashProvider, overrides: Record<string, unknown> = {}) {
    return new CapabilityCatalog({
      getToolRegistry: () => registry,
      schemaCache,
      outboundConnections,
      getServerConfigs: () => ({
        filesystem: {
          type: 'stdio',
          command: 'node',
          disabledTools: ['write_file'],
          toolDescriptionOverrides: {
            read_file: 'Read a workspace file safely',
            write_file: 'Hidden override',
          },
        } as any,
        'template-server': {
          type: 'stdio',
          command: 'node',
          toolDescriptionOverrides: { template_tool: 'Describe a rendered project' },
        } as any,
      }),
      templateHashProvider,
      ...overrides,
    } as any);
  }

  afterEach(() => vi.restoreAllMocks());

  it('keeps per-visibility snapshot count capacity available to another caller', async () => {
    registry = ToolRegistry.fromToolsWithServer([
      { server: 'filesystem', tool: { name: 'one', inputSchema: { type: 'object' } } },
      { server: 'filesystem', tool: { name: 'two', inputSchema: { type: 'object' } } },
    ]);
    const catalog = createCatalog();
    const firstVisibility = createCapabilityVisibility([['filesystem', 'filesystem']], 'first-client');
    const secondVisibility = createCapabilityVisibility([['filesystem', 'filesystem']], 'second-client');
    const first = await catalog.listVisibleTools({ limit: 1 }, firstVisibility);
    for (let index = 1; index < 250; index += 1) {
      await catalog.listVisibleTools({ limit: 1 }, firstVisibility);
    }
    await expect(catalog.listVisibleTools({ limit: 1 }, firstVisibility)).rejects.toThrow(
      'Capability cursor capacity exceeded',
    );
    const other = await catalog.listVisibleTools({ limit: 1 }, secondVisibility);
    expect(other.nextCursor).toBeDefined();
    const continued = await catalog.listVisibleTools({ limit: 1, cursor: first.nextCursor }, firstVisibility);
    expect(continued.tools).toHaveLength(1);
    expect(continued.hasMore).toBe(false);
  });

  it('keeps per-visibility snapshot bytes available to another caller', async () => {
    registry = ToolRegistry.fromToolsWithServer(
      Array.from({ length: 15 }, (_, index) => ({
        server: 'filesystem',
        tool: { name: `large_${index}`, description: 'x'.repeat(180_000), inputSchema: { type: 'object' as const } },
      })),
    );
    const catalog = createCatalog();
    const firstVisibility = createCapabilityVisibility([['filesystem', 'filesystem']], 'first-client');
    const secondVisibility = createCapabilityVisibility([['filesystem', 'filesystem']], 'second-client');
    await catalog.listVisibleTools({ limit: 1 }, firstVisibility);
    await expect(catalog.listVisibleTools({ limit: 1 }, firstVisibility)).rejects.toThrow(
      'Capability cursor capacity exceeded',
    );
    expect((await catalog.listVisibleTools({ limit: 1 }, secondVisibility)).nextCursor).toBeDefined();
  });

  it('releases timeout references for removed connections and replaced registries', async () => {
    vi.spyOn(toolSchemaBoundary, 'admitToolSchemas').mockRejectedValue(
      new SchemaBoundaryError('schema_evaluation_timeout', true),
    );
    const catalog = createCatalog();
    const outcomes = (catalog as unknown as { withheldTools: Map<string, unknown> }).withheldTools;
    await catalog.listVisibleTools({});
    expect(outcomes.size).toBe(2);
    outboundConnections.delete('filesystem');
    await catalog.describeVisibleTool({ server: 'filesystem', toolName: 'read_file' });
    expect(outcomes.has(JSON.stringify(['filesystem', 'read_file']))).toBe(false);
    expect(outcomes.size).toBe(1);
    registry = ToolRegistry.empty();
    await catalog.listVisibleTools({});
    expect(outcomes.size).toBe(0);
  });

  it('does not retain admission outcome references after an ordinary successful listing', async () => {
    const catalog = createCatalog();
    await catalog.listVisibleTools({});
    const state = (
      catalog as unknown as {
        listingState: { withheldTools: Map<string, unknown>; activeAttempts: Set<number> };
      }
    ).listingState;
    expect(state.withheldTools.size).toBe(0);
    expect(state.activeAttempts.size).toBe(0);
  });

  it('keeps a partial tool walk stable and retries admission on a fresh first page', async () => {
    registry = ToolRegistry.fromToolsWithServer([
      ...registry
        .getAllTools()
        .map((tool) => ({ tool: tool.definition!, server: tool.server, connectionKey: tool.connectionKey })),
      { tool: { name: 'extra', inputSchema: { type: 'object' } }, server: 'filesystem' },
    ]).withConnections(outboundConnections);
    const originalAdmission = toolSchemaBoundary.admitToolSchemas;
    let fail = true;
    const admission = vi.spyOn(toolSchemaBoundary, 'admitToolSchemas').mockImplementation(async (tool, binding) => {
      if (fail && tool.name === 'template_tool') throw new SchemaBoundaryError('schema_evaluation_timeout', true);
      return originalAdmission(tool, binding);
    });
    const catalog = createCatalog();
    const first = await catalog.listVisibleTools({ limit: 1 });
    expect(first._meta?.[CAPABILITY_PAGINATION_META_KEY]).toMatchObject({
      partial: true,
      complete: false,
      failureCategories: { upstream_tool_admission_timeout: 1 },
      recovery: 'restart-walk',
    });
    expect(first.hasMore).toBe(true);
    const withheld = await catalog.invokeVisibleTool({
      server: 'template-server',
      toolName: 'template_tool',
      args: {},
    });
    expect(withheld.error?.type).toBe('not_found');
    expect(mockClient.callTool).not.toHaveBeenCalled();

    fail = false;
    const refreshed = await catalog.listVisibleTools({});
    expect(refreshed.tools.map((tool) => tool.name)).toContain('template_tool');
    expect(refreshed._meta).toBeUndefined();
    const admissionCalls = admission.mock.calls.length;
    const last = await catalog.listVisibleTools({ limit: 1, cursor: first.nextCursor });
    expect(last._meta).toEqual(first._meta);
    expect(last.tools.map((tool) => tool.name)).not.toContain('template_tool');
    expect(last.hasMore).toBe(false);
    expect(admission).toHaveBeenCalledTimes(admissionCalls);
  });

  it('allows an explicit partial empty listing when all upstream admissions time out', async () => {
    vi.spyOn(toolSchemaBoundary, 'admitToolSchemas').mockRejectedValue(
      new SchemaBoundaryError('schema_evaluation_timeout', true),
    );
    const result = await createCatalog().listVisibleTools({});
    expect(result.tools).toEqual([]);
    expect(result._meta?.[CAPABILITY_PAGINATION_META_KEY]).toMatchObject({
      partial: true,
      failedSourceCount: 2,
      failureCategories: { upstream_tool_admission_timeout: 2 },
    });
  });

  it.each([
    ['schema_evaluation_unavailable', 'admission'],
    ['schema_evaluation_timeout', 'input'],
  ] as const)('fails listing for shared or non-admission failures: %s/%s', async (code, phase) => {
    vi.spyOn(toolSchemaBoundary, 'admitToolSchemas').mockRejectedValue(new SchemaBoundaryError(code, true, phase));
    await expect(createCatalog().listVisibleTools({})).rejects.toThrow(code);
  });

  it('fails an admission timeout without an upstream connection', async () => {
    outboundConnections.clear();
    vi.spyOn(toolSchemaBoundary, 'admitToolSchemas').mockRejectedValue(
      new SchemaBoundaryError('schema_evaluation_timeout', true),
    );
    await expect(createCatalog().listVisibleTools({})).rejects.toThrow('schema_evaluation_timeout');
  });

  it('withholds every timed-out tool while counting distinct failed sources', async () => {
    registry = ToolRegistry.fromToolsWithServer([
      { server: 'filesystem', tool: { name: 'one', inputSchema: { type: 'object' } } },
      { server: 'filesystem', tool: { name: 'two', inputSchema: { type: 'object' } } },
    ]);
    vi.spyOn(toolSchemaBoundary, 'admitToolSchemas').mockRejectedValue(
      new SchemaBoundaryError('schema_evaluation_timeout', true),
    );
    const result = await createCatalog().listVisibleTools({});
    expect(result._meta?.[CAPABILITY_PAGINATION_META_KEY]).toMatchObject({
      failedSourceCount: 1,
      failureCategories: { upstream_tool_admission_timeout: 2 },
    });
  });

  it('does not let an older timeout overwrite a newer successful admission', async () => {
    registry = ToolRegistry.fromToolsWithServer([
      { server: 'filesystem', tool: { name: 'unstable', inputSchema: { type: 'object' } } },
    ]);
    const originalAdmission = toolSchemaBoundary.admitToolSchemas;
    let release: (error: unknown) => void = () => {};
    let began: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    let first = true;
    vi.spyOn(toolSchemaBoundary, 'admitToolSchemas').mockImplementation(async (tool, binding) => {
      if (first) {
        first = false;
        began();
        return new Promise((_, reject) => {
          release = reject;
        });
      }
      return originalAdmission(tool, binding);
    });
    const catalog = createCatalog();
    const old = catalog.listVisibleTools({});
    await started;
    await catalog.listVisibleTools({});
    const outcomes = (catalog as unknown as { withheldTools: Map<string, unknown> }).withheldTools;
    expect(outcomes.get(JSON.stringify(['filesystem', 'unstable']))).toEqual({ attempt: 2, withheld: false });
    release(new SchemaBoundaryError('schema_evaluation_timeout', true));
    await old;
    expect(outcomes.size).toBe(0);
    const invoked = await catalog.invokeVisibleTool({ server: 'filesystem', toolName: 'unstable', args: {} });
    expect(invoked.error).toBeUndefined();
    expect(mockClient.callTool).toHaveBeenCalledOnce();
  });

  it('rejects publication when a fallback backend is replaced during admission', async () => {
    const originalAdmission = toolSchemaBoundary.admitToolSchemas;
    let release: () => void = () => {};
    let began: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    vi.spyOn(toolSchemaBoundary, 'admitToolSchemas').mockImplementation(async (tool, binding) => {
      if (first) {
        first = false;
        began();
        await held;
      }
      return originalAdmission(tool, binding);
    });
    const listing = createCatalog().listVisibleTools({});
    await started;
    outboundConnections.set('filesystem', createMockOutboundConnection({ name: 'filesystem' }));
    release();
    await expect(listing).rejects.toMatchObject({
      message: 'Capability catalog changed during listing',
      code: -32000,
      data: { retryable: true },
    });
  });

  it('allows invocation after an existing refresh installs a successfully admitted registry', async () => {
    const definition: Tool = { name: 'unstable', inputSchema: { type: 'object' } };
    registry = ToolRegistry.fromToolsWithServer([{ server: 'filesystem', tool: definition }]);
    const originalAdmission = toolSchemaBoundary.admitToolSchemas;
    let fail = true;
    vi.spyOn(toolSchemaBoundary, 'admitToolSchemas').mockImplementation(async (tool, binding) => {
      if (fail) throw new SchemaBoundaryError('schema_evaluation_timeout', true);
      return originalAdmission(tool, binding);
    });
    const refreshCapabilities = vi.fn(async () => {
      await originalAdmission(definition as unknown as Record<string, unknown>, {
        routeKey: 'refresh',
        generation: 'one',
      });
      registry = ToolRegistry.fromToolsWithServer([{ server: 'filesystem', tool: definition }]);
    });
    const catalog = createCatalog(undefined, { refreshCapabilities });
    await catalog.listVisibleTools({});
    expect(
      (await catalog.invokeVisibleTool({ server: 'filesystem', toolName: 'unstable', args: {} })).error?.type,
    ).toBe('not_found');
    fail = false;
    const result = await catalog.invokeVisibleTool(
      { server: 'filesystem', toolName: 'unstable', args: {} },
      undefined,
      { refreshIntent: 'force' },
    );
    expect(result.error).toBeUndefined();
    expect(refreshCapabilities).toHaveBeenCalledOnce();
    expect(mockClient.callTool).toHaveBeenCalledOnce();
  });

  it('rejects a continuation after a pending tool becomes disabled', async () => {
    const configs = { filesystem: { type: 'stdio', command: 'node', disabledTools: [] as string[] } };
    const catalog = createCatalog(undefined, { getServerConfigs: () => configs });
    const first = await catalog.listVisibleTools({ limit: 1 });
    configs.filesystem.disabledTools.push('write_file');
    await expect(catalog.listVisibleTools({ cursor: first.nextCursor })).rejects.toThrow(
      'Invalid capability pagination cursor',
    );
  });

  it('rejects a continuation after its upstream connection is replaced', async () => {
    const catalog = createCatalog();
    const first = await catalog.listVisibleTools({ limit: 1 });
    outboundConnections.set('filesystem', createMockOutboundConnection({ name: 'filesystem' }));
    await expect(catalog.listVisibleTools({ cursor: first.nextCursor })).rejects.toThrow(
      'Invalid capability pagination cursor',
    );
  });

  it('scopes private failure facts to visible connections, including failed sources without tools', async () => {
    const meta = setCapabilityFailureFacts(
      {
        [CAPABILITY_PAGINATION_META_KEY]: {
          partial: true,
          complete: false,
          failedSourceCount: 1,
          failureCategories: { upstream_tool_admission_timeout: 2 },
        },
      },
      new Map([['template-server:rendered123', { upstream_tool_admission_timeout: 2 }]]),
    );
    registry = registry.withListingMeta(meta);
    const healthy = await createCatalog().listVisibleTools({}, capabilityVisibilityFromServerNames(['filesystem']));
    expect(healthy._meta).toBeUndefined();
    registry = ToolRegistry.empty().withListingMeta(meta);
    const failed = await createCatalog().listVisibleTools(
      {},
      createCapabilityVisibility([['template-server:rendered123', 'template-server']]),
    );
    expect(failed._meta?.[CAPABILITY_PAGINATION_META_KEY]).toMatchObject({ failedSourceCount: 1 });
  });

  it('keeps a tool listing snapshot across request-local catalog instances', async () => {
    const first = await createCatalog().listVisibleTools({ limit: 1 });
    const last = await createCatalog().listVisibleTools({ limit: 1, cursor: first.nextCursor });
    expect(last.tools).toHaveLength(1);
    expect(last.tools[0].name).not.toBe(first.tools[0].name);
    expect(last.hasMore).toBe(false);
  });

  it('invalidates a retained meta-tool walk after a tools generation change', async () => {
    const catalog = createCatalog();
    const first = await catalog.listVisibleTools({ limit: 1 });
    advanceCapabilityPaginationGeneration(outboundConnections, 'tools');
    await expect(catalog.listVisibleTools({ cursor: first.nextCursor })).rejects.toThrow(
      'Invalid capability pagination cursor',
    );
  });

  it('preserves aggregate partial metadata through visibility filtering', async () => {
    const meta = { [CAPABILITY_PAGINATION_META_KEY]: { partial: true, complete: false, recovery: 'restart-walk' } };
    registry = registry.withListingMeta(meta);
    const result = await createCatalog().listVisibleTools({}, capabilityVisibilityFromServerNames(['filesystem']));
    expect(result._meta).toEqual(meta);
    expect(result.tools.map((tool) => tool.name)).toEqual(['read_file']);
  });

  it('lists visible tools with disabled tools omitted and clean public server names', async () => {
    const result = await createCatalog().listVisibleTools({});

    expect(result.tools.map((tool) => `${tool.server}/${tool.name}`).sort()).toEqual([
      'filesystem/read_file',
      'template-server/template_tool',
    ]);
    expect(result.tools.find((tool) => tool.name === 'read_file')?.inputSchema).toMatchObject({
      type: 'object',
      properties: { path: { type: 'string' } },
    });
    expect(result.routes.map((route) => route.connectionKey).sort()).toEqual([
      'filesystem',
      'template-server:rendered123',
    ]);
    expect(result.servers).toEqual(['filesystem', 'template-server']);
  });

  it('uses effective descriptions consistently for listing and full-schema inspection', async () => {
    const upstreamSchema: Tool = {
      name: 'read_file',
      description: 'Upstream description',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { content: { type: 'string' } } },
      annotations: { readOnlyHint: true },
    };
    const loadSchema = vi.fn(async () => ({ ...upstreamSchema, description: 'Later upstream mutation' }));
    const catalog = createCatalog(undefined, { loadSchema });

    const listed = await catalog.listVisibleTools({});
    const described = await catalog.describeVisibleTool({ server: 'filesystem', toolName: 'read_file' });

    expect(listed.tools.find((tool) => tool.name === 'read_file')?.description).toBe('Read a workspace file safely');
    expect(listed.tools.find((tool) => tool.name === 'template_tool')?.description).toBe('Describe a rendered project');
    expect(described.schema).toMatchObject({
      ...upstreamSchema,
      description: 'Read a workspace file safely',
    });
    expect(loadSchema).not.toHaveBeenCalled();
  });

  it('maps external capability items for non-tool kinds', async () => {
    const mapItem = vi.fn((item: { name: string }, serverName: string) => ({
      ...item,
      name: `${serverName}:${item.name}`,
    }));

    const result = await createCatalog().listVisibleCapabilityPages({
      kind: 'resources',
      visibility: createCapabilityVisibility([['filesystem', 'filesystem']]),
      enablePagination: true,
      list: async () => ({ items: [{ name: 'readme' }] }),
      mapItem,
    });

    expect(result.items).toEqual([{ name: 'filesystem:readme' }]);
    expect(mapItem).toHaveBeenCalledWith({ name: 'readme' }, 'filesystem');
  });

  it('accepts a cursor when visibility candidates are rebuilt in a different insertion order', async () => {
    const catalog = createCatalog();
    const list = vi.fn(async (_connection: unknown, cursor: string | undefined, serverName: string) => ({
      items: [{ name: `${serverName}:${cursor ? 'second' : 'first'}` }],
      nextCursor: cursor ? undefined : `${serverName}-next`,
    }));
    const firstVisibility = createCapabilityVisibility([
      ['filesystem', 'filesystem'],
      ['template-server:rendered123', 'template-server'],
    ]);
    const rebuiltVisibility = createCapabilityVisibility([
      ['template-server:rendered123', 'template-server'],
      ['filesystem', 'filesystem'],
    ]);
    const first = await catalog.listVisibleCapabilityPages({
      kind: 'resources',
      visibility: firstVisibility,
      enablePagination: true,
      list,
    });

    const second = await catalog.listVisibleCapabilityPages({
      kind: 'resources',
      visibility: rebuiltVisibility,
      cursor: first.nextCursor,
      enablePagination: true,
      list,
    });

    expect(second.items).toEqual([{ name: 'filesystem:second' }]);
    expect(list.mock.calls.map(([, cursor, serverName]) => [serverName, cursor])).toEqual([
      ['filesystem', undefined],
      ['filesystem', 'filesystem-next'],
    ]);
  });

  it('rejects schema access to a disabled tool through visibility', async () => {
    const result = await createCatalog().describeVisibleTool({ server: 'filesystem', toolName: 'write_file' });

    expect(result.error).toMatchObject({
      type: 'not_found',
      message: expect.stringContaining('Tool is disabled'),
    });
  });

  it('uses internal capability route keys while keeping invoke output public', async () => {
    const result = await createCatalog({
      getRenderedHashForSession: (sessionId, templateName) =>
        sessionId === 'session-1' && templateName === 'template-server' ? 'rendered123' : undefined,
      getAllRenderedHashesForSession: () => undefined,
    }).invokeVisibleTool(
      { server: 'template-server', toolName: 'template_tool', args: { message: 'hi' } },
      createCapabilityVisibility([['template-server:rendered123', 'template-server']], 'session-1'),
    );

    expect(result.error).toBeUndefined();
    expect(result.server).toBe('template-server');
    expect(result.tool).toBe('template_tool');
    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'template_tool',
      arguments: { message: 'hi' },
    });
  });

  it('recovers OAuth when a lazy direct tool invocation gets a terminal post-authentication 401', async () => {
    const unauthorized = new OneMcpProtocolError(401, 'Server returned 401 after successful authentication');
    const connection = outboundConnections.get('filesystem')!;
    mockClient.callTool.mockRejectedValue(unauthorized);

    const result = await createCatalog().invokeVisibleTool({
      server: 'filesystem',
      toolName: 'read_file',
      args: { path: '/tmp/example' },
    });

    expect(result.error?.type).toBe('upstream');
    expect(connection.status).toBe(ClientStatus.AwaitingOAuth);
    expect(connection.lastError).toEqual({ name: 'OneMcpProtocolError', message: unauthorized.message });
    expect(connection.adapter.close).toHaveBeenCalledOnce();
  });

  it('does not fall back to another template instance when a request session has no mapping', async () => {
    const result = await createCatalog({
      getRenderedHashForSession: () => undefined,
      getAllRenderedHashesForSession: () => undefined,
    }).invokeVisibleTool(
      { server: 'template-server', toolName: 'template_tool', args: { message: 'hi' } },
      createCapabilityVisibility([['template-server:rendered123', 'template-server']], 'missing-session'),
    );

    expect(result.error).toMatchObject({
      type: 'upstream',
      message: 'Server not connected: template-server',
    });
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });

  it('filters capability visibility by Server Candidate Set', async () => {
    const result = await createCatalog().listVisibleTools({}, capabilityVisibilityFromServerNames(['filesystem']));

    expect(result.tools.map((tool) => tool.server)).toEqual(['filesystem']);
    expect(result.routes.map((route) => route.connectionKey)).toEqual(['filesystem']);
  });

  it('excludes disconnected candidates from capability visibility', async () => {
    outboundConnections.get('filesystem')!.status = ClientStatus.Disconnected;

    const result = await createCatalog().listVisibleTools({}, capabilityVisibilityFromServerNames(['filesystem']));

    expect(result.tools).toEqual([]);
    expect(result.routes).toEqual([]);
  });

  it('does not reveal disabled tool details for hidden servers', async () => {
    const result = await createCatalog().describeVisibleTool(
      { server: 'filesystem', toolName: 'write_file' },
      capabilityVisibilityFromServerNames(['template-server']),
    );

    expect(result.error).toMatchObject({
      type: 'not_found',
      message: 'Tool not found: filesystem:write_file. Call tool_list to see available tools.',
    });
  });

  it('refreshes capabilities before listing when force refresh is requested', async () => {
    registry = ToolRegistry.fromToolsMap(new Map(), new Map());
    const refreshCapabilities = vi.fn(async () => {
      registry = ToolRegistry.fromToolsMap(
        new Map([['filesystem', [{ name: 'read_file', description: 'Read file', inputSchema: { type: 'object' } }]]]),
        new Map([['filesystem', ['fs']]]),
      );
      return { changed: true, shouldNotifyListChanged: true };
    });

    const result = await createCatalog(undefined, { refreshCapabilities }).listVisibleTools({}, undefined, {
      refreshIntent: 'force',
    });

    expect(refreshCapabilities).toHaveBeenCalledWith({ intent: 'force', reason: 'list' });
    expect(result.tools.map((tool) => `${tool.server}/${tool.name}`)).toEqual(['filesystem/read_file']);
    expect(result.refresh).toEqual({
      intent: 'force',
      refreshed: true,
      changed: true,
      shouldNotifyListChanged: true,
    });
  });
});
