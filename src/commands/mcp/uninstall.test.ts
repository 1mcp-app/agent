import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildUninstallCommand, uninstallCommand } from './uninstall.js';

// Mock dependencies
vi.mock('./utils/configUtils.js', () => ({
  initializeConfigContext: vi.fn(),
  serverExists: vi.fn(),
  backupConfig: vi.fn(),
  removeServer: vi.fn(),
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
}));

const consoleLogMock = vi.fn();
console.log = consoleLogMock;

describe('Uninstall Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    it('should validate server name', async () => {
      const args = {
        serverName: 'test-server',
        force: false,
        backup: true,
      };

      await expect(uninstallCommand(args as any)).rejects.toThrow();
    });
  });
});
