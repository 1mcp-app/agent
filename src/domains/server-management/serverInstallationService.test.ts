import { getAllServers, getInstallationMetadata, getServer, setServer } from '@src/commands/mcp/utils/configUtils.js';
import type { RegistryServer } from '@src/domains/registry/types.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRegistryClient } from '../registry/mcpRegistryClient.js';
import { getProgressTrackingService } from './progressTrackingService.js';
import { createServerInstallationService, ServerInstallationService } from './serverInstallationService.js';
import { compareVersions, getUpdateType } from './services/versionResolver.js';

// Helper function to create mock RegistryServer objects with correct interface
function _createMockRegistryServer(overrides: Partial<RegistryServer> = {}): RegistryServer {
  return {
    name: 'test-server',
    description: 'Test server description',
    status: 'active' as const,
    version: '1.0.0',
    repository: {
      source: 'github',
      url: 'https://github.com/test/test-server',
    },
    _meta: {
      'io.modelcontextprotocol.registry/official': {
        isLatest: true,
        publishedAt: new Date().toISOString(),
        status: 'active' as const,
        updatedAt: new Date().toISOString(),
      },
    },
    ...overrides,
  } as RegistryServer;
}

// Mock all external dependencies
vi.mock('@src/commands/mcp/utils/configUtils.js', () => ({
  getAllServers: vi.fn(),
  getInstallationMetadata: vi.fn(),
  getServer: vi.fn(),
  setServer: vi.fn(),
}));

vi.mock('../registry/mcpRegistryClient.js', () => ({
  createRegistryClient: vi.fn(() => ({
    getServerById: vi.fn(),
    searchServers: vi.fn(),
  })),
}));

vi.mock('./services/versionResolver.js', () => ({
  compareVersions: vi.fn(),
  getUpdateType: vi.fn(),
}));

