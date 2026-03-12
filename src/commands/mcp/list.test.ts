import printer from '@src/utils/ui/printer.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildListCommand, listCommand } from './list.js';

const mockedFns = vi.hoisted(() => ({
  mockGetAllServers: vi.fn(() => ({})),
  mockGetAllEffectiveServers: vi.fn(() => ({})),
  mockGetGlobalConfig: vi.fn(() => ({})),
}));

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
    table: vi.fn(),
    keyValue: vi.fn(),
    serverStatus: vi.fn(),
  },
}));

// Mock dependencies
vi.mock('./utils/mcpServerConfig.js', () => ({
  initializeConfigContext: vi.fn(),
  getAllServers: mockedFns.mockGetAllServers,
  getAllEffectiveServers: mockedFns.mockGetAllEffectiveServers,
  getGlobalConfig: mockedFns.mockGetGlobalConfig,
  validateConfigPath: vi.fn(),
  parseTags: vi.fn((tags) => tags.split(',')),
}));

vi.mock('./utils/serverUtils.js', () => ({
  calculateServerStatus: vi.fn(() => 'installed'),
}));

vi.mock('./utils/validation.js', () => ({
  validateTags: vi.fn(),
}));

describe('List Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFns.mockGetAllServers.mockReturnValue({});
    mockedFns.mockGetAllEffectiveServers.mockReturnValue({});
    mockedFns.mockGetGlobalConfig.mockReturnValue({});
  });

  describe('buildListCommand', () => {
    it('should configure command with correct options', () => {
      const yargsMock = {
        option: vi.fn().mockReturnThis(),
        example: vi.fn().mockReturnThis(),
      };

      buildListCommand(yargsMock as any);

      expect(yargsMock.option).toHaveBeenCalledWith('show-disabled', expect.anything());
      expect(yargsMock.option).toHaveBeenCalledWith('outdated', expect.anything());
    });
  });

  describe('listCommand', () => {
    it('should handle empty server list', async () => {
      const args = {
        'show-disabled': false,
        'show-secrets': false,
        verbose: false,
      };

      await listCommand(args as any);

      expect(printer.info).toHaveBeenCalledWith('No MCP servers are configured.');
    });
  });
});
