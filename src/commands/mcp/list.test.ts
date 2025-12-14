import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildListCommand, listCommand } from './list.js';

// Mock dependencies
vi.mock('./utils/mcpServerConfig.js', () => ({
  initializeConfigContext: vi.fn(),
  getAllServers: vi.fn(() => ({})),
  validateConfigPath: vi.fn(),
  parseTags: vi.fn((tags) => tags.split(',')),
}));

vi.mock('./utils/serverUtils.js', () => ({
  calculateServerStatus: vi.fn(() => 'installed'),
}));

vi.mock('./utils/validation.js', () => ({
  validateTags: vi.fn(),
}));

const consoleLogMock = vi.fn();
console.log = consoleLogMock;
const consoleErrorMock = vi.fn();
console.error = consoleErrorMock;

describe('List Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

      expect(consoleLogMock).toHaveBeenCalledWith('No MCP servers are configured.');
    });
  });
});
