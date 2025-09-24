import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatServerDetails } from './serverDetailFormatter.js';
import { RegistryServer, OFFICIAL_REGISTRY_KEY } from '../../core/registry/types.js';

// Mock console.table to capture table output
const mockConsoleTable = vi.fn();
vi.stubGlobal('console', { ...console, table: mockConsoleTable });

describe('serverDetailFormatter', () => {
  let mockServer: RegistryServer;

  beforeEach(() => {
    vi.clearAllMocks();

    mockServer = {
      name: 'test-server',
      description: 'A test MCP server for unit testing',
      status: 'active',
      version: '1.0.0',
      repository: {
        url: 'https://github.com/test/test-server',
        source: 'github',
        subfolder: 'packages/server',
      },
      websiteUrl: 'https://test-server.example.com',
      packages: [
        {
          registryType: 'npm',
          identifier: '@test/test-server',
          version: '1.0.0',
          transport: { type: 'stdio' },
          runtimeHint: 'node',
          fileSha256: 'abc123def456',
          environmentVariables: [
            {
              value: 'API_KEY',
              isRequired: true,
              isSecret: true,
              description: 'API key for authentication',
            },
            {
              value: 'DEBUG',
              isRequired: false,
              isSecret: false,
              default: 'false',
              description: 'Enable debug logging',
            },
          ],
          packageArguments: [
            {
              name: 'config',
              type: 'string',
              isRequired: true,
              isSecret: false,
              isRepeated: false,
              description: 'Configuration file path',
            },
          ],
          runtimeArguments: [
            {
              name: 'verbose',
              type: 'boolean',
              isRequired: false,
              isSecret: false,
              isRepeated: false,
              default: 'false',
              valueHint: 'true/false',
              description: 'Enable verbose output',
            },
          ],
        },
        {
          registryType: 'pypi',
          identifier: 'test-server-py',
          version: '1.0.0',
          transport: { type: 'sse' },
          runtimeHint: 'python',
        },
      ],
      remotes: [
        {
          type: 'webhook',
          url: 'https://api.test-server.example.com/webhook',
          headers: [
            {
              value: 'Authorization',
              isRequired: true,
              isSecret: true,
              description: 'Bearer token for webhook authentication',
            },
          ],
        },
      ],
      _meta: {
        [OFFICIAL_REGISTRY_KEY]: {
          serverId: 'test-server-id',
          versionId: 'test-version-id',
          publishedAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-02T00:00:00Z',
          isLatest: true,
        },
      },
    };
  });

  describe('formatServerDetails', () => {
    it('should format server details in JSON format', () => {
      const result = formatServerDetails(mockServer, 'json');

      expect(result).toBe(JSON.stringify(mockServer, null, 2));
    });

    it('should format server details in table format by default', () => {
      const result = formatServerDetails(mockServer);

      expect(result).toContain('Server Details:');
      expect(mockConsoleTable).toHaveBeenCalledTimes(5); // Basic info + packages + env vars + args + remotes
    });

    it('should format server details in table format explicitly', () => {
      const result = formatServerDetails(mockServer, 'table');

      expect(result).toContain('Server Details:');
      expect(result).toContain('Packages:');
      expect(result).toContain('Environment Variables:');
      expect(result).toContain('Arguments:');
      expect(result).toContain('Remote Endpoints:');
      expect(mockConsoleTable).toHaveBeenCalledTimes(5);
    });

    it('should format server details in detailed format', () => {
      const result = formatServerDetails(mockServer, 'detailed');

      // Should be wrapped in boxen
      expect(result).toContain('test-server');
      expect(result).toContain('A test MCP server for unit testing');
      expect(result).toContain('● ACTIVE');
      expect(result).toContain('Repository:');
      expect(result).toContain('Packages:');
    });

    it('should handle server without optional fields', () => {
      const minimalServer: RegistryServer = {
        name: 'minimal-server',
        description: 'Minimal server',
        status: 'active',
        version: '1.0.0',
        repository: {
          url: 'https://github.com/test/minimal',
          source: 'github',
        },
        _meta: {
          [OFFICIAL_REGISTRY_KEY]: {
            serverId: 'minimal-id',
            versionId: 'minimal-version-id',
            publishedAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
            isLatest: true,
          },
        },
      };

      const result = formatServerDetails(minimalServer, 'table');

      expect(result).toContain('Server Details:');
      expect(mockConsoleTable).toHaveBeenCalledTimes(1); // Only basic info table
    });

    it('should handle server with empty packages array', () => {
      const serverWithEmptyPackages: RegistryServer = {
        name: 'test-server',
        description: 'A test MCP server for unit testing',
        status: 'active',
        version: '1.0.0',
        repository: {
          url: 'https://github.com/test/test-server',
          source: 'github',
        },
        packages: [],
        _meta: {
          [OFFICIAL_REGISTRY_KEY]: {
            serverId: 'test-server-id',
            versionId: 'test-version-id',
            publishedAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-02T00:00:00Z',
            isLatest: true,
          },
        },
      };

      const result = formatServerDetails(serverWithEmptyPackages, 'table');

      expect(result).toContain('Server Details:');
      expect(result).not.toContain('Packages:');
      expect(mockConsoleTable).toHaveBeenCalledTimes(1); // Only basic info
    });

    it('should handle server with empty remotes array', () => {
      const serverWithEmptyRemotes = {
        ...mockServer,
        remotes: [],
      };

      const result = formatServerDetails(serverWithEmptyRemotes, 'table');

      expect(result).toContain('Server Details:');
      expect(result).not.toContain('Remote Endpoints:');
    });

    it('should format detailed view with deprecated status', () => {
      const deprecatedServer = {
        ...mockServer,
        status: 'deprecated' as const,
      };

      const result = formatServerDetails(deprecatedServer, 'detailed');

      expect(result).toContain('● DEPRECATED');
    });

    it('should format detailed view with archived status', () => {
      const archivedServer = {
        ...mockServer,
        status: 'archived' as const,
      };

      const result = formatServerDetails(archivedServer, 'detailed');

      expect(result).toContain('● ARCHIVED');
    });

    it('should handle packages without environment variables', () => {
      const serverWithoutEnvVars = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm' as const,
            identifier: '@test/simple-server',
            version: '1.0.0',
            transport: { type: 'stdio' } as const,
          },
        ],
      };

      const result = formatServerDetails(serverWithoutEnvVars, 'table');

      expect(result).toContain('Server Details:');
      expect(result).toContain('Packages:');
      expect(result).not.toContain('Environment Variables:');
    });

    it('should handle packages without arguments', () => {
      const serverWithoutArgs = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm' as const,
            identifier: '@test/simple-server',
            version: '1.0.0',
            transport: { type: 'stdio' } as const,
            environmentVariables: [],
          },
        ],
      };

      const result = formatServerDetails(serverWithoutArgs, 'table');

      expect(result).toContain('Server Details:');
      expect(result).toContain('Packages:');
      expect(result).not.toContain('Arguments:');
    });

    it('should handle transport as object', () => {
      const serverWithObjectTransport = {
        ...mockServer,
        packages: [
          {
            registryType: 'npm' as const,
            identifier: '@test/test-server',
            version: '1.0.0',
            transport: { type: 'custom-transport' },
          },
        ],
      };

      formatServerDetails(serverWithObjectTransport, 'table');

      expect(mockConsoleTable).toHaveBeenCalled();
      // Check that the transport type is in the basic info table
      const basicInfoCall = mockConsoleTable.mock.calls[0][0];
      expect(basicInfoCall[0]['Transport Types']).toContain('custom-transport');
    });

    it('should show install commands in detailed format', () => {
      const result = formatServerDetails(mockServer, 'detailed');

      expect(result).toContain('npm install @test/test-server@1.0.0');
      expect(result).toContain('pip install test-server-py==1.0.0');
    });

    it('should handle remotes without headers', () => {
      const serverWithSimpleRemote: RegistryServer = {
        name: 'test-server',
        description: 'A test MCP server for unit testing',
        status: 'active',
        version: '1.0.0',
        repository: {
          url: 'https://github.com/test/test-server',
          source: 'github',
        },
        packages: [],
        remotes: [
          {
            type: 'sse' as const,
            url: 'https://api.example.com/sse',
          },
        ],
        _meta: {
          [OFFICIAL_REGISTRY_KEY]: {
            serverId: 'test-server-id',
            versionId: 'test-version-id',
            publishedAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-02T00:00:00Z',
            isLatest: true,
          },
        },
      };

      const result = formatServerDetails(serverWithSimpleRemote, 'detailed');

      expect(result).toContain('sse - https://api.example.com/sse');
    });

    it('should handle missing repository subfolder', () => {
      const serverWithoutSubfolder = {
        ...mockServer,
        repository: {
          url: 'https://github.com/test/test-server',
          source: 'github',
        },
      };

      const result = formatServerDetails(serverWithoutSubfolder, 'table');

      expect(result).toContain('Server Details:');
      // Should not contain subfolder field
      expect(mockConsoleTable).toHaveBeenCalled();
      const tableCall = mockConsoleTable.mock.calls[0][0];
      expect(tableCall[0]).not.toHaveProperty('Repository Subfolder');
    });

    it('should format non-latest version', () => {
      const nonLatestServer = {
        ...mockServer,
        _meta: {
          [OFFICIAL_REGISTRY_KEY]: {
            ...mockServer._meta[OFFICIAL_REGISTRY_KEY],
            isLatest: false,
          },
        },
      };

      const result = formatServerDetails(nonLatestServer, 'detailed');

      expect(result).toContain('Latest Version:');
      expect(result).toContain('No');
    });
  });
});
