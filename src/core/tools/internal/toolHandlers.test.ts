import { FlagManager } from '@src/core/flags/flagManager.js';
import { cleanupSearchHandler, handleSearchMCPServers } from '@src/core/tools/handlers/searchHandler.js';
import {
  handleDisableMCPServer as handleDisableBackend,
  handleEnableMCPServer as handleEnableBackend,
  handleInstallMCPServer as handleInstallBackend,
  handleMcpList as handleMcpListBackend,
  handleReloadOperation as handleReloadBackend,
  handleServerStatus as handleServerStatusBackend,
  handleUninstallMCPServer as handleUninstallBackend,
  handleUpdateMCPServer as handleUpdateBackend,
} from '@src/core/tools/handlers/serverManagementHandler.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupInternalToolHandlers,
  handleMcpDisable,
  handleMcpEnable,
  handleMcpInstall,
  handleMcpList,
  handleMcpReload,
  handleMcpSearch,
  handleMcpStatus,
  handleMcpUninstall,
  handleMcpUpdate,
} from './toolHandlers.js';

// Mock FlagManager
vi.mock('@src/core/flags/flagManager.js', () => ({
  FlagManager: {
    getInstance: vi.fn(() => ({
      isToolEnabled: vi.fn(() => true),
    })),
  },
}));

// Mock logger
vi.mock('@src/logger/logger.js', () => ({
  default: {
    error: vi.fn(),
  },
  debugIf: vi.fn(),
}));

// Mock search handler
vi.mock('@src/core/tools/handlers/searchHandler.js', () => ({
  handleSearchMCPServers: vi.fn(),
  cleanupSearchHandler: vi.fn(),
}));

// Mock server management handler
vi.mock('@src/core/tools/handlers/serverManagementHandler.js', () => ({
  handleInstallMCPServer: vi.fn(),
  handleUninstallMCPServer: vi.fn(),
  handleUpdateMCPServer: vi.fn(),
  handleEnableMCPServer: vi.fn(),
  handleDisableMCPServer: vi.fn(),
  handleMcpList: vi.fn(),
  handleServerStatus: vi.fn(),
  handleReloadOperation: vi.fn(),
}));

