import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as configUtils from './utils/mcpServerConfig.js';
import * as serverUtils from './utils/serverUtils.js';
import { buildUninstallCommand, uninstallCommand } from './uninstall.js';

// Mock dependencies
vi.mock('./utils/mcpServerConfig.js', () => ({
  initializeConfigContext: vi.fn(),
  serverExists: vi.fn(),
  backupConfig: vi.fn(() => '/tmp/config.backup'),
  removeServer: vi.fn(() => true),
  reloadMcpConfig: vi.fn(),
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

const consoleLogMock = vi.fn();
console.log = consoleLogMock;

describe('Uninstall Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configUtils.serverExists as any).mockReturnValue(true);
    vi.mocked(serverUtils.checkServerInUse as any).mockReturnValue(false);
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
      vi.mocked(configUtils.serverExists as any).mockReturnValue(false);
      const args = { serverName: 'missing', force: false, backup: true };
      await expect(uninstallCommand(args as any)).rejects.toThrow(/does not exist/);
    });

    it('should block uninstall when in use and not forced', async () => {
      vi.mocked(serverUtils.checkServerInUse as any).mockReturnValue(true);
      const args = { serverName: 'inuse', force: false, backup: true };
      await expect(uninstallCommand(args as any)).rejects.toThrow(/Server is in use/);
      expect((configUtils.removeServer as any).mock.calls.length).toBe(0);
    });

    it('should remove config and reload when allowed', async () => {
      const args = { serverName: 'ok', force: true, backup: true, 'remove-config': true };
      await uninstallCommand(args as any);
      expect((configUtils.backupConfig as any).mock.calls.length).toBeGreaterThan(0);
      expect(configUtils.removeServer).toHaveBeenCalledWith('ok');
      expect((configUtils.reloadMcpConfig as any).mock.calls.length).toBeGreaterThan(0);
      expect(consoleLogMock).toHaveBeenCalledWith(expect.stringMatching(/Successfully uninstalled/));
    });

    it('should skip config removal when --no-remove-config', async () => {
      const args = { serverName: 'ok', force: true, backup: false, 'remove-config': false } as any;
      await uninstallCommand(args);
      expect((configUtils.removeServer as any).mock.calls.length).toBe(0);
      expect(consoleLogMock).toHaveBeenCalledWith(expect.stringMatching(/not removed/));
    });
  });
});
