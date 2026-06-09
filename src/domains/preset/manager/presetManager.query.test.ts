import { promises as fs } from 'fs';
import os from 'os';

import { getAllServerTargets } from '@src/commands/shared/baseConfigUtils.js';
import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';

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

    it('should include template-only server targets', async () => {
      mockGetAllServerTargets.mockReturnValue({
        server1: { tags: ['web', 'api'] },
        templateOnly: { tags: ['web', 'template'] },
      });

      const result = await presetManager.testPreset('web-preset');

      expect(result.servers).toEqual(['server1', 'templateOnly']);
      expect(result.tags).toEqual(['api', 'template', 'web']);
    });

    it('should use template-first target data for duplicate names', async () => {
      mockGetAllServerTargets.mockReturnValue({
        shared: { tags: ['web', 'template'] },
      });

      const result = await presetManager.testPreset('web-preset');

      expect(result.servers).toEqual(['shared']);
      expect(result.tags).toEqual(['template', 'web']);
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
});
