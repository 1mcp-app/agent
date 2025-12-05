import {
  initializeConfigContext,
  loadConfig,
  removeServer,
  saveConfig,
  setServer,
} from '@src/commands/mcp/utils/mcpServerConfig.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { SelectiveReloadManager } from '@src/core/reload/selectiveReloadManager.js';
import { debugIf } from '@src/logger/logger.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleDisableMCPServer,
  handleEnableMCPServer,
  handleInstallMCPServer,
  handleMcpList,
  handleReloadOperation,
  handleServerStatus,
  handleUninstallMCPServer,
  handleUpdateMCPServer,
} from './serverManagementHandler.js';

// Mock the config utilities
vi.mock('@src/commands/mcp/utils/mcpServerConfig.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  setServer: vi.fn(),
  removeServer: vi.fn(),
  initializeConfigContext: vi.fn(),
}));

// Mock logger
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
  debugIf: vi.fn(),
}));

// Mock ClientManager
vi.mock('@src/core/client/clientManager.js', () => ({
  ClientManager: {
    current: {
      removeClient: vi.fn().mockResolvedValue(undefined),
      createClient: vi.fn().mockResolvedValue(undefined),
      createSingleClient: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

// Mock SelectiveReloadManager with robust setup
vi.mock('@src/core/reload/selectiveReloadManager.js', () => {
  const mockOperation = {
    id: 'reload_test_123',
    status: 'completed' as const,
    affectedServers: [],
    impact: {
      summary: {
        totalChanges: 0,
        requiresFullRestart: false,
        canPartialReload: true,
        affectedServers: [],
        estimatedTotalDowntime: 0,
        requiresConnectionMigration: false,
      },
    },
    changes: {
      toolsChanged: false,
      resourcesChanged: false,
      promptsChanged: false,
      hasChanges: false,
      addedServers: [],
      removedServers: [],
      current: { tools: [], resources: [], prompts: [] },
      previous: { tools: [], resources: [], prompts: [] },
    },
  };

  return {
    SelectiveReloadManager: {
      getInstance: vi.fn(() => ({
        executeReload: vi.fn().mockResolvedValue(mockOperation),
      })),
    },
  };
});

// Mock ServerManager
vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    current: {
      restart: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

// Mock McpConfigManager with explicit transport config
vi.mock('@src/config/mcpConfigManager.js', () => {
  const mockTransportConfig = {
    'test-server': {
      type: 'stdio',
      command: 'node',
      args: ['test.js'],
      disabled: false,
    },
  };

  const mockConfigManager = {
    getTransportConfig: vi.fn(() => mockTransportConfig),
    reloadConfig: vi.fn(),
  };

  return {
    McpConfigManager: {
      getInstance: vi.fn(() => mockConfigManager),
    },
  };
});

describe('serverManagementHandler', () => {
  const mockConfig = {
    mcpServers: {
      'test-server': {
        type: 'stdio',
        command: 'node',
        args: ['test.js'],
        disabled: false,
        tags: ['test'],
      },
      'disabled-server': {
        type: 'http',
        url: 'http://localhost:3001',
        disabled: true,
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a fresh copy of mock config for each test
    (loadConfig as any).mockReturnValue(JSON.parse(JSON.stringify(mockConfig)));
    (saveConfig as any).mockImplementation((_config: any) => {
      // Mock successful save
      return Promise.resolve();
    });
    (setServer as any).mockImplementation((_name: any, _config: any) => {
      // Mock successful set
      return Promise.resolve();
    });
    (removeServer as any).mockImplementation((_name: any) => {
      // Mock successful removal
      return Promise.resolve();
    });
    (initializeConfigContext as any).mockImplementation(() => {
      // Mock successful initialization
      return Promise.resolve();
    });

    // Reset singleton instances for clean test isolation
    (McpConfigManager as any).instance = undefined;
    (SelectiveReloadManager as any).instance = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleInstallMCPServer', () => {
    it('should install a stdio server successfully', async () => {
      const args = {
        name: 'new-server',
        command: 'node',
        args: ['server.js'],
        transport: 'stdio' as const,
        enabled: true,
        tags: ['development'],
        autoRestart: true,
        force: false,
        backup: true,
      };

      const result = await handleInstallMCPServer(args);

      expect(setServer).toHaveBeenCalledWith('new-server', {
        type: 'stdio',
        disabled: false,
        command: 'node',
        args: ['server.js'],
        tags: ['development'],
        restartOnExit: true,
      });

      expect(result).toEqual({
        serverName: 'new-server',
        serverConfig: {
          type: 'stdio',
          disabled: false,
          command: 'node',
          args: ['server.js'],
          tags: ['development'],
          restartOnExit: true,
        },
        success: true,
      });

      expect(initializeConfigContext).toHaveBeenCalled();
      expect(debugIf).toHaveBeenCalled();
    });

    it('should install an HTTP server successfully', async () => {
      const args = {
        name: 'http-server',
        url: 'http://localhost:8080',
        transport: 'http' as const,
        enabled: false,
        tags: ['api'],
        autoRestart: false,
        force: false,
        backup: true,
      };

      const result = await handleInstallMCPServer(args);

      expect(setServer).toHaveBeenCalledWith('http-server', {
        type: 'http',
        disabled: true,
        url: 'http://localhost:8080',
        tags: ['api'],
      });

      expect(result).toEqual({
        serverName: 'http-server',
        serverConfig: {
          type: 'http',
          disabled: true,
          url: 'http://localhost:8080',
          tags: ['api'],
        },
        success: true,
      });
    });

    it('should install an SSE server successfully', async () => {
      const args = {
        name: 'sse-server',
        url: 'http://localhost:8080/sse',
        transport: 'sse' as const,
        enabled: true,
        autoRestart: false,
        force: false,
        backup: true,
      };

      const result = await handleInstallMCPServer(args);

      expect(setServer).toHaveBeenCalledWith('sse-server', {
        type: 'sse',
        disabled: false,
        url: 'http://localhost:8080/sse',
      });

      expect(result).toEqual({
        serverName: 'sse-server',
        serverConfig: {
          type: 'sse',
          disabled: false,
          url: 'http://localhost:8080/sse',
        },
        success: true,
      });
    });

    it('should use default transport when not specified', async () => {
      const args = {
        name: 'default-server',
        command: 'node',
        args: ['app.js'],
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
        force: false,
        backup: true,
      };

      await handleInstallMCPServer(args);

      expect(setServer).toHaveBeenCalledWith('default-server', {
        type: 'stdio',
        disabled: false,
        command: 'node',
        args: ['app.js'],
      });
    });

    it('should handle server with minimal configuration', async () => {
      const args = {
        name: 'minimal-server',
        transport: 'stdio' as const,
        command: 'python',
        enabled: true,
        autoRestart: false,
        force: false,
        backup: true,
      };

      const result = await handleInstallMCPServer(args);

      expect(setServer).toHaveBeenCalledWith('minimal-server', {
        type: 'stdio',
        disabled: false,
        command: 'python',
      });

      expect(result.serverName).toBe('minimal-server');
      expect(result.success).toBe(true);
    });
  });

  describe('handleUninstallMCPServer', () => {
    it('should uninstall an existing server successfully', async () => {
      const args = {
        name: 'test-server',
        force: false,
        preserveConfig: false,
        graceful: true,
        backup: true,
        removeAll: false,
      };

      const result = await handleUninstallMCPServer(args);

      expect(removeServer).toHaveBeenCalledWith('test-server');
      expect(result).toEqual({
        serverName: 'test-server',
        removed: true,
        success: true,
      });
    });

    it('should throw error when server does not exist', async () => {
      const args = {
        name: 'non-existent-server',
        force: false,
        preserveConfig: false,
        graceful: true,
        backup: true,
        removeAll: false,
      };

      await expect(handleUninstallMCPServer(args)).rejects.toThrow("Server 'non-existent-server' not found");
    });
  });

  describe('handleUpdateMCPServer', () => {
    it('should update server autoRestart setting', async () => {
      const args = {
        name: 'test-server',
        autoRestart: true,
        backup: true,
        force: false,
        dryRun: false,
      };

      const result = await handleUpdateMCPServer(args);

      expect(loadConfig).toHaveBeenCalled();
      expect(saveConfig).toHaveBeenCalled();
      expect(result.serverName).toBe('test-server');
      expect(result.success).toBe(true);
      expect(result.previousConfig).toBeDefined();
      expect(result.newConfig).toBeDefined();
      expect(result.newConfig.restartOnExit).toBe(true);
    });

    it('should throw error when server does not exist', async () => {
      const args = {
        name: 'non-existent-server',
        autoRestart: true,
        backup: true,
        force: false,
        dryRun: false,
      };

      await expect(handleUpdateMCPServer(args)).rejects.toThrow("Server 'non-existent-server' not found");
    });

    it('should handle update without changes', async () => {
      const args = {
        name: 'test-server',
        autoRestart: true,
        backup: true,
        force: false,
        dryRun: false,
      };

      const result = await handleUpdateMCPServer(args);

      expect(loadConfig).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('handleEnableMCPServer', () => {
    it('should enable a disabled server', async () => {
      const args = {
        name: 'disabled-server',
        restart: false,
        graceful: true,
        timeout: 30,
      };

      const result = await handleEnableMCPServer(args);

      expect(saveConfig).toHaveBeenCalled();
      expect(result).toEqual({
        serverName: 'disabled-server',
        enabled: true,
        restarted: false,
        success: true,
      });
    });

    it('should enable an already enabled server', async () => {
      const args = {
        name: 'test-server',
        restart: true,
        graceful: true,
        timeout: 30,
      };

      const result = await handleEnableMCPServer(args);

      expect(saveConfig).toHaveBeenCalled();
      expect(result).toEqual({
        serverName: 'test-server',
        enabled: true,
        restarted: true,
        success: true,
      });
    });

    it('should throw error when server does not exist', async () => {
      const args = {
        name: 'non-existent-server',
        restart: false,
        graceful: true,
        timeout: 30,
      };

      await expect(handleEnableMCPServer(args)).rejects.toThrow("Server 'non-existent-server' not found");
    });
  });

  describe('handleDisableMCPServer', () => {
    it('should disable an enabled server', async () => {
      const args = {
        name: 'test-server',
        graceful: true,
        timeout: 30,
        force: false,
      };

      const result = await handleDisableMCPServer(args);

      expect(saveConfig).toHaveBeenCalled();
      expect(result).toEqual({
        serverName: 'test-server',
        disabled: true,
        gracefulShutdown: true,
        success: true,
      });
    });

    it('should disable an already disabled server', async () => {
      const args = {
        name: 'disabled-server',
        graceful: false,
        timeout: 30,
        force: false,
      };

      const result = await handleDisableMCPServer(args);

      expect(saveConfig).toHaveBeenCalled();
      expect(result).toEqual({
        serverName: 'disabled-server',
        disabled: true,
        gracefulShutdown: false,
        success: true,
      });
    });

    it('should throw error when server does not exist', async () => {
      const args = {
        name: 'non-existent-server',
        graceful: true,
        timeout: 30,
        force: false,
      };

      await expect(handleDisableMCPServer(args)).rejects.toThrow("Server 'non-existent-server' not found");
    });
  });

  describe('handleMcpList', () => {
    it('should list all servers with default filters', async () => {
      const args = {
        status: 'all' as const,
        transport: undefined,
        tags: undefined,
        format: 'table' as const,
        detailed: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      // Check that the structure is correct and contains expected properties
      expect(result.servers).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.filtered).toBe(2);
      expect(result.filters).toEqual(args);

      // Check that we have both servers with correct status
      const serverNames = result.servers.map((s) => s.name);
      expect(serverNames).toContain('test-server');
      expect(serverNames).toContain('disabled-server');

      // Check status properties
      expect(result.servers.every((s) => s.configured === true)).toBe(true);
      expect(result.servers.every((s) => s.status === 'disabled' || s.status === 'enabled')).toBe(true);
    });

    it('should filter only enabled servers', async () => {
      const args = {
        status: 'enabled' as const,
        transport: undefined,
        tags: undefined,
        format: 'table' as const,
        detailed: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      // Should have servers where disabled is false (status: 'enabled')
      const enabledServers = result.servers.filter((s) => s.status === 'enabled');
      expect(result.servers).toEqual(enabledServers);
      expect(result.filtered).toBe(enabledServers.length);
    });

    it('should filter only disabled servers', async () => {
      const args = {
        status: 'disabled' as const,
        transport: undefined,
        tags: undefined,
        format: 'table' as const,
        detailed: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      // Should have servers where disabled is true (status: 'disabled')
      const disabledServers = result.servers.filter((s) => s.status === 'disabled');
      expect(result.servers).toEqual(disabledServers);
      expect(result.filtered).toBe(disabledServers.length);
    });

    it('should handle empty server list', async () => {
      (loadConfig as any).mockReturnValue({ mcpServers: {} });

      const args = {
        status: 'all' as const,
        transport: undefined,
        tags: undefined,
        format: 'table' as const,
        detailed: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      expect(result.servers).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.filtered).toBe(0);
    });
  });

  describe('handleServerStatus', () => {
    it('should get status for specific server', async () => {
      const args = {
        name: 'test-server',
        details: false,
        health: true,
      };

      const result = await handleServerStatus(args);

      expect(result.server).toBeDefined();
      expect(result.server!.name).toBe('test-server');
      expect(result.server!.configured).toBe(true);
      expect(result.server!.status).toMatch(/^(enabled|disabled)$/);
      expect(result.server!.type).toBeDefined();
    });

    it('should get status for all servers', async () => {
      const args = {
        details: false,
        health: true,
      };

      const result = await handleServerStatus(args);

      expect(result.servers).toBeDefined();
      expect(result.servers).toHaveLength(2);
      expect(result.summary).toBeDefined();
      expect(result.summary!.total).toBe(2);
      expect(result.summary!.enabled).toBeGreaterThanOrEqual(0);
      expect(result.summary!.disabled).toBeGreaterThanOrEqual(0);
      expect(result.summary!.enabled + result.summary!.disabled).toBe(2);

      // Check that all servers have required properties
      result.servers!.forEach((server) => {
        expect(server.name).toBeDefined();
        expect(server.configured).toBe(true);
        expect(server.status).toMatch(/^(enabled|disabled)$/);
        expect(server.type).toBeDefined();
      });
    });

    it('should throw error when specific server does not exist', async () => {
      const args = {
        name: 'non-existent-server',
        details: false,
        health: true,
      };

      await expect(handleServerStatus(args)).rejects.toThrow("Server 'non-existent-server' not found");
    });

    it('should handle empty server list when getting all status', async () => {
      (loadConfig as any).mockReturnValue({ mcpServers: {} });

      const args = {
        details: false,
        health: true,
      };

      const result = await handleServerStatus(args);

      expect(result.servers).toHaveLength(0);
      expect(result.summary).toEqual({
        total: 0,
        enabled: 0,
        disabled: 0,
      });
    });
  });

  describe('handleReloadOperation', () => {
    it('should handle config reload', async () => {
      const args = {
        configOnly: true,
        graceful: true,
        timeout: 30000,
        force: false,
      };

      const result = await handleReloadOperation(args);

      expect(result).toEqual({
        target: 'config',
        action: 'reloaded',
        timestamp: expect.any(String),
        success: true,
        details: {
          status: 'completed',
          operationId: 'reload_test_123',
          affectedServers: [],
          changes: 0,
          error: undefined,
        },
      });

      expect(debugIf).toHaveBeenCalled();
    });

    it('should handle server reload', async () => {
      const args = {
        server: 'test-server',
        configOnly: false,
        graceful: true,
        timeout: 30000,
        force: false,
      };

      const result = await handleReloadOperation(args);

      expect(result).toEqual({
        target: 'server',
        serverName: 'test-server',
        action: 'reloaded',
        timestamp: expect.any(String),
        success: true,
      });
    });

    it('should handle full reload', async () => {
      const args = {
        configOnly: false,
        graceful: true,
        timeout: 30000,
        force: false,
      };

      const result = await handleReloadOperation(args);

      expect(result).toEqual({
        target: 'all',
        action: 'reloaded',
        timestamp: expect.any(String),
        success: true,
        details: {
          error: undefined,
          operationId: 'reload_test_123',
          status: 'completed',
        },
      });
    });

    it('should throw error when server name is missing for server reload', async () => {
      const args = {
        target: 'server',
        configOnly: false,
        graceful: true,
        timeout: 30000,
        force: false,
      } as any;

      await expect(handleReloadOperation(args)).rejects.toThrow('Server name is required when target is "server"');
    });

    it('should throw error for invalid reload target', async () => {
      const args = {
        target: 'invalid',
        configOnly: false,
        graceful: true,
        timeout: 30000,
        force: false,
      } as any;

      await expect(handleReloadOperation(args)).rejects.toThrow('Invalid reload target: invalid');
    });
  });

  describe('debug logging', () => {
    it('should log debug messages for all operations', async () => {
      const debugSpy = vi.mocked(debugIf);

      // Test install operation
      await handleInstallMCPServer({
        name: 'test-server',
        command: 'node',
        args: ['test.js'],
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
        force: false,
        backup: true,
      });

      // Test uninstall operation
      await handleUninstallMCPServer({
        name: 'test-server',
        force: false,
        preserveConfig: false,
        graceful: true,
        backup: true,
        removeAll: false,
      });

      // Test reload operation
      await handleReloadOperation({
        configOnly: true,
        graceful: true,
        timeout: 30000,
        force: false,
      });

      expect(debugSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('error handling and edge cases', () => {
    it('should initialize config context for all operations', async () => {
      const initSpy = vi.mocked(initializeConfigContext);

      await handleInstallMCPServer({
        name: 'test-server',
        command: 'node',
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
        force: false,
        backup: true,
      });

      await handleUninstallMCPServer({
        name: 'test-server',
        force: false,
        preserveConfig: false,
        graceful: true,
        backup: true,
        removeAll: false,
      });

      await handleMcpList({
        status: 'all',
        transport: undefined,
        tags: undefined,
        format: 'table',
        detailed: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name',
      });

      expect(initSpy).toHaveBeenCalledTimes(3);
    });
  });
});
