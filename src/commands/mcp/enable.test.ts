import printer from '@src/utils/ui/printer.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as configUtils from './utils/mcpServerConfig.js';
import { enableCommand } from './enable.js';

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

vi.mock('./utils/mcpServerConfig.js', () => ({
  backupConfig: vi.fn(() => '/tmp/config.backup'),
  getServer: vi.fn(),
  initializeConfigContext: vi.fn(),
  reloadMcpConfig: vi.fn(),
  serverExists: vi.fn(),
  setServer: vi.fn(),
  validateConfigPath: vi.fn(),
}));

vi.mock('./utils/validation.js', () => ({
  validateServerName: vi.fn(),
}));

describe('enableCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configUtils.serverExists as any).mockReturnValue(true);
    vi.mocked(configUtils.getServer as any).mockReturnValue({
      type: 'stdio',
      command: 'echo',
      disabled: true,
    });
  });

  it('persists the enabled state without calling runtime reload', async () => {
    await enableCommand({
      name: 'test-server',
      config: '/tmp/test-config.json',
      'config-dir': '/tmp',
    });

    expect(configUtils.setServer).toHaveBeenCalledWith('test-server', expect.not.objectContaining({ disabled: true }));
    expect(configUtils.reloadMcpConfig).not.toHaveBeenCalled();
    expect(printer.success).toHaveBeenCalledWith("Successfully enabled server 'test-server'");
  });
});
