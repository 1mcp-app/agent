import printer from '@src/utils/ui/printer.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as configUtils from './utils/mcpServerConfig.js';
import * as serverUtils from './utils/serverUtils.js';
import { buildUninstallCommand, uninstallCommand } from './uninstall.js';

const mockRemoveConfiguredServerTarget = vi.fn();

// Mock printer
vi.mock('@src/utils/ui/printer.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    blank: vi.fn(),
    raw: vi.fn(),
    title: vi.fn(),
    subtitle: vi.fn(),
    keyValue: vi.fn(),
    table: vi.fn(),
  },
}));

// Mock dependencies
vi.mock('./utils/mcpServerConfig.js', () => ({
  initializeConfigContext: vi.fn(),
  serverTargetExists: vi.fn(),
}));

vi.mock('@src/domains/config-change/configChange.js', () => ({
  createConfigChangeService: vi.fn(() => ({
    removeConfiguredServerTarget: mockRemoveConfiguredServerTarget,
  })),
}));

vi.mock('./utils/serverUtils.js', () => ({
  checkServerInUse: vi.fn(() => false),
  validateServerName: vi.fn(),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('Uninstall Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configUtils.serverTargetExists as any).mockReturnValue(true);
    vi.mocked(serverUtils.checkServerInUse as any).mockReturnValue(false);
    mockRemoveConfiguredServerTarget.mockResolvedValue({
      status: 'changed',
      operation: 'remove',
      configPath: '/tmp/mcp.json',
      target: { name: 'ok', source: 'mcpServers' },
      changed: true,
      backup: { created: true, path: '/tmp/config.backup' },
      reload: { status: 'observed' },
      warnings: [],
    });
  });

  describe('buildUninstallCommand', () => {
    it('should configure command with correct options', () => {
      const yargsMock = {
        positional: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        example: vi.fn().mockReturnThis(),
      };

      buildUninstallCommand(yargsMock as any);

      expect(yargsMock.positional).toHaveBeenCalledWith('serverName', expect.anything());
      expect(yargsMock.option).toHaveBeenCalledWith('force', expect.anything());
      expect(yargsMock.option).toHaveBeenCalledWith('backup', expect.anything());
    });
  });

  describe('uninstallCommand', () => {
    it('should throw when server does not exist', async () => {
      vi.mocked(configUtils.serverTargetExists as any).mockReturnValue(false);
      const args = { serverName: 'missing', force: false, backup: true };
      await expect(uninstallCommand(args as any)).rejects.toThrow(/does not exist/);
    });

    it('should block uninstall when in use and not forced', async () => {
      vi.mocked(serverUtils.checkServerInUse as any).mockReturnValue(true);
      const args = { serverName: 'inuse', force: false, backup: true };
      await expect(uninstallCommand(args as any)).rejects.toThrow(/Server is in use/);
      expect(mockRemoveConfiguredServerTarget).not.toHaveBeenCalled();
    });

    it('should remove config through Config Change when allowed', async () => {
      const args = { serverName: 'ok', force: true, backup: true, 'remove-config': true };
      await uninstallCommand(args as any);
      expect(mockRemoveConfiguredServerTarget).toHaveBeenCalledWith({
        targetName: 'ok',
        operation: 'uninstall',
        backup: 'required',
      });
      expect(printer.success).toHaveBeenCalledWith(expect.stringMatching(/Successfully uninstalled/));
      expect(printer.keyValue).toHaveBeenCalledWith({
        'Backup created': '/tmp/config.backup',
        'Reload status': 'observed',
      });
    });

    it('should pass backup skip policy when --no-backup is set', async () => {
      const args = { serverName: 'ok', force: true, backup: false, 'remove-config': true };
      await uninstallCommand(args as any);

      expect(mockRemoveConfiguredServerTarget).toHaveBeenCalledWith({
        targetName: 'ok',
        operation: 'uninstall',
        backup: 'skip',
      });
    });

    it('should skip config removal when --no-remove-config', async () => {
      const args = { serverName: 'ok', force: true, backup: false, 'remove-config': false } as any;
      await uninstallCommand(args);
      expect(mockRemoveConfiguredServerTarget).not.toHaveBeenCalled();
      expect(printer.warn).toHaveBeenCalledWith(expect.stringMatching(/not removed/));
    });
  });
});
