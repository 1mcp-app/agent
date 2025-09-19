import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import { PresetManager } from './presetManager.js';
import { McpConfigManager } from '../config/mcpConfigManager.js';
import { TagQueryParser } from './tagQueryParser.js';
import { TagQueryEvaluator } from './tagQueryEvaluator.js';
import logger from '../logger/logger.js';

// Mock dependencies
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
  watch: vi.fn(),
}));

vi.mock('os', () => ({
  default: {
    homedir: vi.fn(),
  },
  homedir: vi.fn(),
}));

vi.mock('../config/mcpConfigManager.js');
vi.mock('./tagQueryParser.js');
vi.mock('./tagQueryEvaluator.js');
vi.mock('../logger/logger.js');

const mockFs = fs as any;
const mockHomedir = os.homedir as Mock;
const mockMcpConfig = McpConfigManager as any;
const mockTagQueryParser = TagQueryParser as any;
const mockTagQueryEvaluator = TagQueryEvaluator as any;

describe('PresetManager', () => {
  let presetManager: PresetManager;
  let mockConfigManager: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock homedir
    mockHomedir.mockReturnValue('/mock/home');

    // Mock MCP config manager
    mockConfigManager = {
      getTransportConfig: vi.fn().mockReturnValue({
        server1: { tags: ['web', 'api'] },
        server2: { tags: ['database', 'sql'] },
        server3: { tags: ['web', 'frontend'] },
      }),
    };
    mockMcpConfig.getInstance = vi.fn().mockReturnValue(mockConfigManager);

    // Mock TagQueryParser
    mockTagQueryParser.parseSimple = vi.fn().mockImplementation((tags: string) =>
      tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    );
    mockTagQueryParser.parseAdvanced = vi.fn().mockReturnValue({
      type: 'or',
      children: [
        { type: 'tag', value: 'web' },
        { type: 'tag', value: 'api' },
      ],
    });
    mockTagQueryParser.evaluate = vi.fn().mockReturnValue(true);

    // Mock TagQueryEvaluator
    mockTagQueryEvaluator.validateQuery = vi.fn().mockReturnValue({
      isValid: true,
      errors: [],
    });
    mockTagQueryEvaluator.queryToString = vi.fn().mockReturnValue('');
    mockTagQueryEvaluator.evaluate = vi.fn().mockReturnValue(true);

    // Mock fs operations
    mockFs.mkdir = vi.fn().mockResolvedValue(undefined);
    mockFs.readFile = vi.fn();
    mockFs.writeFile = vi.fn().mockResolvedValue(undefined);

    // Get fresh instance for each test
    (PresetManager as any).instance = null;
    presetManager = PresetManager.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = PresetManager.getInstance();
      const instance2 = PresetManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('initialize', () => {
    it('should initialize successfully with existing preset file', async () => {
      const mockPresetData = {
        version: '1.0.0',
        presets: {
          dev: {
            name: 'dev',
            description: 'Development preset',
            strategy: 'or' as const,
            servers: ['server1', 'server2'],
            tagExpression: 'web,api,database',
            created: '2025-01-01T00:00:00Z',
            lastModified: '2025-01-01T00:00:00Z',
          },
        },
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(mockPresetData));

      await presetManager.initialize();

      expect(mockFs.mkdir).toHaveBeenCalledWith('/mock/home/.config/1mcp', { recursive: true });
      expect(mockFs.readFile).toHaveBeenCalledWith('/mock/home/.config/1mcp/presets.json', 'utf-8');
      expect(logger.info).toHaveBeenCalledWith('PresetManager initialized successfully', {
        presetsLoaded: 1,
        configPath: '/mock/home/.config/1mcp/presets.json',
      });
    });

    it('should create empty preset file if none exists', async () => {
      const enoentError = new Error('File not found') as any;
      enoentError.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(enoentError);

      await presetManager.initialize();

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/mock/home/.config/1mcp/presets.json',
        JSON.stringify({ version: '1.0.0', presets: {} }, null, 2),
        'utf-8',
      );
    });

    it('should throw error if preset file is corrupted', async () => {
      mockFs.readFile.mockResolvedValue('invalid json');

      await expect(presetManager.initialize()).rejects.toThrow('Failed to load presets');
    });
  });

  describe('savePreset', () => {
    beforeEach(async () => {
      mockFs.readFile.mockResolvedValue('{"version":"1.0.0","presets":{}}');
      await presetManager.initialize();
    });

    it('should save valid preset', async () => {
      const config = {
        description: 'Test preset',
        strategy: 'or' as const,
        tagQuery: { $or: [{ tag: 'web' }, { tag: 'api' }] },
      };

      await presetManager.savePreset('test', config);

      expect(mockFs.writeFile).toHaveBeenCalled();
      const writeCall = mockFs.writeFile.mock.calls.find(
        (call: any) => call[0] === '/mock/home/.config/1mcp/presets.json',
      );
      expect(writeCall).toBeDefined();

      const savedData = JSON.parse(writeCall[1]);
      expect(savedData.presets.test).toMatchObject({
        name: 'test',
        description: 'Test preset',
        strategy: 'or',
        tagQuery: { $or: [{ tag: 'web' }, { tag: 'api' }] },
      });
      expect(savedData.presets.test.created).toBeDefined();
      expect(savedData.presets.test.lastModified).toBeDefined();
    });

    it('should validate preset before saving', async () => {
      const invalidConfig = {
        description: 'Invalid preset',
        strategy: 'invalid' as any,
        tagQuery: {},
      };

      await expect(presetManager.savePreset('invalid', invalidConfig)).rejects.toThrow('Invalid preset');
    });

    it('should update existing preset', async () => {
      // Mock Date constructor to control timestamps
      const realDate = Date;
      let callCount = 0;
      const mockDates = [
        '2025-01-01T10:00:00.000Z', // First save timestamp
        '2025-01-01T10:01:00.000Z', // Second save timestamp (1 minute later)
      ];

      // @ts-ignore - Mock Date constructor
      global.Date = class extends realDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(mockDates[Math.min(callCount++, mockDates.length - 1)]);
          } else {
            super(...(args as [string | number | Date]));
          }
        }

        static now() {
          return realDate.now();
        }

        toISOString() {
          return mockDates[Math.min(callCount - 1, mockDates.length - 1)];
        }
      };

      const config1 = {
        description: 'First version',
        strategy: 'or' as const,
        servers: ['server1'],
        tagExpression: 'web',
        tagQuery: { tag: 'web' },
      };
      await presetManager.savePreset('test', config1);

      // Update with new config (will use second timestamp)
      const config2 = {
        description: 'Updated version',
        strategy: 'and' as const,
        servers: ['server1', 'server2'],
        tagExpression: 'web,api',
        tagQuery: { $and: [{ tag: 'web' }, { tag: 'api' }] },
      };
      await presetManager.savePreset('test', config2);

      // Get the latest (most recent) writeFile call for the preset file
      const writeCalls = mockFs.writeFile.mock.calls.filter(
        (call: any) => call[0] === '/mock/home/.config/1mcp/presets.json',
      );
      const lastWriteCall = writeCalls[writeCalls.length - 1];
      const savedData = JSON.parse(lastWriteCall[1]);

      expect(savedData.presets.test.description).toBe('Updated version');
      expect(savedData.presets.test.strategy).toBe('and');
      expect(savedData.presets.test.created).toBe(mockDates[0]);
      expect(savedData.presets.test.lastModified).toBe(mockDates[1]);
      expect(savedData.presets.test.lastModified).not.toBe(savedData.presets.test.created);

      // Restore real Date
      global.Date = realDate;
    });
  });

  describe('getPreset', () => {
    beforeEach(async () => {
      const mockPresetData = {
        version: '1.0.0',
        presets: {
          dev: {
            name: 'dev',
            description: 'Development preset',
            strategy: 'or' as const,
            servers: ['server1'],
            tagExpression: 'web,api',
            created: '2025-01-01T00:00:00Z',
            lastModified: '2025-01-01T00:00:00Z',
          },
        },
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockPresetData));
      await presetManager.initialize();
    });

    it('should return existing preset', () => {
      const preset = presetManager.getPreset('dev');
      expect(preset).toMatchObject({
        name: 'dev',
        description: 'Development preset',
        strategy: 'or',
        servers: ['server1'],
        tagExpression: 'web,api',
      });
    });

    it('should return null for non-existent preset', () => {
      const preset = presetManager.getPreset('nonexistent');
      expect(preset).toBeNull();
    });
  });

  describe('deletePreset', () => {
    beforeEach(async () => {
      const mockPresetData = {
        version: '1.0.0',
        presets: {
          dev: {
            name: 'dev',
            strategy: 'or' as const,
            tagQuery: { tag: 'web' },
            created: '2025-01-01T00:00:00Z',
            lastModified: '2025-01-01T00:00:00Z',
          },
          prod: {
            name: 'prod',
            strategy: 'and' as const,
            tagQuery: { tag: 'database' },
            created: '2025-01-01T00:00:00Z',
            lastModified: '2025-01-01T00:00:00Z',
          },
        },
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockPresetData));
      await presetManager.initialize();
    });

    it('should delete existing preset', async () => {
      const result = await presetManager.deletePreset('dev');
      expect(result).toBe(true);

      const writeCall = mockFs.writeFile.mock.calls.find(
        (call: any) => call[0] === '/mock/home/.config/1mcp/presets.json',
      );
      const savedData = JSON.parse(writeCall[1]);

      expect(savedData.presets.dev).toBeUndefined();
      expect(savedData.presets.prod).toBeDefined();
    });

    it('should return false for non-existent preset', async () => {
      const result = await presetManager.deletePreset('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('validatePreset', () => {
    beforeEach(async () => {
      mockFs.readFile.mockResolvedValue('{"version":"1.0.0","presets":{}}');
      await presetManager.initialize();
    });

    it('should validate correct preset', async () => {
      const config = {
        description: 'Valid preset',
        strategy: 'or' as const,
        servers: ['server1', 'server2'],
        tagExpression: 'web,api',
        tagQuery: { $or: [{ tag: 'web' }, { tag: 'api' }] },
      };

      const result = await presetManager.validatePreset('test', config);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid preset name', async () => {
      const config = {
        strategy: 'or' as const,
        servers: ['server1'],
        tagExpression: 'web',
        tagQuery: { tag: 'web' },
      };

      const result = await presetManager.validatePreset('invalid name!', config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Preset name can only contain letters, numbers, hyphens, and underscores');
    });

    it('should reject invalid strategy', async () => {
      const config = {
        strategy: 'invalid' as any,
        servers: ['server1'],
        tagExpression: 'web',
        tagQuery: { tag: 'web' },
      };

      const result = await presetManager.validatePreset('test', config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Strategy must be one of: or, and, advanced');
    });

    it('should validate tag query structure', async () => {
      mockTagQueryEvaluator.validateQuery.mockReturnValue({
        isValid: false,
        errors: ['Invalid query structure'],
      });

      const config = {
        strategy: 'or' as const,
        tagQuery: { invalid: 'structure' },
      };

      const result = await presetManager.validatePreset('test', config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Tag query: Invalid query structure');
    });

    it('should validate empty tag queries with warning', async () => {
      mockTagQueryEvaluator.queryToString.mockReturnValue('');

      const config = {
        strategy: 'advanced' as const,
        tagQuery: {},
      };

      const result = await presetManager.validatePreset('test', config);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Tag query produces no meaningful filter');
    });
  });

  describe('testPreset', () => {
    beforeEach(async () => {
      const mockPresetData = {
        version: '1.0.0',
        presets: {
          'web-preset': {
            name: 'web-preset',
            strategy: 'or' as const,
            tagQuery: { $or: [{ tag: 'web' }, { tag: 'frontend' }] },
            created: '2025-01-01T00:00:00Z',
            lastModified: '2025-01-01T00:00:00Z',
          },
        },
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockPresetData));
      await presetManager.initialize();

      // Mock evaluate to return true for servers with web or frontend tags
      mockTagQueryEvaluator.evaluate.mockImplementation((_query: any, serverTags: string[]) => {
        return serverTags.includes('web') || serverTags.includes('frontend');
      });
    });

    it('should test preset against available servers', async () => {
      const result = await presetManager.testPreset('web-preset');

      expect(result.servers).toEqual(['server1', 'server3']);
      expect(result.tags).toEqual(['api', 'database', 'frontend', 'sql', 'web']);
    });

    it('should throw error for non-existent preset', async () => {
      await expect(presetManager.testPreset('nonexistent')).rejects.toThrow("Preset 'nonexistent' not found");
    });
  });

  describe('resolvePresetToExpression', () => {
    beforeEach(async () => {
      const mockPresetData = {
        version: '1.0.0',
        presets: {
          dev: {
            name: 'dev',
            strategy: 'or' as const,
            tagQuery: { $or: [{ tag: 'web' }, { tag: 'api' }] },
            created: '2025-01-01T00:00:00Z',
            lastModified: '2025-01-01T00:00:00Z',
          },
        },
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockPresetData));
      await presetManager.initialize();
    });

    it('should resolve existing preset to expression', () => {
      mockTagQueryEvaluator.queryToString.mockReturnValue('web OR api');
      const expression = presetManager.resolvePresetToExpression('dev');
      expect(expression).toBe('web OR api');
    });

    it('should return null for non-existent preset', () => {
      const expression = presetManager.resolvePresetToExpression('nonexistent');
      expect(expression).toBeNull();
    });
  });

  describe('notification callbacks', () => {
    beforeEach(async () => {
      mockFs.readFile.mockResolvedValue('{"version":"1.0.0","presets":{}}');
      await presetManager.initialize();
    });

    it('should register and call notification callbacks', async () => {
      const callback1 = vi.fn().mockResolvedValue(undefined);
      const callback2 = vi.fn().mockResolvedValue(undefined);

      presetManager.onPresetChange(callback1);
      presetManager.onPresetChange(callback2);

      const config = {
        strategy: 'or' as const,
        servers: ['server1'],
        tagExpression: 'web',
        tagQuery: { tag: 'web' },
      };

      await presetManager.savePreset('test', config);

      expect(callback1).toHaveBeenCalledWith('test');
      expect(callback2).toHaveBeenCalledWith('test');
    });

    it('should remove notification callbacks', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      presetManager.onPresetChange(callback);
      presetManager.offPresetChange(callback);

      const config = {
        strategy: 'or' as const,
        servers: ['server1'],
        tagExpression: 'web',
        tagQuery: { tag: 'web' },
      };

      await presetManager.savePreset('test', config);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle callback errors gracefully', async () => {
      const callback = vi.fn().mockRejectedValue(new Error('Callback error'));

      presetManager.onPresetChange(callback);

      const config = {
        strategy: 'or' as const,
        servers: ['server1'],
        tagExpression: 'web',
        tagQuery: { tag: 'web' },
      };

      // Should not throw despite callback error
      await expect(presetManager.savePreset('test', config)).resolves.not.toThrow();
      expect(callback).toHaveBeenCalledWith('test');
    });
  });

  describe('error handling improvements', () => {
    beforeEach(async () => {
      const mockPresetData = {
        version: '1.0.0',
        presets: {
          'valid-preset': {
            name: 'valid-preset',
            strategy: 'or' as const,
            tagQuery: { $or: [{ tag: 'web' }, { tag: 'api' }] },
            created: '2025-01-01T00:00:00Z',
            lastModified: '2025-01-01T00:00:00Z',
          },
          'error-preset': {
            name: 'error-preset',
            strategy: 'advanced' as const,
            tagQuery: { $advanced: 'invalid_expression' },
            created: '2025-01-01T00:00:00Z',
            lastModified: '2025-01-01T00:00:00Z',
          },
          'empty-query-preset': {
            name: 'empty-query-preset',
            strategy: 'or' as const,
            tagQuery: {},
            created: '2025-01-01T00:00:00Z',
            lastModified: '2025-01-01T00:00:00Z',
          },
        },
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockPresetData));
      await presetManager.initialize();
    });

    describe('testPreset error handling', () => {
      it('should handle TagQueryEvaluator evaluation errors gracefully', async () => {
        // Mock TagQueryEvaluator.evaluate to throw an error
        mockTagQueryEvaluator.evaluate.mockImplementation((_query: any, _serverTags: string[]) => {
          throw new Error('Invalid query expression');
        });

        // Mock TagQueryParser for legacy advanced query conversion
        mockTagQueryParser.advancedQueryToJSON = vi.fn().mockImplementation(() => {
          throw new Error('Invalid advanced query');
        });

        const result = await presetManager.testPreset('error-preset');

        // Should return empty servers list when evaluation fails
        expect(result.servers).toEqual([]);
        expect(result.tags).toEqual(['api', 'database', 'frontend', 'sql', 'web']);

        // Should log warning about failed evaluation
        expect(logger.warn).toHaveBeenCalledWith('Failed to evaluate preset against server', {
          preset: 'error-preset',
          server: expect.any(String),
          error: 'Invalid advanced query',
          tagQuery: { $advanced: 'invalid_expression' },
          serverTags: expect.any(Array),
        });
      });

      it('should handle individual server evaluation failures', async () => {
        let callCount = 0;
        mockTagQueryEvaluator.evaluate.mockImplementation((_query: any, serverTags: string[]) => {
          callCount++;
          if (callCount === 2) {
            // Fail on second server evaluation
            throw new Error('Evaluation error on server2');
          }
          return serverTags.includes('web');
        });

        const result = await presetManager.testPreset('valid-preset');

        // Should still return results for servers that evaluated successfully
        expect(result.servers).toEqual(['server1', 'server3']);

        // Should log warning for failed server evaluation
        expect(logger.warn).toHaveBeenCalledWith('Failed to evaluate preset against server', {
          preset: 'valid-preset',
          server: 'server2',
          error: 'Evaluation error on server2',
          tagQuery: { $or: [{ tag: 'web' }, { tag: 'api' }] },
          serverTags: ['database', 'sql'],
        });
      });
    });

    describe('resolvePresetToExpression error handling', () => {
      it('should handle non-existent preset gracefully', () => {
        const result = presetManager.resolvePresetToExpression('non-existent');
        expect(result).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith('Attempted to resolve non-existent preset', {
          name: 'non-existent',
        });
      });

      it('should handle TagQueryEvaluator.queryToString errors', () => {
        mockTagQueryEvaluator.queryToString.mockImplementation(() => {
          throw new Error('Query to string conversion failed');
        });

        const result = presetManager.resolvePresetToExpression('valid-preset');
        expect(result).toBeNull();

        expect(logger.error).toHaveBeenCalledWith('Failed to resolve preset to expression', {
          name: 'valid-preset',
          error: 'Query to string conversion failed',
          tagQuery: { $or: [{ tag: 'web' }, { tag: 'api' }] },
        });
      });

      it('should handle empty query expressions', () => {
        mockTagQueryEvaluator.queryToString.mockReturnValue('');

        const result = presetManager.resolvePresetToExpression('empty-query-preset');
        expect(result).toBeNull();

        expect(logger.warn).toHaveBeenCalledWith('Preset resolved to empty expression', {
          name: 'empty-query-preset',
          tagQuery: {},
        });
      });

      it('should handle whitespace-only query expressions', () => {
        mockTagQueryEvaluator.queryToString.mockReturnValue('   \t\n   ');

        const result = presetManager.resolvePresetToExpression('valid-preset');
        expect(result).toBeNull();

        expect(logger.warn).toHaveBeenCalledWith('Preset resolved to empty expression', {
          name: 'valid-preset',
          tagQuery: { $or: [{ tag: 'web' }, { tag: 'api' }] },
        });
      });
    });

    describe('change detector error handling', () => {
      it('should handle change detector updateServerList errors', async () => {
        // Create a mock change detector with failing updateServerList
        const mockChangeDetector = {
          updateServerList: vi.fn().mockImplementation((presetName: string, _servers: string[]) => {
            if (presetName === 'valid-preset') {
              throw new Error('Change detector update failed');
            }
          }),
          getTrackedPresets: vi.fn().mockReturnValue(['valid-preset']),
          removePreset: vi.fn(),
          clear: vi.fn(),
        };

        // Replace the change detector in the preset manager instance
        (presetManager as any).changeDetector = mockChangeDetector;

        // Mock testPreset to succeed
        mockTagQueryEvaluator.evaluate.mockReturnValue(true);

        // Trigger a file change to test error handling
        await (presetManager as any).reloadAndNotifyChanges();

        expect(logger.error).toHaveBeenCalledWith('Failed to update change detector for preset', {
          presetName: 'valid-preset',
          error: 'Change detector update failed',
        });
      });
    });
  });

  describe('memory leak prevention', () => {
    let cleanupManager: PresetManager;

    beforeEach(async () => {
      mockFs.readFile.mockResolvedValue('{"version":"1.0.0","presets":{}}');
      (PresetManager as any).instance = null;
      cleanupManager = PresetManager.getInstance();
      await cleanupManager.initialize();
    });

    it('should clean up all resources during cleanup', async () => {
      const callback1 = vi.fn().mockResolvedValue(undefined);
      const callback2 = vi.fn().mockResolvedValue(undefined);

      // Add notification callbacks
      cleanupManager.onPresetChange(callback1);
      cleanupManager.onPresetChange(callback2);

      // Mock the change detector with clear method
      const mockChangeDetector = {
        clear: vi.fn(),
        updateServerList: vi.fn(),
        getTrackedPresets: vi.fn().mockReturnValue([]),
        removePreset: vi.fn(),
      };
      (cleanupManager as any).changeDetector = mockChangeDetector;

      // Mock watcher
      const mockWatcher = {
        close: vi.fn(),
      };
      (cleanupManager as any).watcher = mockWatcher;

      // Set a timeout to simulate pending operation
      (cleanupManager as any).reloadTimeout = setTimeout(() => {}, 1000);

      await cleanupManager.cleanup();

      // Verify all resources were cleaned up
      expect(mockWatcher.close).toHaveBeenCalled();
      expect(mockChangeDetector.clear).toHaveBeenCalled();
      expect((cleanupManager as any).watcher).toBeNull();
      expect((cleanupManager as any).reloadTimeout).toBeNull();
      expect((cleanupManager as any).notificationCallbacks.size).toBe(0);
      expect((cleanupManager as any).presets.size).toBe(0);

      expect(logger.debug).toHaveBeenCalledWith('PresetManager cleanup completed successfully');
    });

    it('should handle cleanup errors gracefully', async () => {
      const mockChangeDetector = {
        clear: vi.fn().mockImplementation(() => {
          throw new Error('Cleanup failed');
        }),
        updateServerList: vi.fn(),
        getTrackedPresets: vi.fn().mockReturnValue([]),
        removePreset: vi.fn(),
      };
      (cleanupManager as any).changeDetector = mockChangeDetector;

      // Should not throw despite internal cleanup errors
      await expect(cleanupManager.cleanup()).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith('Error during PresetManager cleanup', {
        error: expect.any(Error),
      });
    });

    it('should handle change detector without clear method', async () => {
      const mockChangeDetector = {
        updateServerList: vi.fn(),
        getTrackedPresets: vi.fn().mockReturnValue([]),
        removePreset: vi.fn(),
        // No clear method
      };
      (cleanupManager as any).changeDetector = mockChangeDetector;

      // Should not throw when clear method doesn't exist
      await expect(cleanupManager.cleanup()).resolves.not.toThrow();

      expect(logger.debug).toHaveBeenCalledWith('PresetManager cleanup completed successfully');
    });
  });

  describe('resetInstance for testing', () => {
    it('should reset singleton instance and cleanup resources', async () => {
      // Setup mock data for initialization
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          version: '1.0.0',
          presets: {},
        }),
      );

      // Initialize a preset manager
      const instance = PresetManager.getInstance();
      await instance.initialize();

      // Add some state
      const callback = vi.fn();
      instance.onPresetChange(callback);

      // Spy on cleanup method
      const cleanupSpy = vi.spyOn(instance, 'cleanup').mockResolvedValue();

      // Reset instance
      PresetManager.resetInstance();

      expect(cleanupSpy).toHaveBeenCalled();

      // Verify new instance is different
      const newInstance = PresetManager.getInstance();
      expect(newInstance).not.toBe(instance);
    });

    it('should handle cleanup failure during reset gracefully', async () => {
      // Setup mock data for initialization
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          version: '1.0.0',
          presets: {},
        }),
      );

      const instance = PresetManager.getInstance();
      await instance.initialize();

      // Mock cleanup to fail
      vi.spyOn(instance, 'cleanup').mockRejectedValue(new Error('Cleanup failed'));

      // Mock console.warn
      const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Should not throw despite cleanup failure
      expect(() => PresetManager.resetInstance()).not.toThrow();

      // Wait for the async cleanup promise to reject and console.warn to be called
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should log warning about cleanup failure
      expect(mockWarn).toHaveBeenCalledWith('Failed to cleanup PresetManager during reset:', expect.any(Error));

      mockWarn.mockRestore();
    });
  });

  describe('utility methods', () => {
    beforeEach(async () => {
      const mockPresetData = {
        version: '1.0.0',
        presets: {
          dev: {
            name: 'dev',
            strategy: 'or' as const,
            tagQuery: { tag: 'web' },
            created: '2025-01-01T00:00:00Z',
            lastModified: '2025-01-01T00:00:00Z',
          },
          prod: {
            name: 'prod',
            strategy: 'and' as const,
            tagQuery: { tag: 'database' },
            created: '2025-01-01T00:00:00Z',
            lastModified: '2025-01-01T00:00:00Z',
          },
        },
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockPresetData));
      await presetManager.initialize();
    });

    it('should check if preset exists', () => {
      expect(presetManager.hasPreset('dev')).toBe(true);
      expect(presetManager.hasPreset('nonexistent')).toBe(false);
    });

    it('should get preset names', () => {
      const names = presetManager.getPresetNames();
      expect(names).toEqual(['dev', 'prod']);
    });

    it('should get preset list', () => {
      const list = presetManager.getPresetList();
      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({
        name: 'dev',
        strategy: 'or',
        tagQuery: { tag: 'web' },
      });
    });

    it('should get configuration path', () => {
      const configPath = presetManager.getConfigPath();
      expect(configPath).toBe('/mock/home/.config/1mcp/presets.json');
    });
  });
});
