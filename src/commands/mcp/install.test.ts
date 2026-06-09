import * as serverManagementIndex from '@src/domains/server-management/index.js';
import { createServerInstallationWorkflow } from '@src/domains/installation/serverInstallationWorkflow.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildInstallCommand, installCommand } from './install.js';

// Mock dependencies
vi.mock('@src/domains/server-management/index.js', () => {
  const startOperation = vi.fn();
  const updateProgress = vi.fn();
  const completeOperation = vi.fn();
  const failOperation = vi.fn();
  return {
    getProgressTrackingService: vi.fn(() => ({
      startOperation,
      updateProgress,
      completeOperation,
      failOperation,
    })),
  };
});

const mockWorkflowRun = vi.fn();

vi.mock('@src/domains/installation/serverInstallationWorkflow.js', () => ({
  createServerInstallationWorkflow: vi.fn(() => ({
    run: mockWorkflowRun,
  })),
}));

vi.mock('./utils/mcpServerConfig.js', () => {
  return {
    initializeConfigContext: vi.fn(),
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
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  debugIf: vi.fn(),
  infoIf: vi.fn(),
  warnIf: vi.fn(),
}));

const consoleLogMock = vi.fn();
console.log = consoleLogMock;

describe('Install Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkflowRun.mockResolvedValue({
      status: 'applied',
      targetName: 'test-server',
      version: '1.0.0',
      warnings: [],
      configChange: {
        configPath: '/path/to/config',
        backup: {
          created: true,
          path: '/tmp/config.backup',
        },
        reload: {
          status: 'observed',
        },
      },
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
      mockWorkflowRun.mockResolvedValue({
        status: 'preview',
        targetName: 'test-server',
        version: '1.2.3',
        warnings: [],
      });
      const args = {
        serverName: 'test-server@1.2.3',
        dryRun: true,
        force: false,
        verbose: false,
      };

      await installCommand(args as any);

      expect(mockWorkflowRun).toHaveBeenCalledWith({
        mode: 'preview',
        force: false,
        source: {
          type: 'registry',
          registryId: 'test-server',
          version: '1.2.3',
          localName: 'test-server',
        },
      });
      expect((serverManagementIndex as any).getProgressTrackingService().startOperation).not.toHaveBeenCalled();
      expect(consoleLogMock).toHaveBeenCalled();
    });

    it('should throw workflow conflict if server exists and not forced', async () => {
      mockWorkflowRun.mockResolvedValue({
        status: 'exists',
        targetName: 'exists',
        warnings: [],
        error: "Server 'exists' already exists. Use force to replace it.",
      });
      const args = {
        serverName: 'exists@1.2.3',
        dryRun: false,
        force: false,
        verbose: false,
      };

      await expect(installCommand(args as any)).rejects.toThrow(/already exists/);
    });

    it('should apply through Server Installation Workflow when reinstalling with --force', async () => {
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
      expect(createServerInstallationWorkflow).toHaveBeenCalled();
      expect(mockWorkflowRun).toHaveBeenCalledWith({
        mode: 'apply',
        force: true,
        source: {
          type: 'registry',
          registryId: 'test-server',
          version: '1.2.3',
          localName: 'test-server',
        },
      });
      expect((serverManagementIndex as any).getProgressTrackingService().completeOperation).toHaveBeenCalled();
    });
  });
});