describe('toolHandlers', () => {
  let mockFlagManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFlagManager = {
      isToolEnabled: vi.fn(() => true),
    };
    (FlagManager.getInstance as any).mockReturnValue(mockFlagManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleMcpSearch', () => {
    it('should search MCP servers successfully', async () => {
      const mockResult = {
        servers: [
          {
            name: 'test-server',
            description: 'Test server',
            version: '1.0.0',
            registryId: 'npm:test-server',
            lastUpdated: '2024-01-01',
            status: 'active',
          },
        ],
        next_cursor: 'cursor123',
        count: 1,
      };

      (handleSearchMCPServers as any).mockResolvedValue(mockResult);

      const args = {
        query: 'test',
        status: 'active' as const,
        limit: 20,
        format: 'table' as const,
      };

      const result = await handleMcpSearch(args);

      expect(handleSearchMCPServers).toHaveBeenCalledWith(args);
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.servers).toHaveLength(1);
      expect(parsed.servers[0].name).toBe('test-server');
      expect(parsed.next_cursor).toBe('cursor123');
      expect(parsed.count).toBe(1);
    });

    it('should handle search errors', async () => {
      (handleSearchMCPServers as any).mockRejectedValue(new Error('Search failed'));

      const args = {
        query: 'test',
        status: 'active' as const,
        limit: 20,
        format: 'table' as const,
      };

      const result = await handleMcpSearch(args);

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Search failed');
      expect(parsed.message).toBe('Search failed');
    });
  });

  describe('handleMcpInstall', () => {
    it('should install MCP server successfully', async () => {
      const mockResult = {
        serverName: 'new-server',
        serverConfig: {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
        success: true,
      };

      (handleInstallBackend as any).mockResolvedValue(mockResult);

      const args = {
        name: 'new-server',
        command: 'node',
        args: ['server.js'],
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
      };

      const result = await handleMcpInstall(args);

      expect(mockFlagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'installation', 'install');
      expect(handleInstallBackend).toHaveBeenCalledWith(args);
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.message).toContain('new-server');
      expect(parsed.reloadRecommended).toBe(true);
    });

    it('should return error when installation tools are disabled', async () => {
      mockFlagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'new-server',
        command: 'node',
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
      };

      const result = await handleMcpInstall(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Installation tools are disabled');
    });

    it('should handle installation errors', async () => {
      (handleInstallBackend as any).mockRejectedValue(new Error('Installation failed'));

      const args = {
        name: 'new-server',
        command: 'node',
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
      };

      const result = await handleMcpInstall(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Installation failed');
    });
  });

  describe('handleMcpUninstall', () => {
    it('should uninstall MCP server successfully', async () => {
      const mockResult = {
        serverName: 'test-server',
        removed: true,
        success: true,
      };

      (handleUninstallBackend as any).mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        force: false,
        preserveConfig: false,
        graceful: true,
      };

      const result = await handleMcpUninstall(args);

      expect(mockFlagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'installation', 'uninstall');
      expect(handleUninstallBackend).toHaveBeenCalledWith(args);
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.reloadRecommended).toBe(true);
    });

    it('should return error when installation tools are disabled', async () => {
      mockFlagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        force: false,
        preserveConfig: false,
        graceful: true,
      };

      const result = await handleMcpUninstall(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Installation tools are disabled');
    });

    it('should handle uninstallation errors', async () => {
      (handleUninstallBackend as any).mockRejectedValue(new Error('Uninstall failed'));

      const args = {
        name: 'test-server',
        force: false,
        preserveConfig: false,
        graceful: true,
      };

      const result = await handleMcpUninstall(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Uninstallation failed');
    });
  });

  describe('handleMcpUpdate', () => {
    it('should update MCP server successfully', async () => {
      const mockResult = {
        serverName: 'test-server',
        previousConfig: {},
        newConfig: {},
        success: true,
      };

      (handleUpdateBackend as any).mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        version: '2.0.0',
        autoRestart: true,
        backup: true,
      };

      const result = await handleMcpUpdate(args);

      expect(mockFlagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'installation', 'update');
      expect(handleUpdateBackend).toHaveBeenCalledWith(args);
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.reloadRecommended).toBe(true);
    });

    it('should return error when installation tools are disabled', async () => {
      mockFlagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        autoRestart: true,
        backup: true,
      };

      const result = await handleMcpUpdate(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Installation tools are disabled');
    });

    it('should handle update errors', async () => {
      (handleUpdateBackend as any).mockRejectedValue(new Error('Update failed'));

      const args = {
        name: 'test-server',
        autoRestart: true,
        backup: true,
      };

      const result = await handleMcpUpdate(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Update failed');
    });
  });

  describe('handleMcpEnable', () => {
    it('should enable MCP server successfully', async () => {
      const mockResult = {
        serverName: 'test-server',
        enabled: true,
        restarted: false,
        success: true,
      };

      (handleEnableBackend as any).mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        restart: false,
      };

      const result = await handleMcpEnable(args);

      expect(mockFlagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'management', 'enable');
      expect(handleEnableBackend).toHaveBeenCalledWith(args);
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.reloadRecommended).toBe(true);
    });

    it('should return error when management tools are disabled', async () => {
      mockFlagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        restart: false,
      };

      const result = await handleMcpEnable(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Management tools are disabled');
    });

    it('should handle enable errors', async () => {
      (handleEnableBackend as any).mockRejectedValue(new Error('Enable failed'));

      const args = {
        name: 'test-server',
        restart: false,
      };

      const result = await handleMcpEnable(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Enable operation failed');
    });
  });

  describe('handleMcpDisable', () => {
    it('should disable MCP server successfully', async () => {
      const mockResult = {
        serverName: 'test-server',
        disabled: true,
        gracefulShutdown: true,
        success: true,
      };

      (handleDisableBackend as any).mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        graceful: true,
      };

      const result = await handleMcpDisable(args);

      expect(mockFlagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'management', 'disable');
      expect(handleDisableBackend).toHaveBeenCalledWith(args);
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.reloadRecommended).toBe(true);
    });

    it('should return error when management tools are disabled', async () => {
      mockFlagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        graceful: true,
      };

      const result = await handleMcpDisable(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Management tools are disabled');
    });

    it('should handle disable errors', async () => {
      (handleDisableBackend as any).mockRejectedValue(new Error('Disable failed'));

      const args = {
        name: 'test-server',
        graceful: true,
      };

      const result = await handleMcpDisable(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Disable operation failed');
    });
  });

  describe('handleMcpList', () => {
    it('should list MCP servers successfully', async () => {
      const mockResult = {
        servers: [
          { name: 'server1', status: 'enabled' },
          { name: 'server2', status: 'disabled' },
        ],
      };

      (handleMcpListBackend as any).mockResolvedValue(mockResult);

      const args = {
        status: 'all' as const,
        transport: undefined,
        tags: undefined,
        format: 'table' as const,
        verbose: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      expect(mockFlagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'management', 'list');
      expect(handleMcpListBackend).toHaveBeenCalledWith(args);
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.servers).toHaveLength(2);
      expect(parsed.count).toBe(2);
    });

    it('should return error when management tools are disabled', async () => {
      mockFlagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        status: 'all' as const,
        transport: undefined,
        tags: undefined,
        format: 'table' as const,
        verbose: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Management tools are disabled');
    });

    it('should handle list errors', async () => {
      (handleMcpListBackend as any).mockRejectedValue(new Error('List failed'));

      const args = {
        status: 'all' as const,
        transport: undefined,
        tags: undefined,
        format: 'table' as const,
        verbose: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('List operation failed');
    });
  });

  describe('handleMcpStatus', () => {
    it('should get MCP server status successfully', async () => {
      const mockResult = {
        server: {
          name: 'test-server',
          status: 'enabled',
          configured: true,
        },
      };

      (handleServerStatusBackend as any).mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        details: false,
        health: true,
      };

      const result = await handleMcpStatus(args);

      expect(mockFlagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'management', 'status');
      expect(handleServerStatusBackend).toHaveBeenCalledWith(args);
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.server).toBeDefined();
    });

    it('should return error when management tools are disabled', async () => {
      mockFlagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        details: false,
        health: true,
      };

      const result = await handleMcpStatus(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Management tools are disabled');
    });

    it('should handle status errors', async () => {
      (handleServerStatusBackend as any).mockRejectedValue(new Error('Status failed'));

      const args = {
        name: 'test-server',
        details: false,
        health: true,
      };

      const result = await handleMcpStatus(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Status operation failed');
    });
  });

  describe('handleMcpReload', () => {
    it('should reload MCP configuration successfully', async () => {
      const mockResult = {
        target: 'config',
        action: 'reloaded',
        timestamp: new Date().toISOString(),
        success: true,
      };

      (handleReloadBackend as any).mockResolvedValue(mockResult);

      const args = {
        target: 'config' as const,
        graceful: true,
        timeout: 30000,
      };

      const result = await handleMcpReload(args);

      expect(mockFlagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'management', 'reload');
      expect(handleReloadBackend).toHaveBeenCalledWith(args);
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.timestamp).toBeDefined();
    });

    it('should return error when management tools are disabled', async () => {
      mockFlagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        target: 'config' as const,
        graceful: true,
        timeout: 30000,
      };

      const result = await handleMcpReload(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Management tools are disabled');
    });

    it('should handle reload errors', async () => {
      (handleReloadBackend as any).mockRejectedValue(new Error('Reload failed'));

      const args = {
        target: 'config' as const,
        graceful: true,
        timeout: 30000,
      };

      const result = await handleMcpReload(args);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Reload operation failed');
    });
  });

  describe('cleanupInternalToolHandlers', () => {
    it('should call cleanup for search handler', () => {
      cleanupInternalToolHandlers();

      expect(cleanupSearchHandler).toHaveBeenCalled();
    });
  });
});