vi.mock('./progressTrackingService.js', () => ({
  getProgressTrackingService: vi.fn(() => ({
    startOperation: vi.fn(),
    updateProgress: vi.fn(),
    completeOperation: vi.fn(),
    failOperation: vi.fn(),
  })),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@src/constants', () => ({
  MCP_SERVER_VERSION: '0.27.3-test',
  MCP_CONFIG_FILE: 'mcp.json',
  MCP_INSTRUCTIONS_TEMPLATE_FILE: 'instructions-template.md',
  MCP_SERVER_NAME: '1mcp',
  MCP_URI_SEPARATOR: '_1mcp_',
  MCP_SERVER_CAPABILITIES: {
    completions: {},
    resources: { listChanged: true },
    tools: { listChanged: true },
    prompts: { listChanged: true },
    logging: {},
  },
  MCP_CLIENT_CAPABILITIES: {
    roots: { listChanged: false },
    sampling: { listChanged: false },
    elicitation: { listChanged: false },
  },
  PORT: 3050,
  HOST: '127.0.0.1',
  SSE_ENDPOINT: '/sse',
  MESSAGES_ENDPOINT: '/messages',
  STREAMABLE_HTTP_ENDPOINT: '/mcp',
  HEALTH_ENDPOINT: '/health',
  CONNECTION_RETRY: {
    MAX_ATTEMPTS: 3,
    INITIAL_DELAY_MS: 1000,
  },
  AUTH_CONFIG: {
    SERVER: {
      DEFAULT_ENABLED: false,
      STORAGE: { DIR: 'sessions', FILE_EXTENSION: '.json' },
      SESSION: { TTL_MINUTES: 1440, ID_PREFIX: 'sess-', FILE_PREFIX: 'session_', SUBDIR: 'server' },
      AUTH_CODE: { TTL_MS: 60000, ID_PREFIX: 'code-', FILE_PREFIX: 'auth_code_', SUBDIR: 'server' },
      AUTH_REQUEST: { TTL_MS: 600000, ID_PREFIX: 'code-', FILE_PREFIX: 'auth_request_', SUBDIR: 'server' },
      TOKEN: { TTL_MS: 86400000, ID_PREFIX: 'tk-' },
      STREAMABLE_SESSION: {
        TTL_MS: 86400000,
        ID_PREFIX: 'stream-',
        FILE_PREFIX: 'streamable_session_',
        SUBDIR: 'transport',
        SAVE_POLICY: { REQUESTS: 100, INTERVAL_MS: 300000, FLUSH_INTERVAL_MS: 60000 },
      },
      CLIENT: { ID_PREFIX: 'client-', FILE_PREFIX: 'session_cli_', SUBDIR: 'server' },
    },
    CLIENT: {
      OAUTH: {
        TTL_MS: 2592000000,
        CODE_VERIFIER_TTL_MS: 600000,
        STATE_TTL_MS: 600000,
        DEFAULT_TOKEN_EXPIRY_SECONDS: 3600,
        DEFAULT_CALLBACK_PATH: '/oauth/callback',
        DEFAULT_SCOPES: [],
      },
      SESSION: { TTL_MS: 2592000000, ID_PREFIX: 'oauth_', FILE_PREFIX: '', SUBDIR: 'client' },
      PREFIXES: { CLIENT: 'cli_', TOKENS: 'tok_', VERIFIER: 'ver_', STATE: 'sta_' },
    },
  },
  STORAGE_SUBDIRS: { SERVER: 'server', CLIENT: 'client', TRANSPORT: 'transport' },
  FILE_PREFIX_MAPPING: {
    SERVER: ['session_', 'auth_code_', 'auth_request_'],
    CLIENT: ['oauth_', 'cli_', 'tok_', 'ver_', 'sta_'],
    TRANSPORT: ['streamable_session_'],
  },
  RATE_LIMIT_CONFIG: {
    OAUTH: { WINDOW_MS: 900000, MAX: 100, MESSAGE: { error: 'Too many requests, please try again later.' } },
  },
  CONFIG_DIR_NAME: '1mcp',
  BACKUP_DIR_NAME: 'backups',
  DEFAULT_CONFIG: { mcpServers: {} },
  getGlobalConfigDir: vi.fn(() => '/test/config'),
  getConfigDir: vi.fn(() => '/test/config'),
  getGlobalConfigPath: vi.fn(() => '/test/config/mcp.json'),
  getConfigPath: vi.fn(() => '/test/config/mcp.json'),
  getGlobalBackupDir: vi.fn(() => '/test/config/backups'),
  getAppBackupDir: vi.fn(() => '/test/config/backups/test'),
  getDefaultInstructionsTemplatePath: vi.fn(() => '/test/config/instructions-template.md'),
}));

