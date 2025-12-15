import type { ContextCollectionOptions } from '@src/types/context.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextCollector } from './contextCollector.js';

// Mock child_process module
const mockExecFile = vi.fn();
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: mockExecFile,
  };
});

// Mock promisify
vi.mock('util', () => ({
  promisify: vi.fn((fn) => fn),
}));

// Mock os module
vi.mock('os', () => ({
  userInfo: vi.fn(() => ({
    username: 'testuser',
    uid: 1000,
    gid: 1000,
    homedir: '/home/testuser',
    shell: '/bin/bash',
  })),
  homedir: '/home/testuser',
}));

// Mock process.cwd
process.cwd = vi.fn(() => '/test/project');

// Setup mock execFile return value
mockExecFile.mockResolvedValue({ stdout: 'mock result', stderr: '' });

describe('ContextCollector', () => {
  let contextCollector: ContextCollector;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFile.mockResolvedValue({ stdout: 'mock result', stderr: '' });
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      contextCollector = new ContextCollector();
      expect(contextCollector).toBeDefined();
    });

    it('should create with custom options', () => {
      const options: ContextCollectionOptions = {
        includeGit: false,
        includeEnv: false,
        envPrefixes: ['TEST_'],
        sanitizePaths: false,
      };
      contextCollector = new ContextCollector(options);
      expect(contextCollector).toBeDefined();
    });
  });

  describe('collect', () => {
    it('should collect basic context data', async () => {
      contextCollector = new ContextCollector();
      const result = await contextCollector.collect();

      expect(result).toBeDefined();
      expect(result.project).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.environment).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(result.version).toBe('v1');
    });

    it('should include project path', async () => {
      contextCollector = new ContextCollector({
        sanitizePaths: false, // Disable path sanitization for this test
      });
      const result = await contextCollector.collect();

      expect(result.project.path).toBe(process.cwd());
      expect(result.project.name).toBeDefined();
    });

    it('should include user information', async () => {
      contextCollector = new ContextCollector();
      const result = await contextCollector.collect();

      expect(result.user.username).toBeDefined();
      expect(result.user.uid).toBeDefined();
      expect(result.user.gid).toBeDefined();
      expect(result.user.home).toBeDefined();
    });

    it('should include environment variables', async () => {
      contextCollector = new ContextCollector({
        includeEnv: true,
      });
      const result = await contextCollector.collect();

      expect(result.environment.variables).toBeDefined();
      expect(Object.keys(result.environment.variables || {})).length.greaterThan(0);
    });

    it('should respect environment prefixes', async () => {
      // Set a test environment variable
      process.env.TEST_CONTEXT_VAR = 'test-value';

      contextCollector = new ContextCollector({
        includeEnv: true,
        envPrefixes: ['TEST_'],
      });
      const result = await contextCollector.collect();

      expect(result.environment.variables?.['TEST_CONTEXT_VAR']).toBe('test-value');

      // Clean up
      delete process.env.TEST_CONTEXT_VAR;
    });
  });

  describe('git detection', () => {
    it('should include git information if in a git repository', async () => {
      // This test will only pass if run in a git repository
      contextCollector = new ContextCollector({
        includeGit: true,
      });
      const result = await contextCollector.collect();

      if (result.project.git?.isRepo) {
        expect(result.project.git.branch).toBeDefined();
        expect(result.project.git.commit).toBeDefined();
        expect(result.project.git.commit?.length).toBe(8); // Short hash
      }
    });

    it('should skip git if disabled', async () => {
      contextCollector = new ContextCollector({
        includeGit: false,
      });
      const result = await contextCollector.collect();

      expect(result.project.git).toBeUndefined();
    });
  });

  describe('path sanitization', () => {
    it('should sanitize paths when enabled', async () => {
      contextCollector = new ContextCollector({
        sanitizePaths: true,
      });
      const result = await contextCollector.collect();

      if (result.user.home?.includes('/')) {
        // Check that home directory is sanitized
        expect(result.user.home.includes('~')).toBeTruthy();
      }
    });

    it('should not sanitize paths when disabled', async () => {
      contextCollector = new ContextCollector({
        sanitizePaths: false,
      });
      const result = await contextCollector.collect();

      expect(result.user.home).toBe(require('os').homedir());
    });
  });

  describe('error handling', () => {
    it('should handle git command failures gracefully', async () => {
      // Mock git command to fail
      vi.mock('child_process', () => ({
        spawn: vi.fn(() => {
          const error = new Error('Command failed');
          (error as any).code = 'ENOENT';
          throw error;
        }),
      }));

      contextCollector = new ContextCollector({
        includeGit: true,
      });
      const result = await contextCollector.collect();

      expect(result.project.git?.isRepo).toBe(false);
    });
  });

  describe('session generation', () => {
    it('should generate unique session IDs', async () => {
      contextCollector = new ContextCollector();
      const result1 = await contextCollector.collect();
      const result2 = await new ContextCollector().collect();

      expect(result1.sessionId).toBeDefined();
      expect(result2.sessionId).toBeDefined();
      expect(result1.sessionId).not.toBe(result2.sessionId);
    });

    it('should generate session IDs with ctx_ prefix', async () => {
      contextCollector = new ContextCollector();
      const result = await contextCollector.collect();

      expect(result.sessionId).toMatch(/^ctx_/);
    });
  });
});
