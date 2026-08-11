import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { TemplateHashProvider } from '@src/core/server/connectionResolver.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/client.js';

import { CapabilityCatalog } from './capabilityCatalog.js';
import { capabilityVisibilityFromServerNames, createCapabilityVisibility } from './capabilityVisibility.js';
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

    registry = ToolRegistry.fromToolsMap(toolsByServer, tagsByServer);
    schemaCache = new SchemaCache({ maxEntries: 100 });
    mockClient = {
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    };

    outboundConnections = new Map([
      [
        'filesystem',
        {
          name: 'filesystem',
          client: mockClient as any,
          status: ClientStatus.Connected,
          transport: {} as any,
        },
      ],
      [
        'template-server:rendered123',
        {
          name: 'template-server',
          client: mockClient as any,
          status: ClientStatus.Connected,
          transport: {} as any,
        },
      ],
    ]);
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

  it('lists visible tools with disabled tools omitted and clean public server names', async () => {
    const result = await createCatalog().listVisibleTools({});

    expect(result.tools.map((tool) => `${tool.server}/${tool.name}`).sort()).toEqual([
      'filesystem/read_file',
      'template-server/template_tool',
    ]);
    expect(result.tools.find((tool) => tool.name === 'read_file')?.inputSchema).toEqual({
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
    const catalog = createCatalog(undefined, {
      loadSchema: vi.fn(async () => upstreamSchema),
    });

    const listed = await catalog.listVisibleTools({});
    const described = await catalog.describeVisibleTool({ server: 'filesystem', toolName: 'read_file' });

    expect(listed.tools.find((tool) => tool.name === 'read_file')?.description).toBe('Read a workspace file safely');
    expect(listed.tools.find((tool) => tool.name === 'template_tool')?.description).toBe('Describe a rendered project');
    expect(described.schema).toEqual({
      ...upstreamSchema,
      description: 'Read a workspace file safely',
    });
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
