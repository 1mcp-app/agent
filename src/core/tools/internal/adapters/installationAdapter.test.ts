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

const mockRemoveConfiguredServerTarget = vi.fn();
const mockRunInstallationWorkflow = vi.fn();

vi.mock('@src/domains/server-management/serverInstallationService.js', () => ({
  createServerInstallationService: vi.fn(() => mockInstallationService),
}));

vi.mock('@src/domains/installation/serverInstallationWorkflow.js', () => ({
  createServerInstallationWorkflow: vi.fn(() => ({
    run: mockRunInstallationWorkflow,
  })),
}));

vi.mock('@src/domains/config-change/configChange.js', () => ({
  createConfigChangeService: vi.fn(() => ({
    removeConfiguredServerTarget: mockRemoveConfiguredServerTarget,
  })),
}));

vi.mock('@src/commands/mcp/utils/mcpServerConfig.js', () => ({
  getAllServers: vi.fn(),
  getServer: vi.fn(),
  setServer: vi.fn(),
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
    mockRunInstallationWorkflow.mockResolvedValue({
      status: 'applied',
      mode: 'apply',
      sourceType: 'registry',
      targetName: 'test-server',
      version: '1.0.0',
      warnings: [],
      configChange: {
        status: 'changed',
        operation: 'set_static',
        configPath: '/tmp/mcp.json',
        target: { name: 'test-server', source: 'mcpServers' },
        changed: true,
        backup: { created: true, path: '/tmp/mcp.json.backup.123' },
        retentionCleanup: { attempted: true, deletedPaths: [], warnings: [] },
        reload: { status: 'observed' },
        warnings: [],
      },
    });
    mockRemoveConfiguredServerTarget.mockResolvedValue({
      status: 'changed',
      operation: 'remove',
      configPath: '/tmp/mcp.json',
      target: { name: 'test-server', source: 'mcpServers' },
      changed: true,
      backup: { created: true, path: '/tmp/mcp.json.backup.123' },
      reload: { status: 'observed' },
      warnings: ['retention cleanup warning'],
    });
    adapter = createInstallationAdapter();
  });

  describe('installServer', () => {
    it('should install registry server through Server Installation Workflow', async () => {
      const result = await adapter.installServer('test-server', '1.0.0', {
        force: false,
        backup: true,
        tags: ['test'],
        env: { NODE_ENV: 'test' },
      });

      expect(result).toMatchObject({
        success: true,
        status: 'applied',
        serverName: 'test-server',
        version: '1.0.0',
        configPath: '/tmp/mcp.json',
        backupPath: '/tmp/mcp.json.backup.123',
        reloadStatus: 'observed',
        warnings: [],
        errors: [],
      });
      expect(mockInstallationService.installServer).not.toHaveBeenCalled();
      expect(mockRunInstallationWorkflow).toHaveBeenCalledWith({
        mode: 'apply',
        force: false,
        backup: 'required',
        source: {
          type: 'registry',
          registryId: 'test-server',
          version: '1.0.0',
          localName: undefined,
          tags: ['test'],
          env: { NODE_ENV: 'test' },
          args: undefined,
        },
      });
    });

    it('should install direct server through Server Installation Workflow', async () => {
      await adapter.installServer('direct-server', undefined, {
        force: true,
        backup: false,
        command: 'node',
        args: ['server.js'],
        tags: ['local'],
        env: { NODE_ENV: 'test' },
      });

      expect(mockRunInstallationWorkflow).toHaveBeenCalledWith({
        mode: 'apply',
        force: true,
        backup: 'skip',
        source: {
          type: 'direct',
          localName: 'direct-server',
          transport: 'stdio',
          command: 'node',
          url: undefined,
          args: ['server.js'],
          env: { NODE_ENV: 'test' },
          tags: ['local'],
          timeout: undefined,
          enabled: undefined,
          cwd: undefined,
          autoRestart: undefined,
          maxRestarts: undefined,
          restartDelay: undefined,
          package: undefined,
        },
      });
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
      mockRunInstallationWorkflow.mockRejectedValue(new Error('Installation failed'));

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

      const { createServerInstallationService } =
        await import('@src/domains/server-management/serverInstallationService.js');
      const mockService = (createServerInstallationService as any)();
      mockService.uninstallServer.mockResolvedValue(mockResult);

      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getAllServers as any).mockReturnValue({});

      const result = await adapter.uninstallServer('test-server', {
        force: true,
        backup: true,
        removeAll: true,
      });

      expect(result).toEqual({
        ...mockResult,
        configRemoved: true,
        backupPath: '/tmp/mcp.json.backup.123',
        warnings: ['retention cleanup warning'],
      });
      expect(mockService.uninstallServer).toHaveBeenCalledWith('test-server', {
        force: true,
        backup: true,
      });

      expect(mockRemoveConfiguredServerTarget).toHaveBeenCalledWith({
        targetName: 'test-server',
        operation: 'uninstall',
        backup: 'required',
      });
    });

    it('should pass backup skip policy to Config Change when removeAll uses no backup', async () => {
      const mockResult = {
        success: true,
        serverName: 'test-server',
        removedAt: new Date(),
        configRemoved: false,
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
      };

      const { createServerInstallationService } =
        await import('@src/domains/server-management/serverInstallationService.js');
      const mockService = (createServerInstallationService as any)();
      mockService.uninstallServer.mockResolvedValue(mockResult);

      await adapter.uninstallServer('test-server', {
        force: true,
        backup: false,
        removeAll: true,
      });

      expect(mockRemoveConfiguredServerTarget).toHaveBeenCalledWith({
        targetName: 'test-server',
        operation: 'uninstall',
        backup: 'skip',
      });
    });

    it('should handle uninstallation errors', async () => {
      const { createServerInstallationService } =
        await import('@src/domains/server-management/serverInstallationService.js');
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

      const { createServerInstallationService } =
        await import('@src/domains/server-management/serverInstallationService.js');
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
      const { createServerInstallationService } =
        await import('@src/domains/server-management/serverInstallationService.js');
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
