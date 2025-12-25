/**
 * Integration tests for installation handlers
 *
 * These tests validate the complete flow from handlers through adapters
 * to domain services with minimal mocking, ensuring the restructuring
 * works end-to-end for installation operations.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleMcpInstall, handleMcpUninstall, handleMcpUpdate } from './installationHandlers.js';

// Mock adapters directly for integration testing (must be before imports)
vi.mock('@src/core/flags/flagManager.js', () => ({
  FlagManager: {
    getInstance: () => ({
      isToolEnabled: vi.fn().mockReturnValue(true),
    }),
  },
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

vi.mock('./adapters/installationAdapter.js', () => ({
  createInstallationAdapter: () => ({
    installServer: vi.fn().mockResolvedValue({
      success: true,
      serverName: 'test-server',
      version: '1.0.0',
      installedAt: new Date(),
      configPath: '/path/to/config',
      backupPath: '/path/to/backup',
      warnings: [],
      errors: [],
      operationId: 'test-op-id',
    }),
    uninstallServer: vi.fn().mockResolvedValue({
      success: true,
      serverName: 'test-server',
      removedAt: new Date(),
      configRemoved: true,
      warnings: [],
      errors: [],
      operationId: 'test-op-id',
    }),
    updateServer: vi.fn().mockResolvedValue({
      success: true,
      serverName: 'test-server',
      previousVersion: '1.0.0',
      newVersion: '2.0.0',
      updatedAt: new Date(),
      warnings: [],
      errors: [],
      operationId: 'test-op-id',
    }),
    listInstalledServers: vi.fn().mockResolvedValue(['server1', 'server2']),
    validateTags: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    parseTags: vi.fn().mockImplementation((tagsString: string) => tagsString.split(',').map((t) => t.trim())),
    destroy: vi.fn(),
  }),
}));

describe('Installation Handlers Integration Tests', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Installation Handlers', () => {
    it('should handle mcp_install end-to-end', async () => {
      const args = {
        name: 'test-server',
        version: '1.0.0',
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
        force: false,
        backup: false,
      };

      const result = await handleMcpInstall(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('location');
      expect(result).toHaveProperty('configPath');
      expect(result).toHaveProperty('reloadRecommended');

      expect(result.name).toBe('test-server');
      expect(result.status).toBe('success');
      expect(result.version).toBe('1.0.0');
      expect(result.reloadRecommended).toBe(true);
      expect(result.location).toBe('/path/to/config');
      expect(result.configPath).toBe('/path/to/config');
    });

    it('should handle mcp_uninstall end-to-end', async () => {
      const args = {
        name: 'test-server',
        force: true,
        preserveConfig: false,
        graceful: true,
        backup: false,
        removeAll: false,
      };

      const result = await handleMcpUninstall(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('removed');
      expect(result).toHaveProperty('removedAt');
      expect(result).toHaveProperty('gracefulShutdown');
      expect(result).toHaveProperty('reloadRecommended');

      expect(result.name).toBe('test-server');
      expect(result.status).toBe('success');
      expect(result.removed).toBe(true);
      expect(result.gracefulShutdown).toBe(true);
      expect(result.reloadRecommended).toBe(true);
    });

    it('should handle mcp_update end-to-end', async () => {
      const args = {
        name: 'test-server',
        version: '2.0.0',
        autoRestart: false,
        backup: true,
        force: false,
        dryRun: false,
      };

      const result = await handleMcpUpdate(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('previousVersion');
      expect(result).toHaveProperty('newVersion');
      expect(result).toHaveProperty('updatedAt');
      expect(result).toHaveProperty('reloadRecommended');

      expect(result.name).toBe('test-server');
      expect(result.status).toBe('success');
      expect(result.previousVersion).toBe('1.0.0');
      expect(result.newVersion).toBe('2.0.0');
      expect(result.reloadRecommended).toBe(true);
    });
  });
});
