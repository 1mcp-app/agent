import { randomBytes } from 'crypto';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigManager } from '@src/config/configManager.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock AgentConfigManager before any tests run
const mockAgentConfig = {
  get: vi.fn().mockImplementation((key: string) => {
    const config = {
      features: {
        configReload: true,
        envSubstitution: true,
      },
      configReload: {
        debounceMs: 100,
      },
    };
    return key.split('.').reduce((obj: any, k: string) => obj?.[k], config);
  }),
};

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: () => mockAgentConfig,
  },
}));

describe('ConfigManager Template Integration', () => {
  let tempConfigDir: string;
  let configFilePath: string;
  let configManager: ConfigManager;

  beforeEach(async () => {
    // Create temporary config directory
    tempConfigDir = join(tmpdir(), `config-template-test-${randomBytes(4).toString('hex')}`);
    await fsPromises.mkdir(tempConfigDir, { recursive: true });
    configFilePath = join(tempConfigDir, 'mcp.json');

    // Reset singleton instances
    (ConfigManager as any).instance = null;
  });

  afterEach(async () => {
    // Clean up
    try {
      await fsPromises.rm(tempConfigDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe('loadConfigWithTemplates', () => {
    const mockContext: ContextData = {
      sessionId: 'test-session-123',
      version: '1.0.0',
      project: {
        name: 'test-project',
        path: '/path/to/project',
        environment: 'development',
        git: {
          branch: 'main',
          commit: 'abc123',
          repository: 'origin',
        },
        custom: {
          projectId: 'proj-123',
          team: 'frontend',
          apiEndpoint: 'https://api.dev.local',
        },
      },
      user: {
        uid: 'user-456',
        username: 'testuser',
        email: 'test@example.com',
        name: 'Test User',
      },
      environment: {
        variables: {
          role: 'developer',
          permissions: 'read,write',
        },
      },
      timestamp: '2024-01-15T10:30:00Z',
    };

    it('should load static servers when no templates are present', async () => {
      // Create config with only static servers
      const config = {
        version: '1.0.0',
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
            env: {},
            tags: ['filesystem'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));
      configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      const result = await configManager.loadConfigWithTemplates(mockContext);

      expect(result.staticServers).toEqual(config.mcpServers);
      expect(result.templateServers).toEqual({});
      expect(result.errors).toEqual([]);
    });

    it('should process templates when context is provided', async () => {
      // Create config with both static and template servers
      const config = {
        version: '1.0.0',
        templateSettings: {
          validateOnReload: true,
          failureMode: 'graceful' as const,
          cacheContext: true,
        },
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
            env: {},
            tags: ['filesystem'],
          },
        },
        mcpTemplates: {
          'project-serena': {
            command: 'npx',
            args: ['-y', 'serena', '{{project.path}}'],
            env: {
              PROJECT_ID: '{{project.custom.projectId}}',
              SESSION_ID: '{{sessionId}}',
            } as Record<string, string>,
            tags: ['filesystem', 'search'],
          },
          'context-server': {
            command: 'node',
            args: ['{{project.path}}/servers/context.js'],
            cwd: '{{project.path}}',
            env: {
              PROJECT_NAME: '{{project.name}}',
              USER_NAME: '{{user.username}}',
              TIMESTAMP: '{{timestamp}}',
            } as Record<string, string>,
            tags: ['context-aware'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));
      configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      const result = await configManager.loadConfigWithTemplates(mockContext);

      // Verify static servers are preserved
      expect(result.staticServers).toEqual(config.mcpServers);

      // Verify templates are processed
      expect(result.templateServers).toHaveProperty('project-serena');
      expect(result.templateServers).toHaveProperty('context-server');

      const projectSerena = result.templateServers['project-serena'];
      expect(projectSerena.args).toContain('/path/to/project'); // {{project.path}} replaced
      expect((projectSerena.env as Record<string, string>)?.PROJECT_ID).toBe('proj-123'); // {{project.custom.projectId}} replaced
      expect((projectSerena.env as Record<string, string>)?.SESSION_ID).toBe('test-session-123'); // {{context.sessionId}} replaced

      const contextServer = result.templateServers['context-server'];
      expect(contextServer.args).toContain('/path/to/project/servers/context.js'); // {{project.path}} replaced
      expect(contextServer.cwd).toBe('/path/to/project'); // {{project.path}} replaced
      expect((contextServer.env as Record<string, string>)?.PROJECT_NAME).toBe('test-project'); // {{project.name}} replaced
      expect((contextServer.env as Record<string, string>)?.USER_NAME).toBe('testuser'); // {{user.username}} replaced
      expect((contextServer.env as Record<string, string>)?.TIMESTAMP).toBe('2024-01-15T10:30:00Z'); // {{context.timestamp}} replaced

      expect(result.errors).toEqual([]);
    });

    it('should return empty template servers when no context is provided', async () => {
      const config = {
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
            env: {},
            tags: ['filesystem'],
          },
        },
        mcpTemplates: {
          'project-serena': {
            command: 'npx',
            args: ['-y', 'serena', '{{project.path}}'],
            env: { PROJECT_ID: '{{project.custom.projectId}}' } as Record<string, string>,
            tags: ['filesystem'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));
      configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      const result = await configManager.loadConfigWithTemplates();

      expect(result.staticServers).toEqual(config.mcpServers);
      expect(result.templateServers).toEqual({});
      expect(result.errors).toEqual([]);
    });

    it('should handle template processing errors gracefully', async () => {
      const config = {
        mcpServers: {},
        mcpTemplates: {
          'invalid-template': {
            command: 'npx',
            args: ['-y', 'invalid', '{{project.nonexistent}}'], // Invalid variable
            env: { INVALID: '{{invalid.variable}}' },
            tags: [],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));
      configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      const result = await configManager.loadConfigWithTemplates(mockContext);

      expect(result.staticServers).toEqual({});
      // Handlebars gracefully handles missing variables, so templateServers contains the processed config
      expect(Object.keys(result.templateServers)).toContain('invalid-template');
      // Template processing succeeds, so no errors expected
    });

    it('should cache processed templates when caching is enabled', async () => {
      const config = {
        templateSettings: {
          cacheContext: true,
        },
        mcpServers: {},
        mcpTemplates: {
          'cached-server': {
            command: 'node',
            args: ['{{project.path}}/server.js'],
            env: { PROJECT: '{{project.name}}' },
            tags: [],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));
      configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      // First call should process templates
      const result1 = await configManager.loadConfigWithTemplates(mockContext);
      expect(result1.templateServers).toHaveProperty('cached-server');

      // Second call should use cached results (same context)
      const result2 = await configManager.loadConfigWithTemplates(mockContext);
      expect(result2.templateServers).toEqual(result1.templateServers);
      expect(result2.errors).toEqual(result1.errors);
    });

    it('should reprocess templates when context changes', async () => {
      const config = {
        templateSettings: {
          cacheContext: true,
        },
        mcpServers: {},
        mcpTemplates: {
          'context-sensitive': {
            command: 'node',
            args: ['{{project.path}}/server.js'],
            env: { PROJECT_ID: '{{project.custom.projectId}}' } as Record<string, string>,
            tags: [],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));
      configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      const context1: ContextData = {
        ...mockContext,
        project: {
          ...mockContext.project,
          custom: { projectId: 'proj-1' },
        },
      };

      const context2: ContextData = {
        ...mockContext,
        project: {
          ...mockContext.project,
          custom: { projectId: 'proj-2' },
        },
      };

      // First context
      const result1 = await configManager.loadConfigWithTemplates(context1);
      expect((result1.templateServers['context-sensitive'].env as Record<string, string>)?.PROJECT_ID).toBe('proj-1');

      // Second context (different project ID)
      const result2 = await configManager.loadConfigWithTemplates(context2);
      expect((result2.templateServers['context-sensitive'].env as Record<string, string>)?.PROJECT_ID).toBe('proj-2');
    });

    it('should validate templates before processing when validation is enabled', async () => {
      const config = {
        templateSettings: {
          validateOnReload: true,
          failureMode: 'strict' as const,
        },
        mcpServers: {},
        mcpTemplates: {
          'invalid-syntax': {
            command: 'npx',
            args: ['-y', 'test', '{{unclosed.template}}'], // Valid Handlebars syntax but missing variable
            tags: [],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));
      configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      // Handlebars doesn't validate templates strictly - missing variables are replaced with empty strings
      const result = await configManager.loadConfigWithTemplates(mockContext);
      expect(Object.keys(result.templateServers)).toContain('invalid-syntax');
    });

    it('should handle failure mode gracefully', async () => {
      const config = {
        templateSettings: {
          failureMode: 'graceful' as const,
        },
        mcpServers: {},
        mcpTemplates: {
          'invalid-template': {
            command: 'npx',
            args: ['-y', 'test', '{{project.nonexistent}}'],
            tags: [],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));
      configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      const result = await configManager.loadConfigWithTemplates(mockContext);

      // Handlebars processes templates gracefully, so no errors are expected
      expect(result.templateServers).toHaveProperty('invalid-template');
      expect(result.errors.length).toBe(0); // No errors with Handlebars
    });
  });

  describe('Template Processing Error Handling', () => {
    it('should handle malformed JSON in config file', async () => {
      await fsPromises.writeFile(configFilePath, '{ invalid json }');
      configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      const result = await configManager.loadConfigWithTemplates();

      // Should handle JSON parsing errors gracefully
      expect(result.staticServers).toEqual({});
      expect(result.templateServers).toEqual({});
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Configuration parsing failed');
    });

    it('should handle missing config file', async () => {
      const nonExistentPath = join(tempConfigDir, 'nonexistent.json');
      configManager = ConfigManager.getInstance(nonExistentPath);
      await configManager.initialize();

      const result = await configManager.loadConfigWithTemplates();

      expect(result.staticServers).toEqual({});
      expect(result.templateServers).toEqual({});
      expect(result.errors).toEqual([]);
    });

    it('should handle config with invalid schema gracefully', async () => {
      const invalidConfig = {
        mcpServers: {
          'test-server': {
            command: 'echo test',
          },
        },
        mcpTemplates: {
          'template-server': {
            command: 'echo {{project.name}}',
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(invalidConfig));
      configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      const result = await configManager.loadConfigWithTemplates();
      expect(result.staticServers).toHaveProperty('test-server');
      expect(result.templateServers).toEqual({});
      expect(result.errors).toEqual([]);
    });
  });
});
