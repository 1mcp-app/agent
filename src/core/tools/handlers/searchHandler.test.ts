import type { RegistryServer } from '@src/domains/registry/types.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupSearchHandler, handleSearchMCPServers } from './searchHandler.js';

// Mock the registry client
vi.mock('@src/domains/registry/mcpRegistryClient.js', () => {
  const mockClient = {
    getServers: vi.fn(),
    getServersWithMetadata: vi.fn(),
    destroy: vi.fn(),
  };

  return {
    createRegistryClient: vi.fn(() => mockClient),
  };
});

// Mock the search engine
vi.mock('@src/domains/registry/searchFiltering.js', () => {
  const mockEngine = {
    applyFilters: vi.fn(),
  };

  return {
    createSearchEngine: vi.fn(() => mockEngine),
  };
});

describe('handleSearchMCPServers', () => {
  let mockRegistryClient: any;
  let mockSearchEngine: any;
  let mockServers: RegistryServer[];

  beforeEach(async () => {
    // Get the mocked modules
    const { createRegistryClient } = await import('@src/domains/registry/mcpRegistryClient.js');
    const { createSearchEngine } = await import('@src/domains/registry/searchFiltering.js');

    mockRegistryClient = (createRegistryClient as any)();
    mockSearchEngine = (createSearchEngine as any)();

    mockServers = [
      {
        $schema: 'https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json',
        name: 'file-server',
        description: 'File management server',
        status: 'active',
        repository: {
          url: 'https://github.com/test/file-server',
          source: 'github',
        },
        version: '1.0.0',
        remotes: [
          {
            type: 'streamable-http',
            url: 'npx @test/file-server',
          },
        ],
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            publishedAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            isLatest: true,
            status: 'active',
          },
        },
      },
    ];

    // Reset mocks
    mockRegistryClient.getServers.mockReset();
    mockRegistryClient.getServersWithMetadata.mockReset();
    mockSearchEngine.applyFilters.mockReset();
  });

  afterEach(() => {
    cleanupSearchHandler();
  });

  it('should handle basic search request', async () => {
    const mockServerResponses = mockServers.map((server) => ({
      server,
      _meta: {
        'io.modelcontextprotocol.registry/official': server._meta['io.modelcontextprotocol.registry/official'],
      },
    }));
    const mockResponse = {
      servers: mockServerResponses,
      metadata: {
        nextCursor: 'next-page-cursor',
        count: 1,
      },
    };
    mockRegistryClient.getServersWithMetadata.mockResolvedValue(mockResponse);

    // The search engine should return the RegistryServer objects (extracted from ServerResponse)
    mockSearchEngine.applyFilters.mockReturnValue(mockServers);

    const result = await handleSearchMCPServers({
      query: 'file',
    });

    expect(mockRegistryClient.getServersWithMetadata).toHaveBeenCalledWith({
      limit: 20,
      search: 'file',
    });
    expect(mockSearchEngine.applyFilters).toHaveBeenCalledWith(mockServers, {
      query: undefined, // Already handled by API
      status: 'active',
      registry_type: undefined,
      transport: undefined,
    });

    expect(result).toMatchObject({
      servers: expect.any(Array),
      next_cursor: 'next-page-cursor',
      count: 1,
    });
    expect(result.servers).toHaveLength(1);

    // The result should contain the server properties directly
    const serverResult = result.servers[0];
    expect(serverResult).toMatchObject({
      name: 'file-server',
      description: 'File management server',
      status: 'active',
      version: '1.0.0',
      packages: expect.any(Array),
      repository: expect.any(Object),
      registryId: 'file-server',
      lastUpdated: '2024-01-01T00:00:00Z',
    });
  });

  it('should handle search with all filters', async () => {
    const mockServerResponses = mockServers.map((server) => ({
      server,
      _meta: {
        'io.modelcontextprotocol.registry/official': server._meta['io.modelcontextprotocol.registry/official'],
      },
    }));
    const mockResponse = {
      servers: mockServerResponses,
      metadata: {
        nextCursor: undefined,
        count: 0,
      },
    };
    mockRegistryClient.getServersWithMetadata.mockResolvedValue(mockResponse);
    mockSearchEngine.applyFilters.mockReturnValue([]);

    const result = await handleSearchMCPServers({
      query: 'database',
      status: 'active',
      registry_type: 'npm',
      transport: 'stdio',
      limit: 10,
      cursor: 'some-cursor',
    });

    expect(mockRegistryClient.getServersWithMetadata).toHaveBeenCalledWith({
      limit: 10,
      search: 'database',
      cursor: 'some-cursor',
    });
    expect(mockSearchEngine.applyFilters).toHaveBeenCalledWith(mockServers, {
      query: undefined, // Already handled by API
      status: 'active',
      registry_type: 'npm',
      transport: 'stdio',
    });

    expect(result.servers).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  it('should handle cursor-based pagination', async () => {
    const mockServerResponses = mockServers.map((server) => ({
      server,
      _meta: {
        'io.modelcontextprotocol.registry/official': server._meta['io.modelcontextprotocol.registry/official'],
      },
    }));
    const mockResponse = {
      servers: mockServerResponses,
      metadata: {
        nextCursor: 'next-page-cursor',
        count: 1,
      },
    };
    mockRegistryClient.getServersWithMetadata.mockResolvedValue(mockResponse);
    mockSearchEngine.applyFilters.mockReturnValue(mockServerResponses);

    const result = await handleSearchMCPServers({
      limit: 10,
      cursor: 'current-page-cursor',
    });

    expect(mockRegistryClient.getServersWithMetadata).toHaveBeenCalledWith({
      limit: 10,
      cursor: 'current-page-cursor',
    });

    expect(result).toMatchObject({
      servers: expect.any(Array),
      next_cursor: 'next-page-cursor',
      count: 1,
    });
  });

  it('should respect maximum limit', async () => {
    const mockServerResponses = mockServers.map((server) => ({
      server,
      _meta: {
        'io.modelcontextprotocol.registry/official': server._meta['io.modelcontextprotocol.registry/official'],
      },
    }));
    const mockResponse = {
      servers: mockServerResponses,
      metadata: {
        nextCursor: undefined,
        count: 1,
      },
    };
    mockRegistryClient.getServersWithMetadata.mockResolvedValue(mockResponse);
    mockSearchEngine.applyFilters.mockReturnValue(mockServerResponses);

    await handleSearchMCPServers({
      limit: 200, // Above maximum
    });

    // Should be capped at 100
    expect(mockRegistryClient.getServersWithMetadata).toHaveBeenCalledWith({
      limit: 100,
    });
  });

  it('should handle registry client errors', async () => {
    mockRegistryClient.getServersWithMetadata.mockRejectedValue(new Error('Registry unavailable'));

    await expect(handleSearchMCPServers({})).rejects.toThrow('Failed to search MCP servers');
  });

  it('should transform server data correctly', async () => {
    const serverWithMultiplePackages = {
      ...mockServers[0],
      packages: [
        {
          registryType: 'npm',
          identifier: '@test/file-server',
          version: '1.0.0',
          transport: 'stdio',
        },
        {
          registryType: 'pypi',
          identifier: 'file-server-py',
          version: '1.0.0',
          transport: 'sse',
        },
      ],
      repository: {
        url: 'https://github.com/test/file-server',
        source: 'github',
        subfolder: 'packages/core',
      },
    };

    const mockServerResponse = {
      server: serverWithMultiplePackages,
      _meta: {
        'io.modelcontextprotocol.registry/official':
          serverWithMultiplePackages._meta['io.modelcontextprotocol.registry/official'],
      },
    };
    const mockResponse = {
      servers: [mockServerResponse],
      metadata: {
        nextCursor: undefined,
        count: 1,
      },
    };
    mockRegistryClient.getServersWithMetadata.mockResolvedValue(mockResponse);
    // The search engine should return the RegistryServer object (extracted from ServerResponse)
    mockSearchEngine.applyFilters.mockReturnValue([serverWithMultiplePackages]);

    const result = await handleSearchMCPServers({});

    expect(result.servers[0]).toMatchObject({
      name: 'file-server',
      description: 'File management server',
      status: 'active',
      version: '1.0.0',
      packages: expect.any(Array),
      repository: {
        url: 'https://github.com/test/file-server',
        source: 'github',
        subfolder: 'packages/core',
      },
      registryId: 'file-server',
      lastUpdated: '2024-01-01T00:00:00Z',
    });
  });

  it('should handle "all" status filter', async () => {
    const mockServerResponses = mockServers.map((server) => ({
      server,
      _meta: {
        'io.modelcontextprotocol.registry/official': server._meta['io.modelcontextprotocol.registry/official'],
      },
    }));
    const mockResponse = {
      servers: mockServerResponses,
      metadata: {
        nextCursor: undefined,
        count: 1,
      },
    };
    mockRegistryClient.getServersWithMetadata.mockResolvedValue(mockResponse);
    mockSearchEngine.applyFilters.mockReturnValue(mockServerResponses);

    await handleSearchMCPServers({
      status: 'all',
    });

    expect(mockSearchEngine.applyFilters).toHaveBeenCalledWith(mockServers, {
      query: undefined,
      status: undefined, // 'all' should be converted to undefined
      registry_type: undefined,
      transport: undefined,
    });
  });

  it('should use default values for limit', async () => {
    const mockResponse = {
      servers: [],
      metadata: {
        nextCursor: undefined,
        count: 0,
      },
    };
    mockRegistryClient.getServersWithMetadata.mockResolvedValue(mockResponse);
    mockSearchEngine.applyFilters.mockReturnValue([]);

    await handleSearchMCPServers({});

    // Default limit should be applied
    expect(mockRegistryClient.getServersWithMetadata).toHaveBeenCalledWith({
      limit: 20,
    });
  });
});
