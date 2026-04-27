import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import { ClientStatus } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetTransportConfig = vi.fn().mockReturnValue({});
const mockHandlePagination = vi.fn();
const mockParseUri = vi.fn();

vi.mock('@src/config/mcpConfigManager.js', () => ({
  McpConfigManager: {
    getInstance: vi.fn(() => ({
      getTransportConfig: mockGetTransportConfig,
    })),
  },
}));

vi.mock('@src/utils/ui/pagination.js', () => ({
  handlePagination: mockHandlePagination,
}));

vi.mock('@src/utils/core/parsing.js', () => ({
  parseUri: mockParseUri,
  buildUri: vi.fn((serverName: string, toolName: string) => `${serverName}/${toolName}`),
}));

vi.mock('@src/utils/core/errorHandling.js', () => ({
  withErrorHandling: vi.fn((handler) => handler),
}));

vi.mock('@src/core/filtering/clientFiltering.js', () => ({
  byCapabilities: vi.fn(() => (connections: OutboundConnections) => connections),
}));

vi.mock('@src/core/filtering/filteringService.js', () => ({
  FilteringService: {
    getFilteredConnections: vi.fn((connections: OutboundConnections) => connections),
  },
}));

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return {
        getTemplateServerManager: vi.fn(() => undefined),
        executeServerOperation: vi.fn(),
      };
    },
  },
}));

vi.mock('@src/core/capabilities/internalCapabilitiesProvider.js', () => ({
  InternalCapabilitiesProvider: {
    getInstance: vi.fn(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      getAvailableTools: vi.fn().mockReturnValue([]),
      executeTool: vi.fn(),
    })),
  },
}));

describe('requestHandlers disabled tools enforcement', () => {
  let registerRequestHandlers: typeof import('./requestHandlers.js').registerRequestHandlers;
  let mockServer: { setRequestHandler: ReturnType<typeof vi.fn> };
  let mockClient: { callTool: ReturnType<typeof vi.fn>; setRequestHandler: ReturnType<typeof vi.fn> };
  let outboundConnections: OutboundConnections;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetTransportConfig.mockReturnValue({});

    ({ registerRequestHandlers } = await import('./requestHandlers.js'));

    mockServer = {
      setRequestHandler: vi.fn(),
    };

    mockClient = {
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
      setRequestHandler: vi.fn(),
    };

    outboundConnections = new Map<string, OutboundConnection>([
      [
        'filesystem',
        {
          name: 'filesystem',
          status: ClientStatus.Connected,
          client: {
            ...mockClient,
          },
          transport: {
            timeout: 5000,
          },
        } as unknown as OutboundConnection,
      ],
    ]);
  });

  function getRegisteredHandler(schema: unknown): (...args: any[]) => Promise<any> {
    const registration = mockServer.setRequestHandler.mock.calls.find(
      ([registeredSchema]) => registeredSchema === schema,
    );
    if (!registration) {
      throw new Error('Expected handler registration was not found');
    }

    return registration[1];
  }

  it('filters disabled tools from non-lazy listTools responses', async () => {
    mockGetTransportConfig.mockReturnValue({
      filesystem: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['write_file'],
      },
    });

    mockHandlePagination.mockImplementation(
      async (
        filteredConnections: OutboundConnections,
        _params: unknown,
        _listFn: unknown,
        mapResult: (
          connection: OutboundConnection,
          result: { tools?: Array<{ name: string; description: string }> },
        ) => unknown,
      ) => {
        const connection = Array.from(filteredConnections.values())[0];
        return {
          items: mapResult(connection, {
            tools: [
              { name: 'read_file', description: 'Read file' },
              { name: 'write_file', description: 'Write file' },
            ],
          }),
          nextCursor: undefined,
        };
      },
    );

    registerRequestHandlers(outboundConnections, {
      server: mockServer,
      enablePagination: true,
    } as any);

    const handler = getRegisteredHandler(ListToolsRequestSchema);
    const result = await handler({ params: {} });

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(['filesystem/read_file']);
  });

  it('blocks direct tool invocation for disabled tools', async () => {
    mockGetTransportConfig.mockReturnValue({
      filesystem: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['write_file'],
      },
    });

    mockParseUri.mockReturnValue({
      clientName: 'filesystem',
      resourceName: 'write_file',
    });

    registerRequestHandlers(outboundConnections, {
      server: mockServer,
      enablePagination: true,
    } as any);

    const handler = getRegisteredHandler(CallToolRequestSchema);
    const result = await handler({
      params: {
        name: 'filesystem/write_file',
        arguments: {},
      },
    });

    expect(result.structuredContent.error.message).toContain('Tool is disabled');
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });
});
