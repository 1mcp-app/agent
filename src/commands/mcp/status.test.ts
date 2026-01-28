import printer from '@src/utils/ui/printer.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildStatusCommand, statusCommand, getFilteringSummary } from './status.js';

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
  getAllServers: vi.fn(() => ({})),
  getServer: vi.fn(),
  validateConfigPath: vi.fn(),
}));

vi.mock('./utils/validation.js', () => ({
  validateServerName: vi.fn(),
}));

vi.mock('@src/transport/transportFactory.js', () => ({
  inferTransportType: vi.fn((config) => config),
}));

describe('Status Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildStatusCommand', () => {
    it('should configure command with correct options', () => {
      const yargsMock = {
        positional: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        example: vi.fn().mockReturnThis(),
      };

      buildStatusCommand(yargsMock as any);

      expect(yargsMock.positional).toHaveBeenCalledWith('name', expect.anything());
      expect(yargsMock.option).toHaveBeenCalledWith('verbose', expect.anything());
      expect(yargsMock.example).toHaveBeenCalled();
    });
  });

  describe('getFilteringSummary', () => {
    it('should return null when no filtering configured', () => {
      const config = {
        command: 'npx',
        args: ['server.js'],
        type: 'stdio',
      };

      expect(getFilteringSummary(config as any)).toBeNull();
    });

    it('should return summary for disabled tools', () => {
      const config = {
        command: 'npx',
        args: ['server.js'],
        type: 'stdio',
        disabledTools: ['tool-a', 'tool-b', 'tool-c'],
      };

      expect(getFilteringSummary(config as any)).toBe('3 tools');
    });

    it('should return summary for enabled tools', () => {
      const config = {
        command: 'npx',
        args: ['server.js'],
        type: 'stdio',
        enabledTools: ['safe-tool'],
      };

      expect(getFilteringSummary(config as any)).toBe('1 tool (enabled)');
    });

    it('should return summary for disabled resources', () => {
      const config = {
        command: 'npx',
        args: ['server.js'],
        type: 'stdio',
        disabledResources: ['secret://*'],
      };

      expect(getFilteringSummary(config as any)).toBe('1 resource');
    });

    it('should return summary for enabled resources', () => {
      const config = {
        command: 'npx',
        args: ['server.js'],
        type: 'stdio',
        enabledResources: ['public://data', 'public://config'],
      };

      expect(getFilteringSummary(config as any)).toBe('2 resources (enabled)');
    });

    it('should return summary for disabled prompts', () => {
      const config = {
        command: 'npx',
        args: ['server.js'],
        type: 'stdio',
        disabledPrompts: ['admin-prompt'],
      };

      expect(getFilteringSummary(config as any)).toBe('1 prompt');
    });

    it('should return summary for enabled prompts', () => {
      const config = {
        command: 'npx',
        args: ['server.js'],
        type: 'stdio',
        enabledPrompts: ['safe-prompt'],
      };

      expect(getFilteringSummary(config as any)).toBe('1 prompt (enabled)');
    });

    it('should combine multiple filtering types', () => {
      const config = {
        command: 'npx',
        args: ['server.js'],
        type: 'stdio',
        disabledTools: ['dangerous-tool'],
        disabledResources: ['secret://*'],
        disabledPrompts: ['admin-prompt'],
      };

      expect(getFilteringSummary(config as any)).toBe('1 tool, 1 resource, 1 prompt');
    });

    it('should combine enabled and disabled filtering types', () => {
      const config = {
        command: 'npx',
        args: ['server.js'],
        type: 'stdio',
        enabledTools: ['safe-tool'],
        disabledResources: ['secret://*'],
        enabledPrompts: ['safe-prompt'],
      };

      expect(getFilteringSummary(config as any)).toBe('1 tool (enabled), 1 resource, 1 prompt (enabled)');
    });

    it('should handle all filtering types fully configured', () => {
      const config = {
        command: 'npx',
        args: ['server.js'],
        type: 'stdio',
        enabledTools: ['tool-a'],
        disabledTools: ['tool-b', 'tool-c'],
        enabledResources: ['res-a'],
        disabledResources: ['res-b', 'res-c'],
        enabledPrompts: ['prompt-a'],
        disabledPrompts: ['prompt-b', 'prompt-c'],
      };

      // Note: enabled takes precedence, so only enabled counts are shown
      expect(getFilteringSummary(config as any)).toBe('1 tool (enabled), 1 resource (enabled), 1 prompt (enabled)');
    });
  });

  describe('statusCommand', () => {
    it('should show filtering configuration when present', async () => {
      const mockServers = {
        'github': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          type: 'stdio',
          disabledTools: ['create_pull_request', 'merge_pull_request'],
          disabledPrompts: ['review_code'],
        },
      };

      const { getServer } = await import('./utils/mcpServerConfig.js');
      (getServer as vi.Mock).mockReturnValue(mockServers['github']);

      const args = {
        name: 'github',
        verbose: false,
      };

      await statusCommand(args as any);

      // Verify filtering info was printed
      expect(printer.subtitle).toHaveBeenCalledWith('Capability Filtering:');
      expect(printer.keyValue).toHaveBeenCalledWith({ 'Disabled Tools': 'create_pull_request, merge_pull_request' });
      expect(printer.keyValue).toHaveBeenCalledWith({ 'Disabled Prompts': 'review_code' });
    });

    it('should show enabled tools configuration', async () => {
      const mockServers = {
        'postgres': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-postgres'],
          type: 'stdio',
          enabledTools: ['query', 'list_tables', 'describe_table'],
          enabledResources: ['public://*'],
        },
      };

      const { getServer } = await import('./utils/mcpServerConfig.js');
      (getServer as vi.Mock).mockReturnValue(mockServers['postgres']);

      const args = {
        name: 'postgres',
        verbose: false,
      };

      await statusCommand(args as any);

      // Verify enabled filtering was printed
      expect(printer.subtitle).toHaveBeenCalledWith('Capability Filtering:');
      expect(printer.keyValue).toHaveBeenCalledWith({ 'Enabled Tools': 'query, list_tables, describe_table' });
      expect(printer.keyValue).toHaveBeenCalledWith({ 'Enabled Resources': 'public://*' });
    });

    it('should show message when no filtering configured', async () => {
      const mockServers = {
        'filesystem': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          type: 'stdio',
        },
      };

      const { getServer } = await import('./utils/mcpServerConfig.js');
      (getServer as vi.Mock).mockReturnValue(mockServers['filesystem']);

      const args = {
        name: 'filesystem',
        verbose: false,
      };

      await statusCommand(args as any);

      // Verify no filtering message was printed
      expect(printer.subtitle).toHaveBeenCalledWith('Capability Filtering:');
      expect(printer.info).toHaveBeenCalledWith('No capability filtering configured (all tools, resources, and prompts are exposed)');
    });

    it('should show all filtering types when configured', async () => {
      const mockServers = {
        'multi-filtered': {
          command: 'npx',
          args: ['-y', 'some-server'],
          type: 'stdio',
          enabledTools: ['safe_tool'],
          disabledTools: ['dangerous_tool'],
          enabledResources: ['safe://*'],
          disabledResources: ['secret://*'],
          enabledPrompts: ['safe_prompt'],
          disabledPrompts: ['admin_prompt'],
        },
      };

      const { getServer } = await import('./utils/mcpServerConfig.js');
      (getServer as vi.Mock).mockReturnValue(mockServers['multi-filtered']);

      const args = {
        name: 'multi-filtered',
        verbose: false,
      };

      await statusCommand(args as any);

      // Verify all filtering types are shown
      expect(printer.keyValue).toHaveBeenCalledWith({ 'Enabled Tools': 'safe_tool' });
      expect(printer.keyValue).toHaveBeenCalledWith({ 'Disabled Tools': 'dangerous_tool' });
      expect(printer.keyValue).toHaveBeenCalledWith({ 'Enabled Resources': 'safe://*' });
      expect(printer.keyValue).toHaveBeenCalledWith({ 'Disabled Resources': 'secret://*' });
      expect(printer.keyValue).toHaveBeenCalledWith({ 'Enabled Prompts': 'safe_prompt' });
      expect(printer.keyValue).toHaveBeenCalledWith({ 'Disabled Prompts': 'admin_prompt' });
    });

    it('should handle server not found error', async () => {
      const { getServer } = await import('./utils/mcpServerConfig.js');
      (getServer as vi.Mock).mockReturnValue(undefined);

      // Mock process.exit to prevent test from exiting
      const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      const args = {
        name: 'nonexistent',
        verbose: false,
      };

      await statusCommand(args as any);

      expect(printer.error).toHaveBeenCalledWith("Failed to get server status: Server 'nonexistent' does not exist.");
      expect(exitMock).toHaveBeenCalledWith(1);

      exitMock.mockRestore();
    });
  });
});
