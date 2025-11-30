/**
 * Tests for installation handlers
 */
import { FlagManager } from '@src/core/flags/flagManager.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupInstallationHandlers,
  handleMcpInstall,
  handleMcpUninstall,
  handleMcpUpdate,
} from './installationHandlers.js';

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
  handleInstallMCPServer: vi.fn(),
  handleUninstallMCPServer: vi.fn(),
  handleUpdateMCPServer: vi.fn(),
}));

describe('installationHandlers', () => {
  let flagManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    flagManager = {
      isToolEnabled: vi.fn().mockReturnValue(true),
    } as any;
    (FlagManager.getInstance as any).mockReturnValue(flagManager);
  });

  afterEach(() => {
    cleanupInstallationHandlers();
  });

  describe('handleMcpInstall', () => {
    it('should execute install successfully when enabled', async () => {
      const { handleInstallMCPServer } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      const mockResult = {
        serverName: 'test-server',
        serverConfig: { command: 'node', args: ['server.js'] },
        success: true,
      };
      (handleInstallMCPServer as any).mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        command: 'node',
        args: ['server.js'],
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
      };

      const result = await handleMcpInstall(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: "MCP server 'test-server' installed successfully",
                serverName: 'test-server',
                serverConfig: { command: 'node', args: ['server.js'] },
                reloadRecommended: true,
              },
              null,
              2,
            ),
          },
        ],
      });
      expect(handleInstallMCPServer).toHaveBeenCalledWith(args);
    });

    it('should return error when installation tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
      };

      const result = await handleMcpInstall(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Installation tools are disabled',
              message: 'MCP server installation is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      });
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'installation', 'install');
    });

    it('should handle installation errors', async () => {
      const { handleInstallMCPServer } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      (handleInstallMCPServer as any).mockRejectedValue(new Error('Installation failed'));

      const args = {
        name: 'test-server',
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
      };

      const result = await handleMcpInstall(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Installation failed',
              message: 'Installation failed: Installation failed',
            }),
          },
        ],
        isError: true,
      });
    });
  });

  describe('handleMcpUninstall', () => {
    it('should execute uninstall successfully when enabled', async () => {
      const { handleUninstallMCPServer } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      const mockResult = {
        serverName: 'test-server',
        removed: true,
        success: true,
      };
      (handleUninstallMCPServer as any).mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        force: true,
        preserveConfig: false,
        graceful: true,
      };

      const result = await handleMcpUninstall(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: "MCP server 'test-server' uninstalled successfully",
                serverName: 'test-server',
                removed: true,
                gracefulShutdown: undefined,
                reloadRecommended: true,
              },
              null,
              2,
            ),
          },
        ],
      });
      expect(handleUninstallMCPServer).toHaveBeenCalledWith(args);
    });

    it('should return error when installation tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        preserveConfig: false,
        force: false,
        graceful: true,
      };

      const result = await handleMcpUninstall(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Installation tools are disabled',
              message: 'MCP server uninstallation is currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      });
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'installation', 'uninstall');
    });

    it('should handle uninstall errors', async () => {
      const { handleUninstallMCPServer } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      (handleUninstallMCPServer as any).mockRejectedValue(new Error('Uninstall failed'));

      const args = {
        name: 'test-server',
        preserveConfig: false,
        force: false,
        graceful: true,
      };

      const result = await handleMcpUninstall(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Uninstall failed',
              message: 'Uninstallation failed: Uninstall failed',
            }),
          },
        ],
        isError: true,
      });
    });

    it('should include gracefulShutdown from args', async () => {
      const { handleUninstallMCPServer } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      const mockResult = {
        serverName: 'test-server',
        removed: true,
        success: true,
      };
      (handleUninstallMCPServer as any).mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        preserveConfig: false,
        force: false,
        graceful: false,
      };

      const result = await handleMcpUninstall(args);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.gracefulShutdown).toBe(false);
    });
  });

  describe('handleMcpUpdate', () => {
    it('should execute update successfully when enabled', async () => {
      const { handleUpdateMCPServer } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      const mockResult = {
        serverName: 'test-server',
        previousConfig: { version: '1.0.0' },
        newConfig: { version: '2.0.0' },
        success: true,
      };
      (handleUpdateMCPServer as any).mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        version: '2.0.0',
        autoRestart: false,
        backup: true,
      };

      const result = await handleMcpUpdate(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: "MCP server 'test-server' updated successfully",
                serverName: 'test-server',
                previousConfig: { version: '1.0.0' },
                newConfig: { version: '2.0.0' },
                reloadRecommended: true,
              },
              null,
              2,
            ),
          },
        ],
      });
      expect(handleUpdateMCPServer).toHaveBeenCalledWith(args);
    });

    it('should return error when installation tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        autoRestart: false,
        backup: true,
      };

      const result = await handleMcpUpdate(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Installation tools are disabled',
              message: 'MCP server updates are currently disabled by configuration',
            }),
          },
        ],
        isError: true,
      });
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('1mcpTools', 'installation', 'update');
    });

    it('should handle update errors', async () => {
      const { handleUpdateMCPServer } = await import('@src/core/tools/handlers/serverManagementHandler.js');
      (handleUpdateMCPServer as any).mockRejectedValue(new Error('Update failed'));

      const args = {
        name: 'test-server',
        autoRestart: false,
        backup: true,
      };

      const result = await handleMcpUpdate(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Update failed',
              message: 'Update failed: Update failed',
            }),
          },
        ],
        isError: true,
      });
    });
  });

  describe('cleanupInstallationHandlers', () => {
    it('should cleanup without errors', () => {
      expect(() => cleanupInstallationHandlers()).not.toThrow();
    });
  });
});