describe('ServerInstallationService', () => {
  let service: ServerInstallationService;
  let mockRegistryClient: any;
  let mockRegistryClientInstance: any;
  let mockConfigUtils: any;
  let mockVersionResolver: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock references - create mock instance and configure factory function
    mockRegistryClientInstance = {
      getServerById: vi.fn(),
      searchServers: vi.fn(),
    };
    mockRegistryClient = vi.mocked(createRegistryClient);
    mockRegistryClient.mockReturnValue(mockRegistryClientInstance as any);

    // Create service after setting up mocks
    service = new ServerInstallationService();

    mockConfigUtils = {
      getAllServers: vi.mocked(getAllServers),
      getServer: vi.mocked(getServer),
      setServer: vi.mocked(setServer),
      getInstallationMetadata: vi.mocked(getInstallationMetadata),
    };

    mockVersionResolver = {
      compareVersions: vi.mocked(compareVersions),
      getUpdateType: vi.mocked(getUpdateType),
    };

    // Initialize progress tracking service
    getProgressTrackingService();
  });

  describe('constructor', () => {
    it('should initialize with registry client and progress tracker', () => {
      // Clear mock counts before this specific test
      vi.clearAllMocks();

      new ServerInstallationService();

      expect(createRegistryClient).toHaveBeenCalledTimes(1); // Once for service only
      expect(getProgressTrackingService).toHaveBeenCalledTimes(1);
    });
  });

  describe('installServer', () => {
    const mockRegistryServer: RegistryServer = {
      name: 'test-server',
      version: '1.0.0',
      description: 'Test server',
      status: 'active',
      repository: {
        source: 'test',
        url: 'https://github.com/test/test-server',
      },
      remotes: [
        {
          type: 'streamable-http',
          url: 'npx:test-package',
        },
      ],
      _meta: {
        'io.modelcontextprotocol.registry/official': {
          isLatest: true,
          publishedAt: '2024-01-01T00:00:00Z',
          status: 'active',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      },
    };

    it('should install server successfully with direct lookup', async () => {
      mockRegistryClientInstance.getServerById.mockResolvedValue(mockRegistryServer);

      const result = await service.installServer('test-server', '1.0.0');

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(result.version).toBe('1.0.0');
      expect(result.operationId).toMatch(/^op_\d+_[a-z0-9]{7}$/);
      expect(result.installedAt).toBeInstanceOf(Date);
      expect(result.config).toEqual({
        type: 'stdio',
        command: 'npx:test-package',
      });
    });

    it('should install server with search-based ID resolution fallback', async () => {
      // Direct lookup fails
      mockRegistryClientInstance.getServerById.mockRejectedValueOnce(new Error('Not found'));

      // Search succeeds
      mockRegistryClientInstance.searchServers.mockResolvedValue([
        { name: 'io.github/user/test-server', version: '1.0.0' } as RegistryServer,
      ]);

      // Second direct lookup with full ID succeeds
      mockRegistryClientInstance.getServerById.mockResolvedValueOnce(mockRegistryServer);

      const result = await service.installServer('test-server');

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(mockRegistryClientInstance.searchServers).toHaveBeenCalledWith({
        query: 'test-server',
        limit: 10,
      });
    });

    it('should prioritize streamable-http remote endpoint', async () => {
      const serverWithMultipleRemotes: RegistryServer = {
        name: 'multi-remote-server',
        version: '1.0.0',
        description: 'Server with multiple remotes',
        status: 'active',
        repository: {
          source: 'test',
          url: 'https://github.com/test/multi-remote-server',
        },
        remotes: [
          {
            type: 'docker',
            url: 'docker://some-image',
          },
          {
            type: 'streamable-http',
            url: 'npx:test-package',
          },
          {
            type: 'stdio',
            url: 'local://path',
          },
        ],
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            isLatest: true,
            publishedAt: '2024-01-01T00:00:00Z',
            status: 'active',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        },
      } as RegistryServer;

      mockRegistryClientInstance.getServerById.mockResolvedValue(serverWithMultipleRemotes);

      const result = await service.installServer('multi-remote-server');

      expect(result.success).toBe(true);
      expect(result.config?.command).toBe('npx:test-package');
    });

    it('should fallback to first available remote when no streamable-http', async () => {
      const serverWithoutStreamable: RegistryServer = {
        name: 'fallback-server',
        version: '1.0.0',
        description: 'Server without streamable-http',
        remotes: [
          {
            type: 'docker',
            url: 'docker://some-image',
          },
          {
            type: 'stdio',
            url: 'local://path',
          },
        ],
        status: 'active',
        repository: { source: 'github', url: 'https://github.com/test/fallback-server' },
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            isLatest: true,
            publishedAt: new Date().toISOString(),
            status: 'active' as const,
            updatedAt: new Date().toISOString(),
          },
        },
      } as RegistryServer;

      mockRegistryClientInstance.getServerById.mockResolvedValue(serverWithoutStreamable);

      const result = await service.installServer('fallback-server');

      expect(result.success).toBe(true);
      expect(result.config?.command).toBe('docker://some-image');
    });

    it('should handle server without remotes gracefully', async () => {
      const serverWithoutRemotes: RegistryServer = {
        name: 'no-remote-server',
        version: '1.0.0',
        description: 'Server without remotes',
        remotes: [],
        status: 'active',
        repository: { source: 'github', url: 'https://github.com/test/no-remote-server' } as any,
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            isLatest: true,
            publishedAt: new Date().toISOString(),
            status: 'active' as const,
            updatedAt: new Date().toISOString(),
          },
        } as any,
      } as any;

      mockRegistryClientInstance.getServerById.mockResolvedValue(serverWithoutRemotes);

      await expect(service.installServer('no-remote-server')).rejects.toThrow(
        'No compatible installation method found for no-remote-server',
      );
    });

    it('should handle server not found in registry', async () => {
      mockRegistryClientInstance.getServerById.mockRejectedValue(new Error('Server not found'));
      mockRegistryClientInstance.searchServers.mockResolvedValue([]);

      await expect(service.installServer('non-existent-server')).rejects.toThrow(
        "Server 'non-existent-server' not found in registry. Suggestions:\n1. Check spelling: non-existent-server\n2. Search for available servers: 1mcp registry search non-existent-server\n3. Use interactive mode: 1mcp mcp install --interactive\n4. Use full registry ID (e.g., 'io.github.username/server-name')",
      );
    });

    it('should handle search failure with helpful error message', async () => {
      mockRegistryClientInstance.getServerById.mockRejectedValue(new Error('Server not found'));
      mockRegistryClientInstance.searchServers.mockRejectedValue(new Error('Search failed'));

      await expect(service.installServer('search-fail-server')).rejects.toThrow(
        `Server 'search-fail-server' not found in registry. Suggestions:
1. Check spelling: search-fail-server
2. Search for available servers: 1mcp registry search search-fail-server
3. Use interactive mode: 1mcp mcp install --interactive
4. Use full registry ID (e.g., 'io.github.username/server-name')`,
      );
    });

    it('should handle registry client errors', async () => {
      const networkError = new Error('Network error');
      mockRegistryClientInstance.getServerById.mockRejectedValue(networkError);
      mockRegistryClientInstance.searchServers.mockRejectedValue(networkError);

      await expect(service.installServer('network-error-server')).rejects.toThrow('network-error-server');
    });

    it('should search with exact name match priority', async () => {
      const searchResults = [
        { name: 'some-prefix-test-server-suffix', version: '1.0.0' },
        { name: 'exact-test-server', version: '1.0.0' },
        { name: 'test-server-related', version: '1.0.0' },
      ];

      mockRegistryClientInstance.getServerById.mockRejectedValueOnce(new Error('Not found'));
      mockRegistryClientInstance.searchServers.mockResolvedValue(searchResults);
      mockRegistryClientInstance.getServerById.mockResolvedValueOnce({
        name: 'exact-test-server',
        version: '1.0.0',
        remotes: [{ type: 'streamable-http', url: 'npx:test-package' }],
      });

      const result = await service.installServer('test-server');

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
    });

    it('should search with partial match when no exact match', async () => {
      const searchResults = [
        { name: 'io.github/user/test-server', version: '1.0.0' } as RegistryServer,
        { name: 'different-server', version: '1.0.0' },
      ];

      mockRegistryClientInstance.getServerById.mockRejectedValueOnce(new Error('Not found'));
      mockRegistryClientInstance.searchServers.mockResolvedValue(searchResults);
      mockRegistryClientInstance.getServerById.mockResolvedValueOnce({
        name: 'io.github/user/test-server',
        version: '1.0.0',
        remotes: [{ type: 'streamable-http', url: 'npx:test-package' }],
        status: 'active',
        repository: { type: 'git', url: 'https://github.com/test/io.github-user-test-server' },
        _meta: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSync: new Date().toISOString(),
          source: 'official',
          verified: true,
          downloads: 0,
          stars: 0,
        },
      } as any);

      const result = await service.installServer('test-server');

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
    });

    it('should install server without specifying version', async () => {
      mockRegistryClientInstance.getServerById.mockResolvedValue(mockRegistryServer);

      const result = await service.installServer('test-server');

      expect(result.success).toBe(true);
      expect(result.version).toBe('1.0.0');
      expect(mockRegistryClientInstance.getServerById).toHaveBeenCalledWith('test-server', undefined);
    });

    it('should generate unique operation IDs for multiple installations', async () => {
      mockRegistryClientInstance.getServerById.mockResolvedValue(mockRegistryServer);

      const result1 = await service.installServer('server1');
      const result2 = await service.installServer('server2');

      expect(result1.operationId).not.toBe(result2.operationId);
      expect(result1.operationId).toMatch(/^op_\d+_[a-z0-9]{7}$/);
      expect(result2.operationId).toMatch(/^op_\d+_[a-z0-9]{7}$/);
    });
  });

  describe('updateServer', () => {
    const mockCurrentConfig = {
      type: 'stdio',
      command: 'npx:test-package@1.0.0',
    };

    it('should update server successfully', async () => {
      const updatedRegistryServer: RegistryServer = {
        name: 'test-server',
        version: '2.0.0',
        description: 'Updated test server',
        remotes: [{ type: 'streamable-http', url: 'npx:test-package@2.0.0' }],
        status: 'active',
        repository: { type: 'git', url: 'https://github.com/test/test-server' },
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            isLatest: true,
            publishedAt: new Date().toISOString(),
            status: 'active' as const,
            updatedAt: new Date().toISOString(),
          },
        } as any,
      } as any;

      mockConfigUtils.getServer.mockReturnValue(mockCurrentConfig);
      mockRegistryClientInstance.getServerById.mockResolvedValue(updatedRegistryServer);

      const result = await service.updateServer('test-server', '2.0.0');

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(result.newVersion).toBe('2.0.0');
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.operationId).toMatch(/^op_\d+_[a-z0-9]{7}$/);
      expect(mockConfigUtils.setServer).toHaveBeenCalledWith('test-server', mockCurrentConfig);
    });

    it('should update server to latest version when no version specified', async () => {
      const latestRegistryServer: RegistryServer = {
        name: 'test-server',
        version: '2.1.0',
        description: 'Latest test server',
        remotes: [{ type: 'streamable-http', url: 'npx:test-package@2.1.0' }],
        status: 'active',
        repository: { source: 'github', url: 'https://github.com/test/test-server' } as any,
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            isLatest: true,
            publishedAt: new Date().toISOString(),
            status: 'active' as const,
            updatedAt: new Date().toISOString(),
          },
        } as any,
      } as any;

      mockConfigUtils.getServer.mockReturnValue(mockCurrentConfig);
      mockRegistryClientInstance.getServerById.mockResolvedValue(latestRegistryServer);

      const result = await service.updateServer('test-server');

      expect(result.success).toBe(true);
      expect(result.newVersion).toBe('2.1.0');
      expect(mockRegistryClientInstance.getServerById).toHaveBeenCalledWith('test-server', 'latest');
    });

    it('should handle update when server not found in configuration', async () => {
      mockConfigUtils.getServer.mockReturnValue(null);

      const result = await service.updateServer('non-existent-server');

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Server 'non-existent-server' not found in configuration");
    });

    it('should handle update when server not found in registry', async () => {
      mockConfigUtils.getServer.mockReturnValue(mockCurrentConfig);
      mockRegistryClientInstance.getServerById.mockRejectedValue(
        new Error("Server 'test-server' not found in registry"),
      );

      const result = await service.updateServer('test-server');

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Server 'test-server' not found in registry");
    });

    it('should handle registry errors during update', async () => {
      mockConfigUtils.getServer.mockReturnValue(mockCurrentConfig);
      mockRegistryClientInstance.getServerById.mockRejectedValue(new Error('Network error'));

      const result = await service.updateServer('test-server');

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Network error');
    });

    it('should generate unique operation IDs for updates', async () => {
      mockConfigUtils.getServer.mockReturnValue(mockCurrentConfig);
      mockRegistryClientInstance.getServerById.mockResolvedValue({
        name: 'test-server',
        version: '2.0.0',
        remotes: [{ type: 'streamable-http', url: 'npx:test-package' }],
      });

      const result1 = await service.updateServer('server1');
      const result2 = await service.updateServer('server2');

      expect(result1.operationId).not.toBe(result2.operationId);
    });
  });

  describe('uninstallServer', () => {
    it('should uninstall server successfully', async () => {
      const result = await service.uninstallServer('test-server');

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(result.removedAt).toBeInstanceOf(Date);
      expect(result.configRemoved).toBe(true);
      expect(result.operationId).toMatch(/^op_\d+_[a-z0-9]{7}$/);
      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should generate unique operation IDs for uninstalls', async () => {
      const result1 = await service.uninstallServer('server1');
      const result2 = await service.uninstallServer('server2');

      expect(result1.operationId).not.toBe(result2.operationId);
      expect(result1.operationId).toMatch(/^op_\d+_[a-z0-9]{7}$/);
    });

    it('should handle uninstall with options', async () => {
      const options = {
        force: true,
        backup: true,
        removeConfig: false,
        verbose: true,
      };

      const result = await service.uninstallServer('test-server', options);

      expect(result.success).toBe(true);
      // Note: Current implementation doesn't use options, but test verifies structure
      expect(result.configRemoved).toBe(true); // Default behavior
    });
  });

  describe('checkForUpdates', () => {
    beforeEach(() => {
      mockConfigUtils.getAllServers.mockReturnValue({
        server1: { type: 'stdio' },
        server2: { type: 'stdio' },
        server3: { type: 'stdio' },
      });
    });

    it('should check updates for all servers when no names provided', async () => {
      const registryServers = [
        { name: 'server1', version: '1.1.0' },
        { name: 'server2', version: '2.0.0' },
        { name: 'server3', version: '1.0.0' },
      ];

      mockConfigUtils.getInstallationMetadata.mockImplementation((serverName: string) => {
        if (serverName === 'server1') return { version: '1.0.0' };
        if (serverName === 'server2') return { version: '2.0.0' };
        return null; // server3 has no metadata
      });

      mockRegistryClientInstance.getServerById.mockImplementation((serverName: string) => {
        return registryServers.find((s) => s.name === serverName);
      });

      mockVersionResolver.compareVersions.mockImplementation((newVersion: string, oldVersion: string) => {
        if (newVersion === '1.1.0' && oldVersion === '1.0.0') return 1;
        if (newVersion === '2.0.0' && oldVersion === '2.0.0') return 0;
        if (newVersion === '1.0.0' && oldVersion === '2.0.0') return -1;
        return 0;
      });

      mockVersionResolver.getUpdateType.mockReturnValue('minor');

      const results = await service.checkForUpdates();

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({
        serverName: 'server1',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        hasUpdate: true,
        updateAvailable: true,
        updateType: 'minor',
      });

      expect(results[1]).toEqual({
        serverName: 'server2',
        currentVersion: '2.0.0',
        latestVersion: '2.0.0',
        hasUpdate: false,
        updateAvailable: false,
        updateType: 'minor',
      });

      expect(results[2]).toEqual({
        serverName: 'server3',
        currentVersion: 'unknown',
        latestVersion: '1.0.0',
        hasUpdate: false,
        updateAvailable: false,
        updateType: undefined,
      });
    });

    it('should check updates for specific servers when names provided', async () => {
      mockConfigUtils.getInstallationMetadata.mockReturnValue({ version: '1.0.0' });
      mockRegistryClientInstance.getServerById.mockResolvedValue({
        name: 'server1',
        version: '1.1.0',
        description: 'Test server 1',
        status: 'active',
        repository: { type: 'git', url: 'https://github.com/test/server1' },
        _meta: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSync: new Date().toISOString(),
          source: 'official',
          verified: true,
          downloads: 0,
          stars: 0,
        },
      } as any);
      mockVersionResolver.compareVersions.mockReturnValue(1);
      mockVersionResolver.getUpdateType.mockReturnValue('patch');

      const results = await service.checkForUpdates(['server1']);

      expect(results).toHaveLength(1);
      expect(results[0].serverName).toBe('server1');
      expect(mockRegistryClientInstance.getServerById).toHaveBeenCalledTimes(1);
    });

    it('should handle servers with unknown version gracefully', async () => {
      mockConfigUtils.getInstallationMetadata.mockReturnValue(null);
      mockRegistryClientInstance.getServerById.mockResolvedValue({
        name: 'server1',
        version: '1.0.0',
        description: 'Test server 1',
        status: 'active',
        repository: { type: 'git', url: 'https://github.com/test/server1' },
        _meta: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSync: new Date().toISOString(),
          source: 'official',
          verified: true,
          downloads: 0,
          stars: 0,
        },
      } as any);

      const results = await service.checkForUpdates(['server1']);

      expect(results[0]).toEqual({
        serverName: 'server1',
        currentVersion: 'unknown',
        latestVersion: '1.0.0',
        hasUpdate: false,
        updateAvailable: false,
        updateType: undefined,
      });
    });

    it('should handle servers not found in registry', async () => {
      mockConfigUtils.getInstallationMetadata.mockReturnValue({ version: '1.0.0' });
      mockRegistryClientInstance.getServerById.mockRejectedValue(new Error('Server not found'));

      const results = await service.checkForUpdates(['missing-server']);

      expect(results).toHaveLength(0); // Silently skipped
    });

    it('should handle version comparison correctly', async () => {
      mockConfigUtils.getInstallationMetadata.mockReturnValue({ version: '1.0.0' });

      const testCases = [
        { latest: '2.0.0', hasUpdate: true },
        { latest: '1.1.0', hasUpdate: true },
        { latest: '1.0.1', hasUpdate: true },
        { latest: '1.0.0', hasUpdate: false },
        { latest: '0.9.0', hasUpdate: false },
      ];

      for (const testCase of testCases) {
        mockRegistryClientInstance.getServerById.mockResolvedValue({
          name: 'test-server',
          version: testCase.latest,
          description: 'Test server for version comparison',
          status: 'active',
          repository: { type: 'git', url: 'https://github.com/test/test-server' },
          _meta: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastSync: new Date().toISOString(),
            source: 'official',
            verified: true,
            downloads: 0,
            stars: 0,
          },
        } as any);

        mockVersionResolver.compareVersions.mockReturnValue(
          testCase.latest === '1.0.0' ? 0 : testCase.latest > '1.0.0' ? 1 : -1,
        );

        const results = await service.checkForUpdates(['test-server']);

        expect(results[0].hasUpdate).toBe(testCase.hasUpdate);
        expect(results[0].updateAvailable).toBe(testCase.hasUpdate);
      }
    });

    it('should skip servers that cannot be checked without failing', async () => {
      mockConfigUtils.getAllServers.mockReturnValue({
        'working-server': { type: 'stdio' },
        'failing-server': { type: 'stdio' },
        'another-working': { type: 'stdio' },
      });

      mockConfigUtils.getInstallationMetadata.mockImplementation((_serverName: string) => ({
        version: '1.0.0',
      }));

      mockRegistryClientInstance.getServerById.mockImplementation((currentServerName: string) => {
        if (currentServerName === 'failing-server') {
          throw new Error(`Network error for ${currentServerName}`);
        }
        return Promise.resolve({
          name: currentServerName,
          version: '1.0.0',
          description: `Test server ${currentServerName}`,
          status: 'active',
          repository: { type: 'git', url: `https://github.com/test/${currentServerName}` },
          _meta: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastSync: new Date().toISOString(),
            source: 'official',
            verified: true,
            downloads: 0,
            stars: 0,
          },
        } as any);
      });

      mockVersionResolver.compareVersions.mockReturnValue(0);

      const results = await service.checkForUpdates();

      expect(results).toHaveLength(2); // Only working servers
      expect(results.map((r) => r.serverName)).toEqual(['working-server', 'another-working']);
    });
  });

  describe('listInstalledServers', () => {
    const mockServers = {
      server1: { type: 'stdio', disabled: false },
      server2: { type: 'stdio', disabled: true },
      server3: { type: 'stdio', disabled: false },
    };

    beforeEach(() => {
      mockConfigUtils.getAllServers.mockReturnValue(mockServers);
    });

    it('should list all installed servers', async () => {
      const result = await service.listInstalledServers();

      expect(result).toEqual(['server1', 'server2', 'server3']);
      expect(mockConfigUtils.getAllServers).toHaveBeenCalled();
    });

    it('should filter only active servers when requested', async () => {
      const result = await service.listInstalledServers({ filterActive: true });

      expect(result).toEqual(['server1', 'server3']); // Excludes disabled server2
    });

    it('should handle empty server list', async () => {
      mockConfigUtils.getAllServers.mockReturnValue({});

      const result = await service.listInstalledServers();

      expect(result).toEqual([]);
    });

    it('should handle servers without disabled property', async () => {
      const serversWithoutDisabled = {
        server1: { type: 'stdio' },
        server2: { type: 'stdio' },
      };

      mockConfigUtils.getAllServers.mockReturnValue(serversWithoutDisabled);

      const result = await service.listInstalledServers({ filterActive: true });

      expect(result).toEqual(['server1', 'server2']); // All treated as active
    });

    it('should handle additional list options', async () => {
      const options = {
        filterActive: true,
        includeDisabled: false,
        includeOutdated: false,
      };

      const result = await service.listInstalledServers(options);

      expect(result).toEqual(['server1', 'server3']);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complex installation workflow', async () => {
      const complexServer: RegistryServer = {
        name: 'complex-server',
        version: '1.0.0',
        description: 'Complex server with configuration',
        remotes: [
          { type: 'docker', url: 'docker://complex-server:1.0.0' },
          { type: 'streamable-http', url: 'npx:complex-server@1.0.0' },
        ],
        status: 'active',
        repository: { source: 'github', url: 'https://github.com/test/complex-server' } as any,
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            isLatest: true,
            publishedAt: new Date().toISOString(),
            status: 'active' as const,
            updatedAt: new Date().toISOString(),
          },
        } as any,
      } as any;

      // Simulate search-based resolution
      mockRegistryClientInstance.getServerById.mockRejectedValueOnce(new Error('Not found'));
      mockRegistryClientInstance.searchServers.mockResolvedValue([
        { name: 'io.github/user/complex-server', version: '1.0.0' },
      ]);
      mockRegistryClientInstance.getServerById.mockResolvedValueOnce(complexServer);

      const result = await service.installServer('complex-server');

      expect(result.success).toBe(true);
      expect(result.config?.command).toBe('npx:complex-server@1.0.0'); // Prioritized streamable-http
      expect(mockRegistryClientInstance.searchServers).toHaveBeenCalled();
    });

    it('should handle error recovery scenarios', async () => {
      // Test network error handling with search fallback
      mockRegistryClientInstance.getServerById.mockRejectedValueOnce(new Error('Network timeout'));
      mockRegistryClientInstance.searchServers.mockRejectedValueOnce(new Error('Search service unavailable'));

      await expect(service.installServer('unreachable-server')).rejects.toThrow(
        "Server 'unreachable-server' not found in registry. Suggestions:",
      );

      // Verify both direct lookup and search were attempted
      expect(mockRegistryClientInstance.getServerById).toHaveBeenCalledTimes(1);
      expect(mockRegistryClientInstance.searchServers).toHaveBeenCalledTimes(1);
    });

    it('should maintain operation ID consistency across methods', async () => {
      mockConfigUtils.getAllServers.mockReturnValue({
        'test-server': { type: 'stdio' },
      });

      mockConfigUtils.getInstallationMetadata.mockReturnValue({ version: '1.0.0' });
      mockRegistryClientInstance.getServerById.mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
        remotes: [{ type: 'streamable-http', url: 'npx:test' }],
      });
      mockConfigUtils.getServer.mockReturnValue({ type: 'stdio' });

      const installResult = await service.installServer('test-server');
      const updateResult = await service.updateServer('test-server');
      const uninstallResult = await service.uninstallServer('test-server');
      await service.checkForUpdates(['test-server']);

      expect(installResult.operationId).toMatch(/^op_\d+_[a-z0-9]{7}$/);
      expect(updateResult.operationId).toMatch(/^op_\d+_[a-z0-9]{7}$/);
      expect(uninstallResult.operationId).toMatch(/^op_\d+_[a-z0-9]{7}$/);

      // All operation IDs should be different
      const operationIds = [installResult.operationId, updateResult.operationId, uninstallResult.operationId];
      const uniqueIds = new Set(operationIds);
      expect(uniqueIds.size).toBe(3);
    });
  });
});

describe('createServerInstallationService', () => {
  it('should create a new ServerInstallationService instance', () => {
    const service = createServerInstallationService();

    expect(service).toBeInstanceOf(ServerInstallationService);
  });

  it('should create separate instances', () => {
    const service1 = createServerInstallationService();
    const service2 = createServerInstallationService();

    expect(service1).not.toBe(service2);
    expect(service1).toBeInstanceOf(ServerInstallationService);
    expect(service2).toBeInstanceOf(ServerInstallationService);
  });
});
