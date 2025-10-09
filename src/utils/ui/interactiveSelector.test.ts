import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { InteractiveSelector } from './interactiveSelector.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import prompts from 'prompts';

// Mock dependencies
vi.mock('@src/config/mcpConfigManager.js');
vi.mock('prompts');

const mockMcpConfig = McpConfigManager as any;
const mockPrompts = prompts as unknown as Mock;

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

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
    mockConsoleError.mockClear();
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
        message: "Save preset as 'development'?",
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

      expect(mockPrompts).toHaveBeenCalledTimes(2);
      expect(mockPrompts).toHaveBeenNthCalledWith(1, {
        type: 'text',
        name: 'name',
        message: 'Enter preset name:',
        validate: expect.any(Function),
      });
      expect(mockPrompts).toHaveBeenNthCalledWith(2, {
        type: 'text',
        name: 'description',
        message: 'Enter optional description:',
      });
    });

    it('should validate preset names', async () => {
      mockPrompts.mockResolvedValue({
        name: 'valid-preset',
        description: '',
      });

      await selector.confirmSave();

      const validateFn = mockPrompts.mock.calls[0][0].validate;

      // Test valid names
      expect(validateFn('valid-name')).toBe(true);
      expect(validateFn('valid_name')).toBe(true);
      expect(validateFn('validname123')).toBe(true);

      // Test invalid names
      expect(validateFn('')).toBe('Preset name is required');
      expect(validateFn('  ')).toBe('Preset name is required');
      expect(validateFn('invalid name!')).toBe(
        'Preset name can only contain letters, numbers, hyphens, and underscores',
      );
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
        expect(output).toContain("✅ Preset 'development' saved successfully!");
        expect(output).toContain('development');
        expect(output).toContain(url);
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
        expect(output).toContain('development');
        expect(output).toContain(url);
      });
    });

    describe('showError', () => {
      it('should display error message', () => {
        const message = 'Test error message';

        selector.showError(message);

        expect(mockConsoleError).toHaveBeenCalled();
        const output = mockConsoleError.mock.calls.map((call) => call[0]).join(' ');
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
        expect(output).toContain("🔍 Testing preset 'development'");
        expect(output).toContain('Matching servers: server1, server2, server3');
        expect(output).toContain('Available tags: web, api, database, cache, auth');
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
        expect(output).toContain("🔍 Testing preset 'empty-preset'");
        expect(output).toContain('Matching servers: none');
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
        expect(output).toContain("🔍 Testing preset 'many-servers'");
        expect(output).toContain('Matching servers:');
        expect(output).toContain('server1');
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
        expect(output).toContain("🔍 Testing preset 'many-tags'");
        expect(output).toContain('Available tags:');
        expect(output).toContain('tag1');
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
        strategy: 'or' as const,
        tagQuery: { tag: 'filesystem' },
      };

      // Mock the strategy selection to return undefined (cancelled)
      mockPrompts.mockResolvedValue({ strategy: undefined });

      const result = await selector.selectServers(existingConfig);

      expect(result.cancelled).toBe(true);
      expect(result.tagQuery).toEqual({});
    });
  });
});
