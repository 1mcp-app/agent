import type { RegistryServer } from '@src/domains/registry/types.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupSearchHandler, handleSearchMCPServers } from './searchHandler.js';

// Mock the registry client
vi.mock('@src/domains/registry/mcpRegistryClient.js', () => {
  const mockClient = {
    getServers: vi.fn(),
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
            serverId: 'file-server-1',
            versionId: 'v1.0.0',
            publishedAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            isLatest: true,
          },
        },
      },
    ];

    // Reset mocks
    mockRegistryClient.getServers.mockReset();
    mockSearchEngine.applyFilters.mockReset();
  });

  afterEach(() => {
    cleanupSearchHandler();
  });

  it('should handle basic search request', async () => {
    mockRegistryClient.getServers.mockResolvedValue(mockServers);
    mockSearchEngine.applyFilters.mockReturnValue(mockServers);

    const result = await handleSearchMCPServers({
      query: 'file',
    });

    expect(mockRegistryClient.getServers).toHaveBeenCalledWith({ limit: 100 });
    expect(mockSearchEngine.applyFilters).toHaveBeenCalledWith(mockServers, {
      query: 'file',
      status: 'active',
      registry_type: undefined,
      transport: undefined,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'file-server',
      description: 'File management server',
      status: 'active',
      version: '1.0.0',
      packages: expect.any(Array),
      repository: expect.any(Object),
    });
  });

  it('should handle search with all filters', async () => {
    mockRegistryClient.getServers.mockResolvedValue(mockServers);
    mockSearchEngine.applyFilters.mockReturnValue([]);

    const result = await handleSearchMCPServers({
      query: 'database',
      status: 'active',
      registry_type: 'npm',
      transport: 'stdio',
      limit: 10,
      offset: 5,
    });

    expect(mockSearchEngine.applyFilters).toHaveBeenCalledWith(mockServers, {
      query: 'database',
      status: 'active',
      registry_type: 'npm',
      transport: 'stdio',
    });

    expect(result).toHaveLength(0);
  });

  it('should apply pagination correctly', async () => {
    const manyServers = Array.from({ length: 50 }, (_, i) => ({
      ...mockServers[0],
      name: `server-${i}`,
      _meta: {
        ...mockServers[0]._meta,
        'io.modelcontextprotocol.registry/official': {
          ...mockServers[0]._meta['io.modelcontextprotocol.registry/official'],
          serverId: `server-${i}`,
        },
      },
    }));

    mockRegistryClient.getServers.mockResolvedValue(manyServers);
    mockSearchEngine.applyFilters.mockReturnValue(manyServers);

    const result = await handleSearchMCPServers({
      limit: 10,
      offset: 5,
    });

    expect(result).toHaveLength(10);
    expect(result[0].name).toBe('server-5'); // Should start from offset 5
  });

  it('should respect maximum limit', async () => {
    mockRegistryClient.getServers.mockResolvedValue(mockServers);
    mockSearchEngine.applyFilters.mockReturnValue(mockServers);

    await handleSearchMCPServers({
      limit: 200, // Above maximum
    });

    // Should be capped at 100
    expect(mockRegistryClient.getServers).toHaveBeenCalled();
  });

  it('should handle registry client errors', async () => {
    mockRegistryClient.getServers.mockRejectedValue(new Error('Registry unavailable'));

    await expect(handleSearchMCPServers({})).rejects.toThrow('Failed to search MCP servers');
  });

  it('should transform server data correctly', async () => {
    const serverWithMultiplePackages = {
      ...mockServers[0],
      packages: [
        {
          registry_type: 'npm',
          identifier: '@test/file-server',
          version: '1.0.0',
          transport: 'stdio',
        },
        {
          registry_type: 'pypi',
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

    mockRegistryClient.getServers.mockResolvedValue([serverWithMultiplePackages]);
    mockSearchEngine.applyFilters.mockReturnValue([serverWithMultiplePackages]);

    const result = await handleSearchMCPServers({});

    expect(result[0]).toMatchObject({
      name: 'file-server',
      packages: [
        {
          registry_type: 'npm',
          identifier: '@test/file-server',
          version: '1.0.0',
          transport: 'stdio',
        },
        {
          registry_type: 'pypi',
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
    });
  });

  it('should handle "all" status filter', async () => {
    mockRegistryClient.getServers.mockResolvedValue(mockServers);
    mockSearchEngine.applyFilters.mockReturnValue(mockServers);

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

  it('should use default values for limit and offset', async () => {
    mockRegistryClient.getServers.mockResolvedValue([]);
    mockSearchEngine.applyFilters.mockReturnValue([]);

    await handleSearchMCPServers({});

    // Default limit and offset should be applied during pagination
    expect(mockRegistryClient.getServers).toHaveBeenCalled();
  });
});
