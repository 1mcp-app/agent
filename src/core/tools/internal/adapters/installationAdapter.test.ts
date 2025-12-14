import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInstallationAdapter, type InstallationAdapter } from './index.js';

const mockInstallationService = {
  installServer: vi.fn(),
  uninstallServer: vi.fn(),
  updateServer: vi.fn(),
  validateServerConfig: vi.fn(),
  checkServerConflicts: vi.fn(),
  checkForUpdates: vi.fn(),
  listInstalledServers: vi.fn(),
};

vi.mock('@src/domains/server-management/serverInstallationService.js', () => ({
  createServerInstallationService: vi.fn(() => mockInstallationService),
}));

vi.mock('@src/commands/mcp/utils/mcpServerConfig.js', () => ({
  getAllServers: vi.fn(),
  getServer: vi.fn(),
  setServer: vi.fn(),
  removeServer: vi.fn(),
  reloadMcpConfig: vi.fn(),
  getInstallationMetadata: vi.fn(),
}));

vi.mock('@src/domains/installation/configurators/tagsConfigurator.js', () => ({
  parseTags: vi.fn(() => ['tag1', 'tag2']),
  validateTags: vi.fn(() => ({ valid: true, errors: [] })),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
  debugIf: vi.fn(),
  infoIf: vi.fn(),
  warnIf: vi.fn(),
  errorIf: vi.fn(),
}));

