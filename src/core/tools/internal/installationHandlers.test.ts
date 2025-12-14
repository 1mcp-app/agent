/**
 * Tests for installation handlers
 */
import { FlagManager } from '@src/core/flags/flagManager.js';
import { AdapterFactory } from '@src/core/tools/internal/adapters/index.js';

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

// Mock adapters
vi.mock('@src/core/tools/internal/adapters/index.js', () => ({
  AdapterFactory: {
    getInstallationAdapter: vi.fn(),
    cleanup: vi.fn(),
    reset: vi.fn(),
  },
}));

describe('installationHandlers', () => {
  let flagManager: any;
  let mockInstallationAdapter: any;

  beforeEach(() => {
    vi.clearAllMocks();
    flagManager = {
      isToolEnabled: vi.fn().mockReturnValue(true),
    } as any;
    (FlagManager.getInstance as any).mockReturnValue(flagManager);

    // Mock installation adapter
    mockInstallationAdapter = {
      installServer: vi.fn(),
      uninstallServer: vi.fn(),
      updateServer: vi.fn(),
      listInstalledServers: vi.fn(),
      validateTags: vi.fn(),
      parseTags: vi.fn(),
    };
    (AdapterFactory.getInstallationAdapter as any).mockReturnValue(mockInstallationAdapter);
  });

  afterEach(() => {
    cleanupInstallationHandlers();
    vi.restoreAllMocks();
  });

  describe('handleMcpInstall', () => {
    it('should execute install successfully when enabled', async () => {
      const mockResult = {
        success: true,
        serverName: 'test-server',
        version: '1.0.0',
        installedAt: new Date(),
        configPath: '/path/to/config',
        backupPath: '/path/to/backup',
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
      };
      mockInstallationAdapter.installServer.mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        version: '1.0.0',
        package: 'test-server',
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
        force: false,
        backup: false,
      };

      const result = await handleMcpInstall(args);

      expect(result.status).toBe('success');
      expect(result.message).toBe("MCP server 'test-server' installed successfully");
      expect(result.name).toBe('test-server');
      expect(result.version).toBe('1.0.0');
      expect(result.installedAt).toBe(mockResult.installedAt.toISOString());
      expect(result.warnings).toEqual([]);
      expect(result.reloadRecommended).toBe(true);
      expect(mockInstallationAdapter.installServer).toHaveBeenCalledWith('test-server', '1.0.0', {
        force: false,
        backup: false,
        args: undefined,
        command: undefined,
        env: undefined,
        package: 'test-server',
        tags: undefined,
        transport: 'stdio',
        url: undefined,
      });
    });

    it('should return error when installation tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        version: '1.0.0',
        package: 'test-server',
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
        force: false,
        backup: false,
      };

      const result = await handleMcpInstall(args);

      expect(result).toEqual({
        name: 'test-server',
        status: 'failed',
        message: 'MCP server installation is currently disabled by configuration',
        error: 'Installation tools are disabled',
      });
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('internalTools', 'installation', 'install');
    });

    it('should handle installation errors', async () => {
      mockInstallationAdapter.installServer.mockRejectedValue(new Error('Installation failed'));

      const args = {
        name: 'test-server',
        version: '1.0.0',
        package: 'test-server',
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
        force: false,
        backup: false,
      };

      const result = await handleMcpInstall(args);

      expect(result).toEqual({
        name: 'test-server',
        status: 'failed',
        message: 'Installation failed: Installation failed',
        error: 'Installation failed',
      });
    });
  });

  describe('handleMcpUninstall', () => {
    it('should execute uninstall successfully when enabled', async () => {
      const mockResult = {
        success: true,
        serverName: 'test-server',
        removedAt: new Date(),
        configRemoved: false,
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
      };
      mockInstallationAdapter.uninstallServer.mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        force: true,
        preserveConfig: false,
        graceful: true,
        backup: false,
        removeAll: false,
      };

      const result = await handleMcpUninstall(args);

      expect(result.status).toBe('success');
      expect(result.message).toBe("MCP server 'test-server' uninstalled successfully");
      expect(result.name).toBe('test-server');
      expect(result.removedAt).toBe(mockResult.removedAt.toISOString());
      expect(result.configRemoved).toBe(false);
      expect(result.gracefulShutdown).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.reloadRecommended).toBe(true);
      expect(mockInstallationAdapter.uninstallServer).toHaveBeenCalledWith('test-server', {
        force: true,
        backup: false,
        removeAll: false,
      });
    });

    it('should return error when installation tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        preserveConfig: false,
        force: false,
        graceful: true,
        backup: false,
        removeAll: false,
      };

      const result = await handleMcpUninstall(args);

      expect(result).toEqual({
        name: 'test-server',
        status: 'failed',
        message: 'MCP server uninstallation is currently disabled by configuration',
        error: 'Installation tools are disabled',
      });
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('internalTools', 'installation', 'uninstall');
    });

    it('should handle uninstall errors', async () => {
      mockInstallationAdapter.uninstallServer.mockRejectedValue(new Error('Uninstall failed'));

      const args = {
        name: 'test-server',
        preserveConfig: false,
        force: false,
        graceful: true,
        backup: false,
        removeAll: false,
      };

      const result = await handleMcpUninstall(args);

      expect(result).toEqual({
        name: 'test-server',
        status: 'failed',
        message: 'Uninstallation failed: Uninstall failed',
        error: 'Uninstall failed',
      });
    });

    it('should include gracefulShutdown from args', async () => {
      const mockResult = {
        success: true,
        serverName: 'test-server',
        removedAt: new Date(),
        configRemoved: false,
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
      };
      mockInstallationAdapter.uninstallServer.mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        preserveConfig: false,
        force: false,
        graceful: false,
        backup: true,
        removeAll: false,
      };

      const result = await handleMcpUninstall(args);

      const resultData = result;
      expect(resultData.gracefulShutdown).toBe(false);
    });
  });

  describe('handleMcpUpdate', () => {
    it('should execute update successfully when enabled', async () => {
      const mockResult = {
        success: true,
        serverName: 'test-server',
        previousVersion: '1.0.0',
        newVersion: '2.0.0',
        updatedAt: new Date(),
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
      };
      mockInstallationAdapter.updateServer.mockResolvedValue(mockResult);

      const args = {
        name: 'test-server',
        version: '2.0.0',
        autoRestart: false,
        backup: true,
        force: false,
        dryRun: false,
      };

      const result = await handleMcpUpdate(args);

      expect(result.status).toBe('success');
      expect(result.message).toBe("MCP server 'test-server' updated successfully");
      expect(result.name).toBe('test-server');
      expect(result.previousVersion).toBe('1.0.0');
      expect(result.newVersion).toBe('2.0.0');
      expect(result.updatedAt).toBe(mockResult.updatedAt.toISOString());
      expect(result.warnings).toEqual([]);
      expect(result.reloadRecommended).toBe(true);
      expect(mockInstallationAdapter.updateServer).toHaveBeenCalledWith('test-server', '2.0.0', {
        force: false,
        backup: true,
        dryRun: false,
      });
    });

    it('should return error when installation tools are disabled', async () => {
      flagManager.isToolEnabled.mockReturnValue(false);

      const args = {
        name: 'test-server',
        autoRestart: false,
        backup: true,
        force: false,
        dryRun: false,
      };

      const result = await handleMcpUpdate(args);

      expect(result).toEqual({
        name: 'test-server',
        status: 'failed',
        message: 'MCP server updates are currently disabled by configuration',
        error: 'Installation tools are disabled',
      });
      expect(flagManager.isToolEnabled).toHaveBeenCalledWith('internalTools', 'installation', 'update');
    });

    it('should handle update errors', async () => {
      mockInstallationAdapter.updateServer.mockRejectedValue(new Error('Update failed'));

      const args = {
        name: 'test-server',
        autoRestart: false,
        backup: true,
        force: false,
        dryRun: false,
      };

      const result = await handleMcpUpdate(args);

      expect(result).toEqual({
        name: 'test-server',
        status: 'failed',
        message: 'Update failed: Update failed',
        error: 'Update failed',
      });
    });
  });

  describe('cleanupInstallationHandlers', () => {
    it('should cleanup without errors', () => {
      expect(() => cleanupInstallationHandlers()).not.toThrow();
    });
  });
});
