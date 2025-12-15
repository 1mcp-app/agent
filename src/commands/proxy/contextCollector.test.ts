import type { ContextCollectionOptions } from '@src/types/context.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextCollector } from './contextCollector.js';

// Mock modules at the top level
vi.mock('child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
  exec: vi.fn(),
  fork: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn((fn) => fn),
}));

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
const originalCwd = process.cwd;
process.cwd = vi.fn(() => '/test/project');

describe('ContextCollector', () => {
  let contextCollector: ContextCollector;
  let mockExecFile: any;
  let mockPromisify: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get mocked modules
    const childProcess = await import('child_process');
    mockExecFile = childProcess.execFile;

    const util = await import('util');
    mockPromisify = util.promisify;

    // Setup mock execFile to be returned by promisify
    mockPromisify.mockReturnValue(mockExecFile);
    mockExecFile.mockResolvedValue({ stdout: 'mock result', stderr: '' });
  });

  afterAll(() => {
    // Restore original process.cwd
    process.cwd = originalCwd;
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
        sanitizePaths: true,
      };
      contextCollector = new ContextCollector(options);
      expect(contextCollector).toBeDefined();
    });
  });

  describe('collect', () => {
    it('should collect context data', async () => {
      contextCollector = new ContextCollector({
        includeGit: false,
        includeEnv: false,
      });

      const context = await contextCollector.collect();

      expect(context).toBeDefined();
      expect(context.project).toBeDefined();
      expect(context.user).toBeDefined();
      expect(context.environment).toBeDefined();
      expect(context.timestamp).toBeDefined();
      expect(context.sessionId).toBeDefined();
      expect(context.version).toBe('v1');
    });

    it('should include git context when enabled', async () => {
      // Mock git command responses
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git rev-parse --git-dir
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' }) // git rev-parse --abbrev-ref HEAD
        .mockResolvedValueOnce({ stdout: 'abc123456789\n', stderr: '' }) // git rev-parse HEAD
        .mockResolvedValueOnce({ stdout: 'https://github.com/user/repo.git\n', stderr: '' }); // git remote get-url origin

      contextCollector = new ContextCollector({
        includeGit: true,
        includeEnv: false,
      });

      const context = await contextCollector.collect();

      expect(context.project.git).toBeDefined();
      if (context.project.git?.isRepo) {
        expect(context.project.git.branch).toBe('main');
        expect(context.project.git.commit).toBe('abc12345');
        expect(context.project.git.repository).toBe('user/repo');
      }
    });

    it('should include environment variables when enabled', async () => {
      contextCollector = new ContextCollector({
        includeGit: false,
        includeEnv: true,
        envPrefixes: ['TEST_', 'APP_'],
      });

      // Set some test environment variables
      process.env.TEST_VAR = 'test_value';
      process.env.APP_CONFIG = 'app_value';
      process.env.SECRET_KEY = 'secret_value'; // Should be filtered out
      process.env.OTHER_VAR = 'other_value';

      const context = await contextCollector.collect();

      expect(context.environment.variables).toBeDefined();
      expect(context.environment.variables?.TEST_VAR).toBe('test_value');
      expect(context.environment.variables?.APP_CONFIG).toBe('app_value');
      expect(context.environment.variables?.SECRET_KEY).toBeUndefined(); // Should be filtered
      expect(context.environment.variables?.OTHER_VAR).toBeUndefined(); // Not matching prefixes

      // Clean up
      delete process.env.TEST_VAR;
      delete process.env.APP_CONFIG;
      delete process.env.SECRET_KEY;
      delete process.env.OTHER_VAR;
    });

    it('should sanitize paths when enabled', async () => {
      contextCollector = new ContextCollector({
        includeGit: false,
        includeEnv: false,
        sanitizePaths: true,
      });

      const context = await contextCollector.collect();

      // Check that paths are sanitized (should use ~ for home directory)
      expect(context.user.home).toBe('~');
    });
  });
});
