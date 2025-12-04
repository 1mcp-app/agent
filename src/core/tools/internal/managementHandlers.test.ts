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

      expect(result.status).toBe('success');
      expect(result.message).toBe("MCP server 'test-server' enabled successfully");
      expect(result.name).toBe('test-server');
      expect(result.enabled).toBe(true);
      expect(result.restarted).toBe(true);
      expect(result.reloadRecommended).toBe(true);
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
        name: 'test-server',
        status: 'failed',
        message: 'MCP server management is currently disabled by configuration',
        error: 'Management tools are disabled',
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
        name: 'test-server',
        status: 'failed',
        message: 'Enable operation failed: Enable failed',
        error: 'Enable failed',
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

      // Direct structured result - no need to parse
      expect(result.status).toBe('success');
      expect(result.message).toBe("MCP server 'test-server' disabled successfully");
      expect(result.name).toBe('test-server');
      expect(result.disabled).toBe(true);
      expect(result.gracefulShutdown).toBe(true);
      expect(result.reloadRecommended).toBe(true);
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
        name: 'test-server',
        status: 'failed',
        message: 'MCP server management is currently disabled by configuration',
        error: 'Management tools are disabled',
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
        name: 'test-server',
        status: 'failed',
        message: 'Disable operation failed: Disable failed',
        error: 'Disable failed',
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
      mockManagementAdapter.listServers.mockImplementation((_args: unknown) => Promise.resolve(mockResult));

      const args = {
        status: 'enabled' as const,
        format: 'table' as const,
        detailed: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      // Direct structured result - no need to parse
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0]).toMatchObject({
        name: 'test-server',
        status: 'enabled',
        transport: 'stdio',
      });
      expect(mockManagementAdapter.listServers).toHaveBeenCalledWith({
        status: 'enabled',
        transport: undefined, // args.transport is not provided in test args
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
        servers: [],
        total: 0,
        summary: {
          enabled: 0,
          disabled: 0,
          running: 0,
          stopped: 0,
        },
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
        servers: [],
        total: 0,
        summary: {
          enabled: 0,
          disabled: 0,
          running: 0,
          stopped: 0,
        },
      });
    });
  });

  describe('handleMcpStatus', () => {
    it('should execute status successfully when enabled', async () => {
      const mockResult = {
        servers: [
          {
            name: 'test-server',
            status: 'running',
            transport: 'stdio',
            healthStatus: 'healthy',
            lastChecked: new Date().toISOString(),
          },
        ],
        timestamp: new Date().toISOString(),
      };
      mockManagementAdapter.getServerStatus.mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        details: true,
        health: true,
      };

      const result = await handleMcpStatus(args);

      // Direct structured result - no need to parse
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0]).toMatchObject({
        name: 'test-server',
        status: 'running',
        transport: 'stdio',
        health: {
          status: 'healthy',
        },
      });
      expect(result.timestamp).toBeDefined();
      expect(result.overall).toEqual({
        total: 1,
        running: 1,
        stopped: 0,
        errors: 0,
      });
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
        servers: [],
        timestamp: expect.any(String),
        overall: {
          total: 0,
          running: 0,
          stopped: 0,
          errors: 0,
        },
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
        servers: [],
        timestamp: expect.any(String),
        overall: {
          total: 0,
          running: 0,
          stopped: 0,
          errors: 0,
        },
      });
    });

    it('should return status result directly', async () => {
      const mockResult = {
        servers: [
          {
            name: 'test-server',
            status: 'running',
            transport: 'stdio',
            healthStatus: 'healthy',
            lastChecked: new Date().toISOString(),
          },
        ],
        timestamp: new Date().toISOString(),
      };
      mockManagementAdapter.getServerStatus.mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        details: false,
        health: true,
      };

      const result = await handleMcpStatus(args);

      // Direct structured result - no need to parse
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0]).toMatchObject({
        name: 'test-server',
        status: 'running',
        transport: 'stdio',
        health: {
          status: 'healthy',
        },
      });
      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
      expect(result.overall).toEqual({
        total: 1,
        running: 1,
        stopped: 0,
        errors: 0,
      });
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

      // Direct structured result - no need to parse
      expect(result.status).toBe('success');
      expect(result.message).toBe('Reload completed successfully for config');
      expect(result.target).toBe('config');
      expect(result.action).toBe('reloaded');
      expect(result.timestamp).toBeDefined();
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
        target: 'config',
        status: 'failed',
        message: 'MCP server management is currently disabled by configuration',
        error: 'Management tools are disabled',
        timestamp: expect.any(String),
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
        target: 'config',
        status: 'failed',
        message: 'Reload operation failed: Reload failed',
        error: 'Reload failed',
        timestamp: expect.any(String),
      });
    });
  });

  describe('cleanupManagementHandlers', () => {
    it('should cleanup without errors', () => {
      expect(() => cleanupManagementHandlers()).not.toThrow();
    });
  });
});
