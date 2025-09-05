import { describe, it, expect, beforeEach, vi } from 'vitest';
import { selectCommand } from './select.js';
import { PresetManager } from '../utils/presetManager.js';
import { InteractiveSelector } from '../utils/interactiveSelector.js';
import { UrlGenerator } from '../utils/urlGenerator.js';
import logger from '../logger/logger.js';

// Mock dependencies
vi.mock('../utils/presetManager.js');
vi.mock('../utils/interactiveSelector.js');
vi.mock('../utils/urlGenerator.js');
vi.mock('../logger/logger.js');

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

const mockPresetManager = PresetManager as any;
const mockInteractiveSelector = InteractiveSelector as any;
const mockUrlGenerator = UrlGenerator as any;

describe('selectCommand', () => {
  let mockPresetManagerInstance: any;
  let mockSelectorInstance: any;
  let mockUrlGeneratorInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock PresetManager instance
    mockPresetManagerInstance = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getPresetList: vi.fn(),
      deletePreset: vi.fn(),
      getPreset: vi.fn(),
      savePreset: vi.fn(),
      testPreset: vi.fn(),
      hasPreset: vi.fn(),
    };
    mockPresetManager.getInstance = vi.fn().mockReturnValue(mockPresetManagerInstance);

    // Mock InteractiveSelector instance
    mockSelectorInstance = {
      selectServers: vi.fn(),
      confirmSave: vi.fn(),
      showSaveSuccess: vi.fn(),
      showUrl: vi.fn(),
      showError: vi.fn(),
      testPreset: vi.fn(),
    };
    mockInteractiveSelector.mockImplementation(() => mockSelectorInstance);

    // Mock UrlGenerator instance
    mockUrlGeneratorInstance = {
      validateAndGeneratePresetUrl: vi.fn(),
      generatePresetUrl: vi.fn(),
    };
    mockUrlGenerator.mockImplementation(() => mockUrlGeneratorInstance);
  });

  afterEach(() => {
    mockConsoleLog.mockClear();
    mockProcessExit.mockClear();
  });

  describe('list mode', () => {
    it('should list presets when --list flag is used', async () => {
      const mockPresets = [
        {
          name: 'development',
          description: 'Dev preset',
          strategy: 'or' as const,
          serverCount: 2,
          tagExpression: 'web,api',
        },
        {
          name: 'production',
          strategy: 'and' as const,
          serverCount: 1,
          tagExpression: 'secure,prod',
        },
      ];

      mockPresetManagerInstance.getPresetList.mockReturnValue(mockPresets);

      await selectCommand({ _: ['select'], list: true });

      expect(mockConsoleLog).toHaveBeenCalled();
      expect(mockConsoleLog.mock.calls.some((call: any) => call[0].includes('Available Presets'))).toBe(true);
    });

    it('should show error when no presets exist', async () => {
      mockPresetManagerInstance.getPresetList.mockReturnValue([]);

      await selectCommand({ _: ['select'], list: true });

      expect(mockSelectorInstance.showError).toHaveBeenCalledWith(
        'No presets found. Create one with: 1mcp select --save <name>',
      );
    });
  });

  describe('delete mode', () => {
    it('should delete existing preset', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
      mockPresetManagerInstance.deletePreset.mockResolvedValue(true);

      await selectCommand({ _: ['select'], delete: 'test-preset' });

      expect(mockPresetManagerInstance.deletePreset).toHaveBeenCalledWith('test-preset');
      expect(mockConsoleLog).toHaveBeenCalledWith("✅ Preset 'test-preset' deleted successfully.\n");
    });

    it('should show error for non-existent preset', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(false);

      await selectCommand({ _: ['select'], delete: 'nonexistent' });

      expect(mockSelectorInstance.showError).toHaveBeenCalledWith("Preset 'nonexistent' not found");
    });

    it('should show error when deletion fails', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
      mockPresetManagerInstance.deletePreset.mockResolvedValue(false);

      await selectCommand({ _: ['select'], delete: 'test-preset' });

      expect(mockSelectorInstance.showError).toHaveBeenCalledWith("Failed to delete preset 'test-preset'");
    });
  });

  describe('url-only mode', () => {
    it('should generate URL for existing preset', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
      mockUrlGeneratorInstance.validateAndGeneratePresetUrl.mockResolvedValue({
        valid: true,
        url: 'http://localhost:3050/?preset=development',
      });

      await selectCommand({ _: ['select'], 'preset-name': 'development', 'url-only': true });

      expect(mockUrlGeneratorInstance.validateAndGeneratePresetUrl).toHaveBeenCalledWith('development');
      expect(mockSelectorInstance.showUrl).toHaveBeenCalledWith(
        'development',
        'http://localhost:3050/?preset=development',
      );
    });

    it('should show error for non-existent preset', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(false);

      await selectCommand({ _: ['select'], 'preset-name': 'nonexistent', 'url-only': true });

      expect(mockSelectorInstance.showError).toHaveBeenCalledWith("Preset 'nonexistent' not found");
    });

    it('should show error for invalid URL generation', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
      mockUrlGeneratorInstance.validateAndGeneratePresetUrl.mockResolvedValue({
        valid: false,
        url: '',
        error: 'Validation failed',
      });

      await selectCommand({ _: ['select'], 'preset-name': 'invalid', 'url-only': true });

      expect(mockSelectorInstance.showError).toHaveBeenCalledWith('Validation failed');
    });
  });

  describe('preview mode', () => {
    it('should preview existing preset', async () => {
      const testResult = {
        servers: ['server1', 'server2'],
        tags: ['web', 'api', 'database'],
      };

      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
      mockPresetManagerInstance.testPreset.mockResolvedValue(testResult);

      await selectCommand({ _: ['select'], 'preset-name': 'development', preview: true });

      expect(mockPresetManagerInstance.testPreset).toHaveBeenCalledWith('development');
      expect(mockSelectorInstance.testPreset).toHaveBeenCalledWith('development', testResult);
    });

    it('should show error for non-existent preset', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(false);

      await selectCommand({ _: ['select'], 'preset-name': 'nonexistent', preview: true });

      expect(mockSelectorInstance.showError).toHaveBeenCalledWith("Preset 'nonexistent' not found");
    });

    it('should handle test errors', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
      mockPresetManagerInstance.testPreset.mockRejectedValue(new Error('Test failed'));

      await selectCommand({ _: ['select'], 'preset-name': 'error-preset', preview: true });

      expect(mockSelectorInstance.showError).toHaveBeenCalledWith('Failed to test preset: Test failed');
    });
  });

  describe('load mode', () => {
    it('should load existing preset for editing', async () => {
      const mockPreset = {
        name: 'development',
        description: 'Dev preset',
        strategy: 'or' as const,
        servers: ['server1'],
        tagExpression: 'web,api',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
      };

      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
      mockPresetManagerInstance.getPreset.mockReturnValue(mockPreset);

      const selectionResult = {
        servers: ['server1', 'server2'],
        strategy: 'or' as const,
        tagExpression: 'web,api,database',
        cancelled: false,
      };
      mockSelectorInstance.selectServers.mockResolvedValue(selectionResult);
      mockUrlGeneratorInstance.generatePresetUrl.mockReturnValue('http://localhost:3050/?preset=development');

      await selectCommand({ _: ['select'], load: 'development' });

      expect(mockConsoleLog).toHaveBeenCalledWith('\n📝 Editing preset: development');
      expect(mockConsoleLog).toHaveBeenCalledWith('   Description: Dev preset');
      expect(mockSelectorInstance.selectServers).toHaveBeenCalledWith(mockPreset);
      expect(mockPresetManagerInstance.savePreset).toHaveBeenCalledWith('development', {
        description: 'Dev preset',
        strategy: 'or',
        tagQuery: undefined,
      });
    });

    it('should show error for non-existent preset', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(false);

      await selectCommand({ _: ['select'], load: 'nonexistent' });

      expect(mockSelectorInstance.showError).toHaveBeenCalledWith("Preset 'nonexistent' not found");
    });

    it('should handle null preset config', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
      mockPresetManagerInstance.getPreset.mockReturnValue(null);

      await selectCommand({ _: ['select'], load: 'invalid' });

      expect(mockSelectorInstance.showError).toHaveBeenCalledWith("Failed to load preset 'invalid'");
    });
  });

  describe('save mode', () => {
    it('should save preset with specified name', async () => {
      const selectionResult = {
        servers: ['server1', 'server2'],
        strategy: 'or' as const,
        tagExpression: 'web,api',
        cancelled: false,
      };

      mockSelectorInstance.selectServers.mockResolvedValue(selectionResult);
      mockUrlGeneratorInstance.generatePresetUrl.mockReturnValue('http://localhost:3050/?preset=new-preset');

      await selectCommand({
        _: ['select'],
        save: 'new-preset',
        description: 'New preset description',
      });

      expect(mockSelectorInstance.selectServers).toHaveBeenCalled();
      expect(mockPresetManagerInstance.savePreset).toHaveBeenCalledWith('new-preset', {
        description: 'New preset description',
        strategy: 'or',
        tagQuery: undefined,
      });
      expect(mockSelectorInstance.showSaveSuccess).toHaveBeenCalledWith(
        'new-preset',
        'http://localhost:3050/?preset=new-preset',
      );
    });
  });

  describe('url mode', () => {
    it('should prompt for save and show URL', async () => {
      const selectionResult = {
        servers: ['server1'],
        strategy: 'or' as const,
        tagExpression: 'web',
        cancelled: false,
      };

      const saveResult = {
        name: 'interactive-preset',
        description: 'Interactive description',
        save: true,
      };

      mockSelectorInstance.selectServers.mockResolvedValue(selectionResult);
      mockSelectorInstance.confirmSave.mockResolvedValue(saveResult);
      mockUrlGeneratorInstance.generatePresetUrl.mockReturnValue('http://localhost:3050/?preset=interactive-preset');

      await selectCommand({ _: ['select'], url: true });

      expect(mockSelectorInstance.selectServers).toHaveBeenCalled();
      expect(mockSelectorInstance.confirmSave).toHaveBeenCalled();
      expect(mockPresetManagerInstance.savePreset).toHaveBeenCalledWith('interactive-preset', {
        description: 'Interactive description',
        strategy: 'or',
        tagQuery: undefined,
      });
    });

    it('should handle cancelled save', async () => {
      const selectionResult = {
        servers: ['server1'],
        strategy: 'or' as const,
        tagExpression: 'web',
        cancelled: false,
      };

      const saveResult = {
        name: '',
        save: false,
      };

      mockSelectorInstance.selectServers.mockResolvedValue(selectionResult);
      mockSelectorInstance.confirmSave.mockResolvedValue(saveResult);

      await selectCommand({ _: ['select'], url: true });

      expect(mockPresetManagerInstance.savePreset).not.toHaveBeenCalled();
      expect(mockSelectorInstance.showSaveSuccess).not.toHaveBeenCalled();
    });
  });

  describe('basic interactive mode', () => {
    it('should show selection summary without saving', async () => {
      const selectionResult = {
        servers: ['server1', 'server2'],
        strategy: 'and' as const,
        tagExpression: 'web+api',
        cancelled: false,
      };

      mockSelectorInstance.selectServers.mockResolvedValue(selectionResult);

      await selectCommand({ _: ['select'] });

      expect(mockConsoleLog).toHaveBeenCalledWith('\n📋 Selection Summary:');
      expect(mockConsoleLog).toHaveBeenCalledWith('   Strategy: and');
      expect(mockConsoleLog).toHaveBeenCalledWith('   Query: undefined');
      expect(mockConsoleLog).toHaveBeenCalledWith('\nTo save this selection, use --save <name> or --url flags.');
    });

    it('should exit gracefully when cancelled', async () => {
      const selectionResult = {
        servers: [],
        strategy: 'or' as const,
        tagExpression: '',
        cancelled: true,
      };

      mockSelectorInstance.selectServers.mockResolvedValue(selectionResult);

      await selectCommand({ _: ['select'] });

      expect(mockConsoleLog).toHaveBeenCalledWith('Operation cancelled.');
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });

    it('should show summary when no servers selected but not cancelled', async () => {
      const selectionResult = {
        servers: [],
        strategy: 'or' as const,
        tagExpression: '',
        cancelled: false,
      };

      mockSelectorInstance.selectServers.mockResolvedValue(selectionResult);

      await selectCommand({ _: ['select'] });

      expect(mockConsoleLog).toHaveBeenCalledWith('\n📋 Selection Summary:');
      expect(mockConsoleLog).toHaveBeenCalledWith('   Strategy: or');
      expect(mockConsoleLog).toHaveBeenCalledWith('   Query: undefined');
      expect(mockConsoleLog).toHaveBeenCalledWith('\nTo save this selection, use --save <name> or --url flags.');
    });
  });

  describe('error handling', () => {
    it('should handle preset manager initialization errors', async () => {
      mockPresetManagerInstance.initialize.mockRejectedValue(new Error('Init failed'));

      await selectCommand({ _: ['select'], list: true });

      expect(logger.error).toHaveBeenCalledWith('Select command failed', {
        error: expect.any(Error),
      });
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should handle selector errors', async () => {
      mockSelectorInstance.selectServers.mockRejectedValue(new Error('Selection failed'));

      await selectCommand({ _: ['select'] });

      expect(logger.error).toHaveBeenCalledWith('Select command failed', {
        error: expect.any(Error),
      });
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should handle save errors gracefully', async () => {
      const selectionResult = {
        servers: ['server1'],
        strategy: 'or' as const,
        tagExpression: 'web',
        cancelled: false,
      };

      mockSelectorInstance.selectServers.mockResolvedValue(selectionResult);
      mockPresetManagerInstance.savePreset.mockRejectedValue(new Error('Save failed'));

      await selectCommand({ _: ['select'], save: 'error-preset' });

      expect(logger.error).toHaveBeenCalledWith('Select command failed', {
        error: expect.any(Error),
      });
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });
});
