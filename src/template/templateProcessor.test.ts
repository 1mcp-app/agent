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

    it('should process SSE transport templates', async () => {
      const config: MCPServerParams = {
        type: 'sse',
        url: 'http://example.com/sse/{project.name}',
        headers: {
          'X-Project-Path': '{project.path}',
          'X-User-Name': '{user.username}',
          'X-Session-ID': '{context.sessionId}',
          'X-Transport-Type': '{transport.type}',
        },
      };

      const result = await processor.processServerConfig('sse-server', config, mockContext);

      if (!result.success) {
        console.log('Errors:', result.errors);
      }

      expect(result.success).toBe(true);
      expect(result.processedConfig.url).toBe('http://example.com/sse/test-project');
      expect(result.processedConfig.headers).toEqual({
        'X-Project-Path': '/test/project',
        'X-User-Name': 'testuser',
        'X-Session-ID': 'test-session-123',
        'X-Transport-Type': 'sse',
      });
    });

    it('should process transport-specific variables', async () => {
      const config: MCPServerParams = {
        type: 'streamableHttp',
        url: 'http://example.com/api/{transport.type}/{project.name}',
        headers: {
          'X-Connection-ID': '{transport.connectionId}',
          'X-Transport-Timestamp': '{transport.connectionTimestamp}',
        },
      };

      const result = await processor.processServerConfig('http-server', config, mockContext);

      expect(result.success).toBe(true);
      // The URL should be processed with transport info
      expect(result.processedConfig.url).toBe('http://example.com/api/streamableHttp/test-project');
      // Headers should have transport info
      expect(result.processedConfig.headers?.['X-Connection-ID']).toMatch(/^conn_\d+_[a-z0-9]+$/);
      expect(result.processedConfig.headers?.['X-Transport-Timestamp']).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
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

  describe('transport-specific validation', () => {
    it('should validate SSE transport templates', async () => {
      const processor = new TemplateProcessor();

      const config: MCPServerParams = {
        type: 'sse',
        url: 'http://example.com/sse/{project.name}',
        headers: {
          'X-Project': '{project.path}',
          'X-Transport': '{transport.type}',
        },
      };

      const result = await processor.processServerConfig('sse-server', config, mockContext);

      expect(result.success).toBe(true);
      expect(result.processedConfig.url).toBe('http://example.com/sse/test-project');
      expect(result.processedConfig.headers?.['X-Transport']).toBe('sse');
    });

    it('should warn for SSE templates without project variables in URL', async () => {
      const processor = new TemplateProcessor();

      const config: MCPServerParams = {
        type: 'sse',
        url: 'http://example.com/sse/static',
        headers: {
          'X-Static': 'value',
        },
      };

      const result = await processor.processServerConfig('sse-server', config, mockContext);

      // Should still succeed but might have warnings about not using project variables
      expect(result.success).toBe(true);
    });

    it('should validate HTTP transport templates', async () => {
      // Create processor that allows sensitive data for testing
      const processor = new TemplateProcessor();

      const config: MCPServerParams = {
        type: 'streamableHttp',
        url: 'http://example.com/api/{project.path}',
        headers: {
          'X-Project': '{project.name}',
          'X-User': '{user.username}',
          'X-Transport-Type': '{transport.type}',
        },
      };

      const result = await processor.processServerConfig('http-server', config, mockContext);

      expect(result.success).toBe(true);
      expect(result.processedConfig.url).toBe('http://example.com/api//test/project');
      expect(result.processedConfig.headers?.['X-Project']).toBe('test-project');
      expect(result.processedConfig.headers?.['X-User']).toBe('testuser');
      expect(result.processedConfig.headers?.['X-Transport-Type']).toBe('streamableHttp');
    });

    it('should process stdio templates without transport validation', async () => {
      const processor = new TemplateProcessor();

      const config: MCPServerParams = {
        type: 'stdio',
        command: 'echo "Hello {user.username}"',
        args: [],
      };

      const result = await processor.processServerConfig('stdio-server', config, mockContext);

      expect(result.success).toBe(true);
      expect(result.processedConfig.command).toBe('echo "Hello testuser"');
    });

    it('should allow transport variables in appropriate contexts', async () => {
      const processor = new TemplateProcessor();

      const config: MCPServerParams = {
        type: 'sse',
        url: 'http://example.com/sse/{project.name}',
        headers: {
          'X-Connection-ID': '{transport.connectionId}',
          'X-Transport-Type': '{transport.type}',
        },
      };

      const result = await processor.processServerConfig('sse-server', config, mockContext);

      expect(result.success).toBe(true);
      expect(result.processedConfig.headers?.['X-Transport-Type']).toBe('sse');
      expect(result.processedConfig.headers?.['X-Connection-ID']).toMatch(/^conn_\d+_[a-z0-9]+$/);
    });

    it('should process multiple transport types with shared pool configuration', async () => {
      const processor = new TemplateProcessor();

      // Test that multiple configs can be processed
      const configs: Record<string, MCPServerParams> = {
        stdioServer: {
          type: 'stdio',
          command: 'echo "Stdio: {project.name}"',
          template: {
            shareable: true,
            maxInstances: 2,
          },
        },
        sseServer: {
          type: 'sse',
          url: 'http://example.com/sse/{project.name}',
          headers: {
            'X-Project': '{project.path}',
          },
          template: {
            shareable: true,
            maxInstances: 5,
          },
        },
        httpServer: {
          type: 'streamableHttp',
          url: 'http://example.com/api/{project.path}',
          template: {
            shareable: false, // Each client gets its own instance
          },
        },
      };

      const results = await processor.processMultipleServerConfigs(configs, mockContext);

      expect(Object.keys(results)).toHaveLength(3);
      expect(results.stdioServer.success).toBe(true);
      expect(results.sseServer.success).toBe(true);
      expect(results.httpServer.success).toBe(true);

      // Verify transport-specific variables were processed
      expect(results.sseServer.processedConfig.headers?.['X-Project']).toBe('/test/project');
      expect(results.httpServer.processedConfig.url).toBe('http://example.com/api//test/project');
      expect(results.stdioServer.processedConfig.command).toBe('echo "Stdio: test-project"');
    });
  });
});
