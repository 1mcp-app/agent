/**
 * Tests for management handlers
 */
import { FlagManager } from '@src/core/flags/flagManager.js';
import { AdapterFactory } from '@src/core/tools/internal/adapters/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupManagementHandlers,
  handleMcpDisable,
  handleMcpEnable,
  handleMcpList,
  handleMcpReload,
  handleMcpStatus,
} from './managementHandlers.js';

// Mock dependencies
vi.mock('@src/core/flags/flagManager.js');
vi.mock('@src/logger/logger.js', () => ({
  default: {
    error: vi.fn(),
  },
  debugIf: vi.fn(),
  infoIf: vi.fn(),
  warnIf: vi.fn(),
  errorIf: vi.fn(),
  logger: {
    error: vi.fn(),
  },
}));

// Mock adapters
vi.mock('@src/core/tools/internal/adapters/index.js', () => ({
  AdapterFactory: {
    getManagementAdapter: vi.fn(),
    cleanup: vi.fn(),
    reset: vi.fn(),
  },
}));

describe('managementHandlers', () => {
  let flagManager: any;
  let mockManagementAdapter: any;

  beforeEach(() => {
    vi.clearAllMocks();
    flagManager = {
      isToolEnabled: vi.fn().mockReturnValue(true),
    } as any;
    (FlagManager.getInstance as any).mockReturnValue(flagManager);

    // Mock management adapter
    mockManagementAdapter = {
      listServers: vi.fn(),
      getServerStatus: vi.fn(),
      enableServer: vi.fn(),
      disableServer: vi.fn(),
      reloadConfiguration: vi.fn(),
      updateServerConfig: vi.fn(),
      validateServerConfig: vi.fn(),
      getServerUrl: vi.fn(),
    };
    (AdapterFactory.getManagementAdapter as any).mockReturnValue(mockManagementAdapter);
  });

  afterEach(() => {
    cleanupManagementHandlers();
    vi.restoreAllMocks();
  });

  describe('handleMcpEnable', () => {
    it('should execute enable successfully when enabled', async () => {
      const mockResult = {
        success: true,
        serverName: 'test-server',
        enabled: true,
        restarted: true,
        warnings: [],
        errors: [],
      };
      mockManagementAdapter.enableServer.mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        restart: true,
        graceful: true,
        timeout: 30,
      };

      const result = await handleMcpEnable(args);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.success).toBe(true);
      expect(resultData.message).toBe("MCP server 'test-server' enabled successfully");
      expect(resultData.serverName).toBe('test-server');
      expect(resultData.enabled).toBe(true);
      expect(resultData.restarted).toBe(true);
      expect(resultData.reloadRecommended).toBe(true);
      expect(mockManagementAdapter.enableServer).toHaveBeenCalledWith('test-server', {
        restart: true,
        graceful: true,
        timeout: 30,
        tags: undefined,
      });
    });

    it('should return error when management tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        restart: false,
        graceful: true,
        timeout: 30,
      };

      const result = await handleMcpEnable(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Management tools are disabled',
              message: 'MCP server management is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      });
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('internalTools', 'management', 'enable');
    });

    it('should handle enable errors', async () => {
      mockManagementAdapter.enableServer.mockRejectedValue(new Error('Enable failed'));

      const args = {
        name: 'test-server',
        restart: false,
        graceful: true,
        timeout: 30,
      };

      const result = await handleMcpEnable(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Enable failed',
              message: 'Enable operation failed: Enable failed',
            }),
          },
        ],
        isError: true,
      });
    });
  });

  describe('handleMcpDisable', () => {
    it('should execute disable successfully when enabled', async () => {
      const mockResult = {
        success: true,
        serverName: 'test-server',
        disabled: true,
        gracefulShutdown: true,
        warnings: [],
        errors: [],
      };
      mockManagementAdapter.disableServer.mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        graceful: true,
        timeout: 30,
        force: false,
      };

      const result = await handleMcpDisable(args);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.success).toBe(true);
      expect(resultData.message).toBe("MCP server 'test-server' disabled successfully");
      expect(resultData.serverName).toBe('test-server');
      expect(resultData.disabled).toBe(true);
      expect(resultData.gracefulShutdown).toBe(true);
      expect(resultData.reloadRecommended).toBe(true);
      expect(mockManagementAdapter.disableServer).toHaveBeenCalledWith('test-server', {
        graceful: true,
        timeout: 30,
        force: false,
        tags: undefined,
      });
    });

    it('should return error when management tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        graceful: true,
        timeout: 30,
        force: false,
      };

      const result = await handleMcpDisable(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Management tools are disabled',
              message: 'MCP server management is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      });
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('internalTools', 'management', 'disable');
    });

    it('should handle disable errors', async () => {
      mockManagementAdapter.disableServer.mockRejectedValue(new Error('Disable failed'));

      const args = {
        name: 'test-server',
        graceful: true,
        timeout: 30,
        force: false,
      };

      const result = await handleMcpDisable(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Disable failed',
              message: 'Disable operation failed: Disable failed',
            }),
          },
        ],
        isError: true,
      });
    });
  });

  describe('handleMcpList', () => {
    it('should execute list successfully when enabled', async () => {
      const mockResult = [
        {
          name: 'test-server',
          status: 'enabled',
          transport: 'stdio',
          config: {},
          url: 'http://localhost:3000',
          healthStatus: 'healthy',
          lastChecked: new Date().toISOString(),
          metadata: {},
        },
      ];
      mockManagementAdapter.listServers.mockResolvedValue(mockResult);

      const args = {
        status: 'enabled' as const,
        format: 'table' as const,
        detailed: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.servers).toHaveLength(1);
      expect(resultData.servers[0]).toMatchObject({
        name: 'test-server',
        status: 'enabled',
        transport: 'stdio',
      });
      expect(mockManagementAdapter.listServers).toHaveBeenCalledWith({
        status: 'enabled',
        transport: undefined,
        detailed: false,
        tags: undefined,
      });
    });

    it('should return error when management tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        status: 'enabled' as const,
        format: 'table' as const,
        detailed: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Management tools are disabled',
              message: 'MCP server management is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      });
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('internalTools', 'management', 'list');
    });

    it('should handle list errors', async () => {
      mockManagementAdapter.listServers.mockRejectedValue(new Error('List failed'));

      const args = {
        status: 'enabled' as const,
        format: 'table' as const,
        detailed: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'List failed',
              message: 'List operation failed: List failed',
            }),
          },
        ],
        isError: true,
      });
    });
  });

  describe('handleMcpStatus', () => {
    it('should execute status successfully when enabled', async () => {
      const mockResult = {
        name: 'test-server',
        status: 'enabled',
        configured: true,
      };
      mockManagementAdapter.getServerStatus.mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        details: true,
        health: true,
      };

      const result = await handleMcpStatus(args);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.name).toBe('test-server');
      expect(resultData.status).toBe('enabled');
      expect(resultData.configured).toBe(true);
      expect(mockManagementAdapter.getServerStatus).toHaveBeenCalledWith(args.name);
    });

    it('should return error when management tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        details: false,
        health: true,
        name: 'test-server',
      };

      const result = await handleMcpStatus(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Management tools are disabled',
              message: 'MCP server management is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      });
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('internalTools', 'management', 'status');
    });

    it('should handle status errors', async () => {
      mockManagementAdapter.getServerStatus.mockRejectedValue(new Error('Status failed'));

      const args = {
        details: false,
        health: true,
        name: 'test-server',
      };

      const result = await handleMcpStatus(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Status failed',
              message: 'Status operation failed: Status failed',
            }),
          },
        ],
        isError: true,
      });
    });

    it('should return status result directly', async () => {
      const mockResult = {
        name: 'test-server',
        status: 'enabled',
        timestamp: new Date().toISOString(),
      };
      mockManagementAdapter.getServerStatus.mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        details: false,
        health: true,
      };

      const result = await handleMcpStatus(args);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.name).toBe('test-server');
      expect(resultData.status).toBe('enabled');
      expect(resultData.timestamp).toBeDefined();
      expect(typeof resultData.timestamp).toBe('string');
    });
  });

  describe('handleMcpReload', () => {
    it('should execute reload successfully when enabled', async () => {
      const mockResult = {
        success: true,
        target: 'config',
        action: 'reloaded',
        timestamp: new Date().toISOString(),
        reloadedServers: [],
        warnings: [],
        errors: [],
      };
      mockManagementAdapter.reloadConfiguration.mockResolvedValue(mockResult);

      const args = {
        configOnly: true,
        graceful: true,
        timeout: 30000,
        force: false,
      };

      const result = await handleMcpReload(args);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.success).toBe(true);
      expect(resultData.message).toBe('Reload completed successfully for config');
      expect(resultData.target).toBe('config');
      expect(resultData.action).toBe('reloaded');
      expect(resultData.timestamp).toBeDefined();
      expect(mockManagementAdapter.reloadConfiguration).toHaveBeenCalledWith({
        server: undefined,
        configOnly: true,
        force: false,
        timeout: 30000,
      });
    });

    it('should return error when management tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        configOnly: true,
        graceful: true,
        timeout: 30000,
        force: false,
      };

      const result = await handleMcpReload(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Management tools are disabled',
              message: 'MCP server management is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      });
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('internalTools', 'management', 'reload');
    });

    it('should handle reload errors', async () => {
      mockManagementAdapter.reloadConfiguration.mockRejectedValue(new Error('Reload failed'));

      const args = {
        configOnly: true,
        graceful: true,
        timeout: 30000,
        force: false,
      };

      const result = await handleMcpReload(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Reload failed',
              message: 'Reload operation failed: Reload failed',
            }),
          },
        ],
        isError: true,
      });
    });
  });

  describe('cleanupManagementHandlers', () => {
    it('should cleanup without errors', () => {
      expect(() => cleanupManagementHandlers()).not.toThrow();
    });
  });
});
