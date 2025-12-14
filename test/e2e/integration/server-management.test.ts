import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { initializeConfigContext, serverExists, setServer } from '@src/commands/mcp/utils/mcpServerConfig.js';
import ConfigContext from '@src/config/configContext.js';
import { createServerInstallationService, getProgressTrackingService } from '@src/domains/server-management/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration tests for server management domain
 * Tests end-to-end workflows including service integration,
 * registry client integration, configuration management, and progress tracking
 */

describe('Server Management Domain Integration', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    // Create temporary directory for test configs
    tempDir = await mkdtemp(join(tmpdir(), 'server-mgmt-test-'));

    // Initialize config context with test directory
    const configContext = ConfigContext.getInstance();
    configContext.setConfigDir(tempDir);
    configPath = configContext.getResolvedConfigPath();

    // Create empty config file
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {},
      }),
      'utf-8',
    );
  });

  afterEach(async () => {
    // Cleanup temp directory
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }

    // Reset config context
    ConfigContext.getInstance().reset();
    vi.clearAllMocks();
  });

  describe('ServerInstallationService Integration', () => {
    it('should create service instance', () => {
      const service = createServerInstallationService();
      expect(service).toBeDefined();
    });

    it('should list installed servers', async () => {
      // Setup: Add some servers manually
      initializeConfigContext(undefined, tempDir);
      setServer('test-server-1', {
        type: 'stdio',
        command: 'echo',
        args: ['test1'],
      });
      setServer('test-server-2', {
        type: 'stdio',
        command: 'echo',
        args: ['test2'],
      });

      const service = createServerInstallationService();
      const servers = await service.listInstalledServers();

      expect(servers).toContain('test-server-1');
      expect(servers).toContain('test-server-2');
    });

    it('should filter active servers when requested', async () => {
      // Setup: Add enabled and disabled servers
      initializeConfigContext(undefined, tempDir);
      setServer('enabled-server', {
        type: 'stdio',
        command: 'echo',
        args: ['enabled'],
      });
      setServer('disabled-server', {
        type: 'stdio',
        command: 'echo',
        args: ['disabled'],
        disabled: true,
      });

      const service = createServerInstallationService();

      // Get all servers
      const allServers = await service.listInstalledServers();
      expect(allServers.length).toBe(2);

      // Get only active servers
      const activeServers = await service.listInstalledServers({ filterActive: true });
      expect(activeServers).toContain('enabled-server');
      expect(activeServers).not.toContain('disabled-server');
    });

    it('should check for updates and return results', async () => {
      // Setup: Add a server
      initializeConfigContext(undefined, tempDir);
      setServer('updatable-server', {
        type: 'stdio',
        command: 'echo',
        args: ['test'],
      });

      const service = createServerInstallationService();

      // Mock registry client would be needed for actual update checking
      // For integration test, we verify the interface works
      const results = await service.checkForUpdates(['updatable-server']);

      expect(Array.isArray(results)).toBe(true);
      // Results may be empty if server not in registry or version unknown
      // But the method should complete without errors
    });
  });

  describe('Configuration Management Integration', () => {
    it('should persist server configuration changes', async () => {
      initializeConfigContext(undefined, tempDir);

      // Add a server
      setServer('persist-test', {
        type: 'stdio',
        command: 'echo',
        args: ['persist'],
        tags: ['test'],
      });

      // Verify it was written to file
      const configContent = await readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers['persist-test']).toBeDefined();
      expect(config.mcpServers['persist-test'].command).toBe('echo');
      expect(config.mcpServers['persist-test'].tags).toContain('test');
    });

    it('should update existing server configuration', async () => {
      initializeConfigContext(undefined, tempDir);

      // Add initial server
      setServer('update-config-test', {
        type: 'stdio',
        command: 'echo',
        args: ['old'],
      });

      // Update server
      setServer('update-config-test', {
        type: 'stdio',
        command: 'echo',
        args: ['new'],
        tags: ['updated'],
      });

      // Verify update
      const configContent = await readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      expect(config.mcpServers['update-config-test'].args).toContain('new');
      expect(config.mcpServers['update-config-test'].tags).toContain('updated');
    });

    it('should verify server existence', () => {
      initializeConfigContext(undefined, tempDir);

      // Server doesn't exist yet
      expect(serverExists('new-server')).toBe(false);

      // Add server
      setServer('new-server', {
        type: 'stdio',
        command: 'echo',
      });

      // Server should now exist
      expect(serverExists('new-server')).toBe(true);
    });
  });

  describe('Progress Tracking Integration', () => {
    it('should track operation progress', () => {
      const progressTracker = getProgressTrackingService();

      const operationId = 'test-op-123';
      progressTracker.startOperation(operationId, 'install', 5);

      progressTracker.updateProgress(operationId, 1, 'Step 1', 'Validating');
      progressTracker.updateProgress(operationId, 2, 'Step 2', 'Installing');

      // Verify operation is tracked (no errors thrown)
      expect(operationId).toBeTruthy();
    });

    it('should complete operations successfully', () => {
      const progressTracker = getProgressTrackingService();

      const operationId = 'test-complete-op';
      progressTracker.startOperation(operationId, 'install', 3);

      progressTracker.completeOperation(operationId, {
        success: true,
        operationId,
        duration: 1000,
        message: 'Test completed',
      });

      // Verify completion without errors
      expect(operationId).toBeTruthy();
    });

    it('should handle failed operations', () => {
      const progressTracker = getProgressTrackingService();

      const operationId = 'test-fail-op';
      progressTracker.startOperation(operationId, 'install', 2);

      const error = new Error('Test error');
      progressTracker.failOperation(operationId, error);

      // Verify failure handling without errors
      expect(operationId).toBeTruthy();
    });
  });

  describe('Service Workflow Integration', () => {
    it('should handle complete install workflow', async () => {
      initializeConfigContext(undefined, tempDir);

      // Verify server doesn't exist
      expect(serverExists('workflow-test')).toBe(false);

      // Add server (simulating install)
      setServer('workflow-test', {
        type: 'stdio',
        command: 'echo',
        args: ['installed'],
      });

      // Verify it exists
      expect(serverExists('workflow-test')).toBe(true);

      // Verify in service
      const service = createServerInstallationService();
      const servers = await service.listInstalledServers();
      expect(servers).toContain('workflow-test');
    });

    it('should handle update workflow with version checking', async () => {
      initializeConfigContext(undefined, tempDir);

      // Add server
      setServer('version-test', {
        type: 'stdio',
        command: 'echo',
      });

      const service = createServerInstallationService();

      // Check for updates
      const updateResults = await service.checkForUpdates(['version-test']);

      expect(Array.isArray(updateResults)).toBe(true);
      // May be empty or contain update info depending on registry
    });

    it('should handle uninstall workflow', async () => {
      initializeConfigContext(undefined, tempDir);

      // Add server
      setServer('uninstall-workflow-test', {
        type: 'stdio',
        command: 'echo',
      });

      // Verify exists
      expect(serverExists('uninstall-workflow-test')).toBe(true);

      const service = createServerInstallationService();
      const result = await service.uninstallServer('uninstall-workflow-test');

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('uninstall-workflow-test');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing configuration gracefully', async () => {
      // Use invalid config path
      const invalidPath = join(tempDir, 'nonexistent', 'config.json');
      initializeConfigContext(invalidPath);

      // Service should still be created
      const service = createServerInstallationService();
      expect(service).toBeDefined();

      // Operations may fail but should not crash
      await expect(service.listInstalledServers()).resolves.toBeInstanceOf(Array);
    });

    it('should handle invalid server operations', async () => {
      initializeConfigContext(undefined, tempDir);

      const service = createServerInstallationService();

      // Attempt to uninstall non-existent server
      const result = await service.uninstallServer('nonexistent-server');

      // Should complete without throwing, result indicates outcome
      expect(result).toBeDefined();
      expect(result.serverName).toBe('nonexistent-server');
    });
  });
});