describe('Installation Adapter', () => {
  let adapter: InstallationAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = createInstallationAdapter();
  });

  describe('installServer', () => {
    it('should install server successfully', async () => {
      const mockResult = {
        success: true,
        serverName: 'test-server',
        version: '1.0.0',
        installedAt: new Date(),
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
        config: { type: 'stdio', command: 'node', args: ['server.js'] },
      };

      const { createServerInstallationService } = await import(
        '@src/domains/server-management/serverInstallationService.js'
      );
      const mockService = (createServerInstallationService as any)();
      mockService.installServer.mockResolvedValue(mockResult);

      const { getServer, setServer } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getServer as any).mockReturnValue({ command: 'node', args: ['server.js'] });

      const result = await adapter.installServer('test-server', '1.0.0', {
        force: false,
        backup: true,
        tags: ['test'],
        env: { NODE_ENV: 'test' },
      });

      expect(result).toEqual(mockResult);
      expect(mockService.installServer).toHaveBeenCalledWith('test-server', '1.0.0', {
        force: false,
      });

      const { reloadMcpConfig } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      expect(setServer).toHaveBeenCalled();
      expect(reloadMcpConfig).toHaveBeenCalled();
    });

    it('should validate tags before installation', async () => {
      const { validateTags } = await import('@src/domains/installation/configurators/tagsConfigurator.js');
      (validateTags as any).mockReturnValue({ valid: false, errors: ['Invalid tag format'] });

      await expect(
        adapter.installServer('test-server', undefined, {
          tags: ['invalid-tag!'],
        }),
      ).rejects.toThrow('Invalid tags: Invalid tag format');
    });

    it('should handle installation errors', async () => {
      const { createServerInstallationService } = await import(
        '@src/domains/server-management/serverInstallationService.js'
      );
      const mockService = (createServerInstallationService as any)();
      mockService.installServer.mockRejectedValue(new Error('Installation failed'));

      await expect(adapter.installServer('test-server')).rejects.toThrow(
        'Server installation failed: Installation failed',
      );
    });
  });

  describe('uninstallServer', () => {
    it('should uninstall server successfully', async () => {
      const mockResult = {
        success: true,
        serverName: 'test-server',
        removedAt: new Date(),
        configRemoved: false,
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
      };

      const { createServerInstallationService } = await import(
        '@src/domains/server-management/serverInstallationService.js'
      );
      const mockService = (createServerInstallationService as any)();
      mockService.uninstallServer.mockResolvedValue(mockResult);

      const { getAllServers, removeServer } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getAllServers as any).mockReturnValue({});
      (removeServer as any).mockReturnValue(true);

      const result = await adapter.uninstallServer('test-server', {
        force: true,
        removeAll: true,
      });

      expect(result).toEqual(mockResult);
      expect(mockService.uninstallServer).toHaveBeenCalledWith('test-server', {
        force: true,
        backup: false,
      });

      const { reloadMcpConfig } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      expect(removeServer).toHaveBeenCalledWith('test-server');
      expect(reloadMcpConfig).toHaveBeenCalled();
    });

    it('should handle uninstallation errors', async () => {
      const { createServerInstallationService } = await import(
        '@src/domains/server-management/serverInstallationService.js'
      );
      const mockService = (createServerInstallationService as any)();
      mockService.uninstallServer.mockRejectedValue(new Error('Uninstall failed'));

      await expect(adapter.uninstallServer('test-server')).rejects.toThrow(
        'Server uninstallation failed: Uninstall failed',
      );
    });
  });

  describe('updateServer', () => {
    it('should update server successfully', async () => {
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

      const { createServerInstallationService } = await import(
        '@src/domains/server-management/serverInstallationService.js'
      );
      const mockService = (createServerInstallationService as any)();
      mockService.updateServer.mockResolvedValue(mockResult);

      const result = await adapter.updateServer('test-server', '2.0.0', {
        force: false,
        backup: true,
      });

      expect(result).toEqual(mockResult);
      expect(mockService.updateServer).toHaveBeenCalledWith('test-server', '2.0.0', {
        backup: true,
      });
    });

    it('should handle dry run updates', async () => {
      const mockUpdateCheck = {
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      };

      mockInstallationService.checkForUpdates.mockResolvedValue([mockUpdateCheck]);

      const result = await adapter.updateServer('test-server', undefined, {
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.previousVersion).toBe('1.0.0');
      expect(result.newVersion).toBe('2.0.0');
      expect(result.warnings).toContain('Dry run: Update available from 1.0.0 to 2.0.0');
    });

    it('should handle update errors', async () => {
      const { createServerInstallationService } = await import(
        '@src/domains/server-management/serverInstallationService.js'
      );
      const mockService = (createServerInstallationService as any)();
      mockService.updateServer.mockRejectedValue(new Error('Update failed'));

      await expect(adapter.updateServer('test-server')).rejects.toThrow('Server update failed: Update failed');
    });
  });

  describe('validateTags', () => {
    it('should validate tags successfully', async () => {
      const { validateTags } = await import('@src/domains/installation/configurators/tagsConfigurator.js');
      (validateTags as any).mockReturnValue({ valid: true, errors: [] });

      const result = adapter.validateTags(['tag1', 'tag2']);

      expect(result).toEqual({ valid: true, errors: [] });
      expect(validateTags).toHaveBeenCalledWith(['tag1', 'tag2']);
    });

    it('should handle tag validation errors', async () => {
      const { validateTags } = await import('@src/domains/installation/configurators/tagsConfigurator.js');
      (validateTags as any).mockImplementation(() => {
        throw new Error('Validation error');
      });

      const result = adapter.validateTags(['invalid']);

      expect(result).toEqual({ valid: false, errors: ['Validation error'] });
    });
  });

  describe('parseTags', () => {
    it('should parse tags successfully', async () => {
      const { parseTags } = await import('@src/domains/installation/configurators/tagsConfigurator.js');
      (parseTags as any).mockReturnValue(['tag1', 'tag2']);

      const result = adapter.parseTags('tag1, tag2');

      expect(result).toEqual(['tag1', 'tag2']);
      expect(parseTags).toHaveBeenCalledWith('tag1, tag2');
    });

    it('should handle tag parsing errors', async () => {
      // Use vi.doMock to override the mock for this specific test
      vi.doMock('@src/domains/installation/configurators/tagsConfigurator.js', () => ({
        parseTags: vi.fn(() => {
          throw new Error('Parse error');
        }),
        validateTags: vi.fn(() => ({ valid: true, errors: [] })),
      }));

      // Clear module registry to ensure fresh import
      vi.resetModules();

      // Import the adapter after mocking
      const { AdapterFactory } = await import('./index.js');
      const testAdapter = AdapterFactory.getInstallationAdapter();

      // parseTags is synchronous, so no await needed
      expect(() => testAdapter.parseTags('invalid')).toThrow('Tag parsing failed: Parse error');
    });
  });
});
