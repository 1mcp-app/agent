import * as serverManagementIndex from '@src/domains/server-management/index.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as configUtils from './utils/configUtils.js';
import { buildInstallCommand, installCommand } from './install.js';

// Mock dependencies
vi.mock('@src/domains/server-management/index.js', () => {
  const installServer = vi.fn();
  const startOperation = vi.fn();
  const updateProgress = vi.fn();
  const completeOperation = vi.fn();
  const failOperation = vi.fn();
  return {
    createServerInstallationService: vi.fn(() => ({ installServer })),
    getProgressTrackingService: vi.fn(() => ({
      startOperation,
      updateProgress,
      completeOperation,
      failOperation,
    })),
  };
});

vi.mock('./utils/configUtils.js', () => {
  return {
    initializeConfigContext: vi.fn(),
    serverExists: vi.fn(),
    backupConfig: vi.fn(() => '/tmp/config.backup'),
    reloadMcpConfig: vi.fn(),
    setServer: vi.fn(),
    getAllServers: vi.fn(),
  };
});

vi.mock('./utils/serverUtils.js', () => ({
  generateOperationId: vi.fn(() => 'op_test_123'),
  parseServerNameVersion: vi.fn((input: string) => {
    const parts = input.split('@');
    return { name: parts[0], version: parts[1] };
  }),
  validateServerName: vi.fn(),
  validateVersion: vi.fn((v?: string) => (v ? /^\d+\.\d+\.\d+/.test(v) : true)),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const consoleLogMock = vi.fn();
console.log = consoleLogMock;

describe('Install Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configUtils.serverExists as any).mockReturnValue(false);
    vi.mocked((serverManagementIndex as any).createServerInstallationService().installServer).mockResolvedValue({
      success: true,
      serverName: 'test-server',
      version: '1.0.0',
      installedAt: new Date(),
      configPath: '/path/to/config',
      warnings: [],
      errors: [],
      operationId: 'op_test_123',
    });
  });

  describe('buildInstallCommand', () => {
    it('should configure command with correct options', () => {
      const yargsMock = {
        positional: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        example: vi.fn().mockReturnThis(),
      };

      buildInstallCommand(yargsMock as any);

      expect(yargsMock.positional).toHaveBeenCalledWith('serverName', expect.anything());
      expect(yargsMock.option).toHaveBeenCalledWith('force', expect.anything());
      expect(yargsMock.option).toHaveBeenCalledWith('dry-run', expect.anything());
      expect(yargsMock.option).toHaveBeenCalledWith('verbose', expect.anything());
    });
  });

  describe('installCommand', () => {
    it('should reject on invalid version format', async () => {
      const args = {
        serverName: 'test-server@bad',
        dryRun: false,
        force: false,
        verbose: false,
      };

      await expect(installCommand(args as any)).rejects.toThrow(/Invalid version format/);
      expect((serverManagementIndex as any).getProgressTrackingService().startOperation).not.toHaveBeenCalled();
    });

    it('should perform dry-run without invoking installation', async () => {
      const args = {
        serverName: 'test-server@1.2.3',
        dryRun: true,
        force: false,
        verbose: false,
      };

      await installCommand(args as any);

      expect((serverManagementIndex as any).createServerInstallationService().installServer).not.toHaveBeenCalled();
      expect((serverManagementIndex as any).getProgressTrackingService().startOperation).not.toHaveBeenCalled();
      expect(consoleLogMock).toHaveBeenCalled();
    });

    it('should throw if server exists and not forced', async () => {
      vi.mocked(configUtils.serverExists as any).mockReturnValue(true);
      const args = {
        serverName: 'exists@1.2.3',
        dryRun: false,
        force: false,
        verbose: false,
      };

      await expect(installCommand(args as any)).rejects.toThrow(/already exists/);
      expect((configUtils.backupConfig as any).mock.calls.length).toBe(0);
    });

    it('should create backup when reinstalling with --force and reload config', async () => {
      vi.mocked(configUtils.serverExists as any).mockReturnValue(true);
      const args = {
        serverName: 'test-server@1.2.3',
        dryRun: false,
        force: true,
        verbose: true,
      };

      await installCommand(args as any);

      expect((serverManagementIndex as any).getProgressTrackingService().startOperation).toHaveBeenCalledWith(
        'op_test_123',
        'install',
        5,
      );
      expect((serverManagementIndex as any).getProgressTrackingService().updateProgress).toHaveBeenCalled();
      expect((configUtils.backupConfig as any).mock.calls.length).toBeGreaterThan(0);
      expect((serverManagementIndex as any).createServerInstallationService().installServer).toHaveBeenCalledWith(
        'test-server',
        '1.2.3',
        expect.any(Object),
      );
      expect((configUtils.reloadMcpConfig as any).mock.calls.length).toBeGreaterThan(0);
      expect((serverManagementIndex as any).getProgressTrackingService().completeOperation).toHaveBeenCalled();
    });
  });
});
