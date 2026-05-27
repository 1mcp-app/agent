import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { TemplateHashProvider } from '@src/core/server/connectionResolver.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/client.js';

import { CapabilityCatalog } from './capabilityCatalog.js';
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
          { name: 'read_file', description: 'Read file', inputSchema: { type: 'object' } },
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
    expect(result.routes.map((route) => route.connectionKey).sort()).toEqual([
      'filesystem',
      'template-server:rendered123',
    ]);
    expect(result.servers).toEqual(['filesystem', 'template-server']);
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
      'session-1',
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
      'missing-session',
    );

    expect(result.error).toMatchObject({
      type: 'upstream',
      message: 'Server not connected: template-server',
    });
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });

  it('filters visibility by allowed server set', async () => {
    const result = await createCatalog().listVisibleTools({}, undefined, new Set(['filesystem']));

    expect(result.tools.map((tool) => tool.server)).toEqual(['filesystem']);
    expect(result.routes.map((route) => route.connectionKey)).toEqual(['filesystem']);
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

    const result = await createCatalog(undefined, { refreshCapabilities }).listVisibleTools({}, undefined, undefined, {
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
