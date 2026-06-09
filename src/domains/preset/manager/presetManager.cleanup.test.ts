import { promises as fs } from 'fs';
import os from 'os';

import { getAllServerTargets } from '@src/commands/shared/baseConfigUtils.js';
import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import logger from '@src/logger/logger.js';

import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

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

vi.mock('@src/commands/shared/baseConfigUtils.js');
vi.mock('../parsing/tagQueryParser.js');
vi.mock('../parsing/tagQueryEvaluator.js');
vi.mock('@src/logger/logger.js');

const mockFs = fs as any;
const mockHomedir = os.homedir as Mock;
const mockGetAllServerTargets = vi.mocked(getAllServerTargets);
const mockTagQueryParser = TagQueryParser as any;
const mockTagQueryEvaluator = TagQueryEvaluator as any;

describe('PresetManager', () => {
  let presetManager: PresetManager;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock homedir
    mockHomedir.mockReturnValue('/mock/home');

    mockGetAllServerTargets.mockReturnValue({
      server1: { tags: ['web', 'api'] },
      server2: { tags: ['database', 'sql'] },
      server3: { tags: ['web', 'frontend'] },
    });

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

      // Mock logger.warn to return logger for chaining
      const mockWarn = vi.spyOn(logger, 'warn').mockReturnValue(logger);

      // Should not throw despite cleanup failure
      expect(() => PresetManager.resetInstance()).not.toThrow();

      // Wait for the async cleanup promise to reject and logger.warn to be called
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
