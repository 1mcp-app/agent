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
});
