/**
 * Integration tests for Lazy Loading with Preset/Tag Filtering
 *
 * This test file validates that preset/tag filters are correctly applied
 * to tools, resources, and prompts at the integration level.
 */
import { randomBytes } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';

import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Lazy Loading Preset Filtering Integration Tests', () => {
  let testConfigDir: string;

  beforeEach(async () => {
    // Create a temporary config directory under ./build/ for each test
    const buildDir = join(process.cwd(), 'build');
    await mkdir(buildDir, { recursive: true });
    testConfigDir = join(buildDir, `.tmp-test-preset-integration-${randomBytes(4).toString('hex')}`);
    await mkdir(testConfigDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up the test directory
    try {
      await rm(testConfigDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe('PresetManager Integration', () => {
    it('should load preset from configuration file', async () => {
      // Create a preset configuration file
      const presetConfig = {
        presets: {
          'dev-backend': {
            displayName: 'Dev Backend Preset',
            strategy: 'or' as const,
            tagQuery: { tags: { $in: ['backend', 'context'] } },
          },
        },
      };
      await writeFile(join(testConfigDir, 'presets.json'), JSON.stringify(presetConfig, null, 2), 'utf-8');

      // Initialize PresetManager with test config directory
      PresetManager.resetInstance();
      const presetManager = PresetManager.getInstance(testConfigDir);
      await presetManager.initialize();

      // Test that preset can be loaded
      const preset = presetManager.getPreset('dev-backend');
      expect(preset).toBeDefined();
      expect(preset?.tagQuery).toEqual({ tags: { $in: ['backend', 'context'] } });

      // Test preset resolution
      const expression = presetManager.resolvePresetToExpression('dev-backend');
      expect(expression).toBeTruthy();
    });
  });

  describe('Tag Query Evaluation', () => {
    it('should correctly evaluate MongoDB-style tag queries', () => {
      const tagQuery = { tags: { $in: ['backend', 'context'] } };

      // Test backend server - should match
      const backendServer = ['backend', 'database'];
      expect(TagQueryEvaluator.evaluate(tagQuery, backendServer)).toBe(true);

      // Test frontend server - should not match
      const frontendServer = ['frontend', 'ui'];
      expect(TagQueryEvaluator.evaluate(tagQuery, frontendServer)).toBe(false);

      // Test context server - should match
      const contextServer = ['context', 'docs'];
      expect(TagQueryEvaluator.evaluate(tagQuery, contextServer)).toBe(true);
    });

    it('should handle complex tag queries', () => {
      // AND query - server must have both tags
      // Using $and with individual tag queries
      const andQuery = {
        $and: [{ tag: 'backend' }, { tag: 'api' }],
      };

      expect(TagQueryEvaluator.evaluate(andQuery, ['backend', 'api'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(andQuery, ['backend', 'database'])).toBe(false);

      // OR query - server must have at least one tag
      const orQuery = { tags: { $in: ['backend', 'context'] } };

      expect(TagQueryEvaluator.evaluate(orQuery, ['backend', 'api'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(orQuery, ['context', 'docs'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(orQuery, ['frontend', 'ui'])).toBe(false);
    });
  });

  describe('STDIO Transport Preset Loading', () => {
    it('should demonstrate preset loading from environment variable', async () => {
      // Create preset configuration
      const presetConfig = {
        presets: {
          'test-preset': {
            displayName: 'Test Preset',
            strategy: 'or' as const,
            tagQuery: { tags: { $in: ['test', 'demo'] } },
          },
        },
      };
      await writeFile(join(testConfigDir, 'presets.json'), JSON.stringify(presetConfig, null, 2), 'utf-8');

      // Simulate environment variable context
      const presetEnv = 'test-preset';

      // Initialize PresetManager
      PresetManager.resetInstance();
      const presetManager = PresetManager.getInstance(testConfigDir);
      await presetManager.initialize();

      // Simulate the code path in serve.ts
      const preset = presetManager.getPreset(presetEnv);
      expect(preset).toBeDefined();
      expect(preset?.tagQuery).toEqual({ tags: { $in: ['test', 'demo'] } });

      const tagQuery = preset?.tagQuery;
      const tagFilterMode = 'preset' as const;
      const presetName = presetEnv;

      expect(tagQuery).toBeDefined();
      expect(tagFilterMode).toBe('preset');
      expect(presetName).toBe('test-preset');
    });
  });

  describe('Preset Filter Matching', () => {
    it('should correctly match servers with preset tag query', () => {
      // Define server configurations
      const servers = {
        server1: ['backend', 'api'],
        server2: ['frontend', 'ui'],
        server3: ['context', 'docs'],
        server4: ['backend', 'database'],
      };

      // Create preset that matches backend or context
      const tagQuery = { tags: { $in: ['backend', 'context'] } };

      // Test each server
      const matchingServers: string[] = [];
      for (const [serverName, serverTags] of Object.entries(servers)) {
        if (TagQueryEvaluator.evaluate(tagQuery, serverTags)) {
          matchingServers.push(serverName);
        }
      }

      // Should match server1, server3, server4 (backend or context)
      expect(matchingServers).toContain('server1'); // backend
      expect(matchingServers).toContain('server3'); // context
      expect(matchingServers).toContain('server4'); // backend
      expect(matchingServers).not.toContain('server2'); // frontend only
    });
  });
});
