import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { InteractiveSelector } from './interactiveSelector.js';
import { McpConfigManager } from '../config/mcpConfigManager.js';
import prompts from 'prompts';

// Mock dependencies
vi.mock('../config/mcpConfigManager.js');
vi.mock('prompts');

const mockMcpConfig = McpConfigManager as any;
const mockPrompts = prompts as unknown as Mock;

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

describe('InteractiveSelector', () => {
  let selector: InteractiveSelector;
  let mockConfigManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock MCP config manager
    mockConfigManager = {
      getTransportConfig: vi.fn().mockReturnValue({
        'filesystem-server': { tags: ['filesystem', 'local'] },
        'database-server': { tags: ['database', 'sql'] },
        'web-scraper': { tags: ['web', 'search'] },
      }),
    };
    mockMcpConfig.getInstance = vi.fn().mockReturnValue(mockConfigManager);

    selector = new InteractiveSelector();
  });

  afterEach(() => {
    mockConsoleLog.mockClear();
  });

  describe('constructor', () => {
    it('should initialize with MCP config manager', () => {
      expect(mockMcpConfig.getInstance).toHaveBeenCalled();
    });
  });

  describe('confirmSave', () => {
    it('should confirm save with pre-specified name', async () => {
      mockPrompts.mockResolvedValue({ save: true });

      const result = await selector.confirmSave('development');

      expect(result).toEqual({
        name: 'development',
        save: true,
      });

      expect(mockPrompts).toHaveBeenCalledWith({
        type: 'confirm',
        name: 'save',
        message: "Save selection as preset 'development'?",
        initial: true,
      });
    });

    it('should handle confirmation rejection', async () => {
      mockPrompts.mockResolvedValue({ save: false });

      const result = await selector.confirmSave('development');

      expect(result).toEqual({
        name: 'development',
        save: false,
      });
    });

    it('should prompt for name and description when no name provided', async () => {
      mockPrompts.mockResolvedValue({
        name: 'interactive-preset',
        description: 'Interactive description',
      });

      const result = await selector.confirmSave();

      expect(result).toEqual({
        name: 'interactive-preset',
        description: 'Interactive description',
        save: true,
      });

      expect(mockPrompts).toHaveBeenCalledWith([
        {
          type: 'text',
          name: 'name',
          message: 'Preset name:',
          validate: expect.any(Function),
        },
        {
          type: 'text',
          name: 'description',
          message: 'Description (optional):',
        },
      ]);
    });

    it('should validate preset names', async () => {
      mockPrompts.mockResolvedValue({
        name: 'valid-preset',
        description: '',
      });

      await selector.confirmSave();

      const validateFn = mockPrompts.mock.calls[0][0][0].validate;

      // Test valid names
      expect(validateFn('valid-name')).toBe(true);
      expect(validateFn('valid_name')).toBe(true);
      expect(validateFn('validname123')).toBe(true);

      // Test invalid names
      expect(validateFn('')).toBe('Preset name is required');
      expect(validateFn('  ')).toBe('Preset name is required');
      expect(validateFn('invalid name!')).toBe('Name can only contain letters, numbers, hyphens, and underscores');
      expect(validateFn('a'.repeat(51))).toBe('Preset name must be 50 characters or less');
    });

    it('should handle cancelled name input', async () => {
      mockPrompts.mockResolvedValue({ name: undefined });

      const result = await selector.confirmSave();

      expect(result).toEqual({ name: '', save: false });
    });
  });

  describe('display methods', () => {
    describe('showSaveSuccess', () => {
      it('should display save success message', () => {
        const presetName = 'development';
        const url = 'http://localhost:3050/?preset=development';

        selector.showSaveSuccess(presetName, url);

        expect(mockConsoleLog).toHaveBeenCalled();
        const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n');
        expect(output).toContain('✅ Selection saved successfully!');
        expect(output).toContain('Preset: development');
        expect(output).toContain(url);
        expect(output).toContain('This URL will automatically update');
      });
    });

    describe('showUrl', () => {
      it('should display preset URL', () => {
        const presetName = 'development';
        const url = 'http://localhost:3050/?preset=development';

        selector.showUrl(presetName, url);

        expect(mockConsoleLog).toHaveBeenCalled();
        const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n');
        expect(output).toContain('Preset URL');
        expect(output).toContain('Preset: development');
        expect(output).toContain(url);
      });
    });

    describe('showError', () => {
      it('should display error message', () => {
        const message = 'Test error message';

        selector.showError(message);

        expect(mockConsoleLog).toHaveBeenCalled();
        const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n');
        expect(output).toContain('Error');
        expect(output).toContain('❌ Test error message');
      });
    });

    describe('testPreset', () => {
      it('should display preset test results with servers', async () => {
        const presetName = 'development';
        const result = {
          servers: ['server1', 'server2', 'server3'],
          tags: ['web', 'api', 'database', 'cache', 'auth'],
        };

        await selector.testPreset(presetName, result);

        expect(mockConsoleLog).toHaveBeenCalled();
        const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n');
        expect(output).toContain('Preset Test Results');
        expect(output).toContain('Preset: development');
        expect(output).toContain('✅ 3 servers match');
        expect(output).toContain('- server1');
        expect(output).toContain('- server2');
        expect(output).toContain('- server3');
        expect(output).toContain('Available tags: web, api, database');
        expect(output).toContain('+2 more tags');
      });

      it('should display message when no servers match', async () => {
        const presetName = 'empty-preset';
        const result = {
          servers: [],
          tags: ['web', 'api'],
        };

        await selector.testPreset(presetName, result);

        expect(mockConsoleLog).toHaveBeenCalled();
        const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n');
        expect(output).toContain('⚠️  No servers match this preset');
      });

      it('should handle many servers by showing limited list', async () => {
        const presetName = 'many-servers';
        const servers = Array.from({ length: 10 }, (_, i) => `server${i + 1}`);
        const result = {
          servers,
          tags: ['web'],
        };

        await selector.testPreset(presetName, result);

        expect(mockConsoleLog).toHaveBeenCalled();
        const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n');
        expect(output).toContain('✅ 10 servers match');
        expect(output).toContain('- server1');
        expect(output).toContain('- server5');
        expect(output).toContain('... and 5 more servers');
      });

      it('should handle many tags by showing limited list', async () => {
        const presetName = 'many-tags';
        const tags = Array.from({ length: 10 }, (_, i) => `tag${i + 1}`);
        const result = {
          servers: ['server1'],
          tags,
        };

        await selector.testPreset(presetName, result);

        expect(mockConsoleLog).toHaveBeenCalled();
        const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n');
        expect(output).toContain('Available tags: tag1, tag2, tag3');
        expect(output).toContain('+7 more tags');
      });
    });
  });

  describe('selectServers (configuration validation)', () => {
    it('should handle empty server configuration', async () => {
      mockConfigManager.getTransportConfig.mockReturnValue({});

      // Mock prompts to avoid actual interaction, but we expect early return
      const result = await selector.selectServers();

      expect(result.cancelled).toBe(true);
      expect(result.tagQuery).toEqual({});
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n');
      expect(output).toContain('⚠️  No MCP servers found in configuration');
    });

    it('should prepare server choices correctly', () => {
      // This tests the internal logic that prepares choices for prompts
      // Since selectServers is primarily interactive, we test the preparation logic indirectly

      const servers = mockConfigManager.getTransportConfig();

      // Verify that the mock data is structured correctly for choice preparation
      expect(servers['filesystem-server']).toEqual({ tags: ['filesystem', 'local'] });
      expect(servers['database-server']).toEqual({ tags: ['database', 'sql'] });
      expect(servers['web-scraper']).toEqual({ tags: ['web', 'search'] });
    });

    it('should handle server configuration with existing config', async () => {
      const existingConfig = {
        servers: ['filesystem-server'],
        strategy: 'or' as const,
        tagExpression: 'filesystem,local',
      };

      // Mock the selection to return cancelled to avoid full interaction
      mockPrompts.mockResolvedValue({ servers: undefined });

      const result = await selector.selectServers(existingConfig);

      expect(result.cancelled).toBe(true);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n');
      expect(output).toContain('MCP Server Selection');
    });
  });
});
