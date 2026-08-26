import * as serverManagementIndex from '@src/domains/server-management/index.js';
import { createServerInstallationWorkflow } from '@src/domains/installation/serverInstallationWorkflow.js';
import { createRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import printer from '@src/utils/ui/printer.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildInstallCommand, installCommand } from './install.js';
import { InstallWizard } from './utils/installWizard.js';

const registryMocks = vi.hoisted(() => ({
  getServerById: vi.fn(),
  destroy: vi.fn(),
  wizardRun: vi.fn(),
  wizardCleanup: vi.fn(),
}));

vi.mock('@src/domains/registry/mcpRegistryClient.js', () => ({
  createRegistryClient: vi.fn(() => registryMocks),
  resolveRegistryClientOptions: vi.fn((options = {}) => ({
    baseUrl: options.url ?? 'https://registry.modelcontextprotocol.io',
    timeout: options.timeout ?? 10000,
    cache: {
      defaultTtl: options.cacheTtl ?? 300,
      maxSize: options.cacheMaxSize ?? 1000,
      cleanupInterval: options.cacheCleanupInterval ?? 60000,
    },
  })),
}));

vi.mock('./utils/installWizard.js', () => ({
  InstallWizard: vi.fn(function InstallWizard() {
    return { run: registryMocks.wizardRun, cleanup: registryMocks.wizardCleanup };
  }),
}));

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
    getAllServers: vi.fn(() => ({})),
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
        options: vi.fn().mockReturnThis(),
        example: vi.fn().mockReturnThis(),
      };

      buildInstallCommand(yargsMock as any);

      expect(yargsMock.positional).toHaveBeenCalledWith('serverName', expect.anything());
      expect(yargsMock.option).toHaveBeenCalledWith('force', expect.anything());
      expect(yargsMock.option).toHaveBeenCalledWith('dry-run', expect.anything());
      expect(yargsMock.option).toHaveBeenCalledWith('verbose', expect.anything());
      expect(yargsMock.options).toHaveBeenCalledWith(expect.objectContaining({ url: expect.anything() }));
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

    it('uses one effective registry configuration for lookup and origin output', async () => {
      mockWorkflowRun.mockResolvedValue({
        status: 'preview',
        targetName: 'test-server',
        warnings: [],
      });
      const infoSpy = vi.spyOn(printer, 'info');
      const args = {
        serverName: 'test-server',
        dryRun: true,
        url: 'https://registry.example.test',
        timeout: 4321,
        'cache-ttl': 123,
        'cache-max-size': 456,
        'cache-cleanup-interval': 789,
      };

      await installCommand(args as any);

      expect(createRegistryClient).toHaveBeenCalledWith({
        url: 'https://registry.example.test',
        timeout: 4321,
        cacheTtl: 123,
        cacheMaxSize: 456,
        cacheCleanupInterval: 789,
        proxy: undefined,
        proxyAuth: undefined,
      });
      const workflowPorts = vi.mocked(createServerInstallationWorkflow).mock.calls[0][0]!;
      await workflowPorts.getRegistryServer?.('test-server', '1.0.0');
      expect(registryMocks.getServerById).toHaveBeenCalledWith('test-server', '1.0.0');
      expect(infoSpy).toHaveBeenCalledWith('From registry: https://registry.example.test');
      expect(registryMocks.destroy).toHaveBeenCalledTimes(1);
    });

    it('shares the configured client between the interactive wizard and installation lookup', async () => {
      registryMocks.wizardRun.mockResolvedValue({
        cancelled: false,
        serverId: 'io.example/server',
        version: '1.0.0',
        localName: 'server',
        installAnother: false,
      });
      vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      vi.spyOn(console, 'clear').mockImplementation(() => undefined);

      await installCommand({ interactive: true, url: 'https://registry.example.test' } as any);

      expect(InstallWizard).toHaveBeenCalledWith(registryMocks);
      const workflowPorts = vi.mocked(createServerInstallationWorkflow).mock.calls[0][0]!;
      await workflowPorts.getRegistryServer?.('io.example/server', '1.0.0');
      expect(registryMocks.getServerById).toHaveBeenCalledWith('io.example/server', '1.0.0');
      expect(registryMocks.wizardCleanup).toHaveBeenCalled();
      expect(registryMocks.destroy).toHaveBeenCalledTimes(1);
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
