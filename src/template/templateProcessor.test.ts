import type { ContextData } from '@src/types/context.js';
import type { MCPServerParams } from '@src/types/context.js';

import { describe, expect, it } from 'vitest';

import { TemplateProcessor } from './templateProcessor.js';

describe('TemplateProcessor', () => {
  let processor: TemplateProcessor;
  let mockContext: ContextData;

  beforeEach(() => {
    processor = new TemplateProcessor({
      strictMode: false,
      allowUndefined: true,
      validateTemplates: true,
      cacheResults: true,
    });

    mockContext = {
      project: {
        path: '/test/project',
        name: 'test-project',
        environment: 'development',
        git: {
          branch: 'main',
          commit: 'abc12345',
          repository: 'test/repo',
          isRepo: true,
        },
      },
      user: {
        username: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        home: '/home/testuser',
        uid: '1000',
        gid: '1000',
        shell: '/bin/bash',
      },
      environment: {
        variables: {
          NODE_ENV: 'test',
          API_URL: 'https://api.test.com',
        },
      },
      timestamp: '2024-01-01T00:00:00.000Z',
      sessionId: 'test-session-123',
      version: 'v1',
    };
  });

  describe('processServerConfig', () => {
    it('should process simple command template', async () => {
      const config: MCPServerParams = {
        command: 'echo "{project.name}"',
        args: [],
      };

      const result = await processor.processServerConfig('test-server', config, mockContext);

      expect(result.success).toBe(true);
      expect(result.processedConfig.command).toBe('echo "test-project"');
      expect(result.processedTemplates).toContain('command: echo "{project.name}" -> echo "test-project"');
    });

    it('should process args array with templates', async () => {
      const config: MCPServerParams = {
        command: 'node',
        args: ['--path', '{project.path}', '--user', '{user.username}'],
      };

      const result = await processor.processServerConfig('test-server', config, mockContext);

      expect(result.success).toBe(true);
      expect(result.processedConfig.args).toEqual(['--path', '/test/project', '--user', 'testuser']);
    });

    it('should process environment variables', async () => {
      const config: MCPServerParams = {
        command: 'echo',
        env: {
          PROJECT_PATH: '{project.path}',
          USER_EMAIL: '{user.email}',
          STATIC_VAR: 'unchanged',
        },
      };

      const result = await processor.processServerConfig('test-server', config, mockContext);

      expect(result.success).toBe(true);
      expect(result.processedConfig.env).toEqual({
        PROJECT_PATH: '/test/project',
        USER_EMAIL: 'test@example.com',
        STATIC_VAR: 'unchanged',
      });
    });

    it('should process headers for HTTP transport', async () => {
      const config: MCPServerParams = {
        command: 'echo',
        headers: {
          'X-Project': '{project.name}',
          'X-Session': '{context.sessionId}',
        },
      };

      const result = await processor.processServerConfig('test-server', config, mockContext);

      expect(result.success).toBe(true);
      expect(result.processedConfig.headers).toEqual({
        'X-Project': 'test-project',
        'X-Session': 'test-session-123',
      });
    });

    it('should handle validation errors', async () => {
      const config: MCPServerParams = {
        command: 'echo "{invalid.variable}"',
        args: [],
      };

      const result = await processor.processServerConfig('test-server', config, mockContext);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should process cwd template', async () => {
      const config: MCPServerParams = {
        command: 'echo',
        cwd: '{project.path}/subdir',
      };

      const result = await processor.processServerConfig('test-server', config, mockContext);

      expect(result.success).toBe(true);
      expect(result.processedConfig.cwd).toBe('/test/project/subdir');
    });
  });

  describe('processMultipleServerConfigs', () => {
    it('should process multiple configurations concurrently', async () => {
      const configs: Record<string, MCPServerParams> = {
        server1: {
          command: 'echo "{project.name}"',
          args: [],
        },
        server2: {
          command: 'node',
          args: ['--path', '{project.path}'],
        },
        server3: {
          command: 'echo',
          env: { USER: '{user.username}' },
        },
      };

      const results = await processor.processMultipleServerConfigs(configs, mockContext);

      expect(Object.keys(results)).toHaveLength(3);
      expect(results.server1.processedConfig.command).toBe('echo "test-project"');
      expect(results.server2.processedConfig.args).toEqual(['--path', '/test/project']);
      expect((results.server3.processedConfig.env as Record<string, string>)?.USER).toBe('testuser');
    });
  });

  describe('cache functionality', () => {
    it('should track cache statistics', async () => {
      const config: MCPServerParams = {
        command: 'echo "{project.name}"',
        args: [],
      };

      // Process same template twice
      await processor.processServerConfig('test-server', config, mockContext);
      await processor.processServerConfig('test-server-2', config, mockContext);

      const stats = processor.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.hits).toBe(1); // Second hit
      expect(stats.misses).toBe(1); // First miss
      expect(stats.hitRate).toBe(0.5); // 1 hit out of 2 total
    });

    it('should clear cache and reset statistics', async () => {
      const config: MCPServerParams = {
        command: 'echo "{project.name}"',
        args: [],
      };

      await processor.processServerConfig('test-server', config, mockContext);

      let stats = processor.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);

      processor.clearCache();

      stats = processor.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('with different options', () => {
    it('should work in strict mode', async () => {
      const strictProcessor = new TemplateProcessor({
        strictMode: true,
        allowUndefined: false,
        validateTemplates: true,
      });

      const config: MCPServerParams = {
        command: 'echo "{project.name}"',
        args: [],
      };

      const result = await strictProcessor.processServerConfig('test-server', config, mockContext);
      expect(result.success).toBe(true);
    });

    it('should work without caching', async () => {
      const noCacheProcessor = new TemplateProcessor({
        cacheResults: false,
      });

      const config: MCPServerParams = {
        command: 'echo "{project.name}"',
        args: [],
      };

      const result = await noCacheProcessor.processServerConfig('test-server', config, mockContext);
      expect(result.success).toBe(true);

      const stats = noCacheProcessor.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });
});
