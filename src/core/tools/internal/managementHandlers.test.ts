/**
 * Tests for management handlers
 */
import { FlagManager } from '@src/core/flags/flagManager.js';

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

vi.mock('@src/core/tools/handlers/serverManagementHandler.js', () => ({
  handleEnableMCPServer: vi.fn(),
  handleDisableMCPServer: vi.fn(),
  handleMcpList: vi.fn(),
  handleServerStatus: vi.fn(),
  handleReloadOperation: vi.fn(),
}));

describe('managementHandlers', () => {
  let flagManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    flagManager = {
      isToolEnabled: vi.fn().mockReturnValue(true),
    } as any;
    (FlagManager.getInstance as any).mockReturnValue(flagManager);
  });

  afterEach(() => {
    cleanupManagementHandlers();
  });

  describe('handleMcpEnable', () => {
    it('should execute enable successfully when enabled', async () => {
      const { handleEnableMCPServer } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      const mockResult = {
        serverName: 'test-server',
        enabled: true,
        restarted: false,
        success: true,
      };
      (handleEnableMCPServer as any).mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        restart: true,
      };

      const result = await handleMcpEnable(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: "MCP server 'test-server' enabled successfully",
                serverName: 'test-server',
                enabled: true,
                restarted: false,
                reloadRecommended: true,
              },
              null,
              2,
            ),
          },
        ],
      });
      expect(handleEnableMCPServer).toHaveBeenCalledWith(args);
    });

    it('should return error when management tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        restart: false,
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
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'management', 'enable');
    });

    it('should handle enable errors', async () => {
      const { handleEnableMCPServer } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      (handleEnableMCPServer as any).mockRejectedValue(new Error('Enable failed'));

      const args = {
        name: 'test-server',
        restart: false,
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
      const { handleDisableMCPServer } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      const mockResult = {
        serverName: 'test-server',
        disabled: true,
        gracefulShutdown: true,
        success: true,
      };
      (handleDisableMCPServer as any).mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        graceful: true,
      };

      const result = await handleMcpDisable(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: "MCP server 'test-server' disabled successfully",
                serverName: 'test-server',
                disabled: true,
                gracefulShutdown: true,
                reloadRecommended: true,
              },
              null,
              2,
            ),
          },
        ],
      });
      expect(handleDisableMCPServer).toHaveBeenCalledWith(args);
    });

    it('should return error when management tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        graceful: true,
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
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'management', 'disable');
    });

    it('should handle disable errors', async () => {
      const { handleDisableMCPServer } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      (handleDisableMCPServer as any).mockRejectedValue(new Error('Disable failed'));

      const args = {
        name: 'test-server',
        graceful: true,
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
      const { handleMcpList: handleMcpListBackend } = await import(
        '@src/core/tools/handlers/serverManagementHandler.js'
      );
      const mockResult = {
        servers: [
          {
            name: 'test-server',
            status: 'enabled',
            transport: 'stdio',
          },
        ],
        total: 1,
        filtered: 1,
        filters: {},
        format: 'table',
      };
      (handleMcpListBackend as any).mockResolvedValue(mockResult);

      const args = {
        status: 'enabled' as const,
        format: 'table' as const,
        verbose: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(mockResult, null, 2),
          },
        ],
      });
      expect(handleMcpListBackend).toHaveBeenCalledWith(args);
    });

    it('should return error when management tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        status: 'enabled' as const,
        format: 'table' as const,
        verbose: false,
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
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'management', 'list');
    });

    it('should handle list errors', async () => {
      const { handleMcpList: handleMcpListBackend } = await import(
        '@src/core/tools/handlers/serverManagementHandler.js'
      );
      (handleMcpListBackend as any).mockRejectedValue(new Error('List failed'));

      const args = {
        status: 'enabled' as const,
        format: 'table' as const,
        verbose: false,
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
      const { handleServerStatus } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      const mockResult = {
        server: {
          name: 'test-server',
          status: 'enabled',
          configured: true,
        },
      };
      (handleServerStatus as any).mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        details: true,
        health: true,
      };

      const result = await handleMcpStatus(args);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData).toMatchObject({
        server: mockResult.server,
      });
      expect(resultData.timestamp).toBeDefined();
      expect(typeof resultData.timestamp).toBe('string');
      expect(handleServerStatus).toHaveBeenCalledWith(args);
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
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'management', 'status');
    });

    it('should handle status errors', async () => {
      const { handleServerStatus } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      (handleServerStatus as any).mockRejectedValue(new Error('Status failed'));

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

    it('should include timestamp in result', async () => {
      const { handleServerStatus } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      const mockResult = {
        servers: [],
        summary: { total: 0, enabled: 0, disabled: 0 },
      };
      (handleServerStatus as any).mockResolvedValue(mockResult);

      const args = {
        details: false,
        health: true,
      };

      const result = await handleMcpStatus(args);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.timestamp).toBeDefined();
      expect(typeof resultData.timestamp).toBe('string');
    });
  });

  describe('handleMcpReload', () => {
    it('should execute reload successfully when enabled', async () => {
      const { handleReloadOperation } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      const mockResult = {
        target: 'config',
        action: 'reloaded',
        timestamp: new Date().toISOString(),
        success: true,
      };
      (handleReloadOperation as any).mockResolvedValue(mockResult);

      const args = {
        target: 'config' as const,
        graceful: true,
        timeout: 30000,
      };

      const result = await handleMcpReload(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Reload completed successfully for config',
                target: 'config',
                action: 'reloaded',
                timestamp: mockResult.timestamp,
              },
              null,
              2,
            ),
          },
        ],
      });
      expect(handleReloadOperation).toHaveBeenCalledWith(args);
    });

    it('should return error when management tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        target: 'config' as const,
        graceful: true,
        timeout: 30000,
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
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'management', 'reload');
    });

    it('should handle reload errors', async () => {
      const { handleReloadOperation } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      (handleReloadOperation as any).mockRejectedValue(new Error('Reload failed'));

      const args = {
        target: 'config' as const,
        graceful: true,
        timeout: 30000,
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
