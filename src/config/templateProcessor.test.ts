import { randomBytes } from 'crypto';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { TemplateProcessor } from '@src/config/templateProcessor.js';
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

describe('TemplateProcessor', () => {
  let tempConfigDir: string;
  let configFilePath: string;
  let templateProcessor: TemplateProcessor;

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

  beforeEach(async () => {
    tempConfigDir = join(tmpdir(), `template-processor-test-${randomBytes(4).toString('hex')}`);
    await fsPromises.mkdir(tempConfigDir, { recursive: true });
    configFilePath = join(tempConfigDir, 'mcp.json');
    templateProcessor = new TemplateProcessor();
  });

  afterEach(async () => {
    try {
      await fsPromises.rm(tempConfigDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadConfigWithTemplates', () => {
    it('should load static servers when no templates are present', async () => {
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

      const rawConfig = JSON.parse(await fsPromises.readFile(configFilePath, 'utf-8'));
      const result = await templateProcessor.loadConfigWithTemplates(rawConfig, mockContext);

      expect(result.staticServers).toEqual(config.mcpServers);
      expect(result.templateServers).toEqual({});
      expect(result.errors).toEqual([]);
    });

    it('should process templates when context is provided', async () => {
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

      const rawConfig = JSON.parse(await fsPromises.readFile(configFilePath, 'utf-8'));
      const result = await templateProcessor.loadConfigWithTemplates(rawConfig, mockContext);

      expect(result.staticServers).toEqual(config.mcpServers);
      expect(result.templateServers).toHaveProperty('project-serena');
      expect(result.templateServers).toHaveProperty('context-server');

      const projectSerena = result.templateServers['project-serena'];
      expect(projectSerena.args).toContain('/path/to/project');
      expect((projectSerena.env as Record<string, string>)?.PROJECT_ID).toBe('proj-123');
      expect((projectSerena.env as Record<string, string>)?.SESSION_ID).toBe('test-session-123');

      const contextServer = result.templateServers['context-server'];
      expect(contextServer.args).toContain('/path/to/project/servers/context.js');
      expect(contextServer.cwd).toBe('/path/to/project');
      expect((contextServer.env as Record<string, string>)?.PROJECT_NAME).toBe('test-project');
      expect((contextServer.env as Record<string, string>)?.USER_NAME).toBe('testuser');
      expect((contextServer.env as Record<string, string>)?.TIMESTAMP).toBe('2024-01-15T10:30:00Z');

      expect(result.errors).toEqual([]);
    });

    it('should substitute client information template variables', async () => {
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
          'client-aware-server': {
            command: 'node',
            args: ['{{project.path}}/servers/client-aware.js'],
            cwd: '{{project.path}}',
            env: {
              PROJECT_NAME: '{{project.name}}',
              CLIENT_NAME: '{{transport.client.name}}',
              CLIENT_VERSION: '{{transport.client.version}}',
              CLIENT_TITLE: '{{transport.client.title}}',
              TRANSPORT_TYPE: '{{transport.type}}',
              CONNECTION_TIME: '{{transport.connectionTimestamp}}',
              IS_CLAUDE_CODE: '{{#if (eq transport.client.name "claude-code")}}true{{else}}false{{/if}}',
              CLIENT_INFO_AVAILABLE: '{{#if transport.client}}true{{else}}false{{/if}}',
            } as Record<string, string>,
            tags: ['client-aware'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));

      const rawConfig = JSON.parse(await fsPromises.readFile(configFilePath, 'utf-8'));

      const mockContextWithClient = {
        ...mockContext,
        transport: {
          type: 'stdio-proxy',
          connectionTimestamp: '2024-01-15T10:35:00Z',
          client: {
            name: 'claude-code',
            version: '1.0.0',
            title: 'Claude Code',
          },
        },
      };

      const result = await templateProcessor.loadConfigWithTemplates(rawConfig, mockContextWithClient);

      expect(result.templateServers).toHaveProperty('client-aware-server');
      const clientAwareServer = result.templateServers['client-aware-server'];

      expect(clientAwareServer.args).toContain('/path/to/project/servers/client-aware.js');
      expect(clientAwareServer.cwd).toBe('/path/to/project');
      expect((clientAwareServer.env as Record<string, string>)?.PROJECT_NAME).toBe('test-project');
      expect((clientAwareServer.env as Record<string, string>)?.CLIENT_NAME).toBe('claude-code');
      expect((clientAwareServer.env as Record<string, string>)?.CLIENT_VERSION).toBe('1.0.0');
      expect((clientAwareServer.env as Record<string, string>)?.CLIENT_TITLE).toBe('Claude Code');
      expect((clientAwareServer.env as Record<string, string>)?.TRANSPORT_TYPE).toBe('stdio-proxy');
      expect((clientAwareServer.env as Record<string, string>)?.CONNECTION_TIME).toBe('2024-01-15T10:35:00Z');
      expect((clientAwareServer.env as Record<string, string>)?.IS_CLAUDE_CODE).toBe('true');
      expect((clientAwareServer.env as Record<string, string>)?.CLIENT_INFO_AVAILABLE).toBe('true');

      expect(result.errors).toEqual([]);
    });

    it('should handle missing client information gracefully', async () => {
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
          'fallback-server': {
            command: 'node',
            args: ['{{project.path}}/servers/fallback.js'],
            env: {
              PROJECT_NAME: '{{project.name}}',
              CLIENT_NAME: '{{transport.client.name}}',
              CLIENT_TITLE: '{{transport.client.title}}',
              CLIENT_INFO_AVAILABLE: '{{#if transport.client}}true{{else}}false{{/if}}',
            } as Record<string, string>,
            tags: ['fallback'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));

      const rawConfig = JSON.parse(await fsPromises.readFile(configFilePath, 'utf-8'));
      const result = await templateProcessor.loadConfigWithTemplates(rawConfig, mockContext);

      expect(result.templateServers).toHaveProperty('fallback-server');
      const fallbackServer = result.templateServers['fallback-server'];

      expect((fallbackServer.env as Record<string, string>)?.PROJECT_NAME).toBe('test-project');
      expect((fallbackServer.env as Record<string, string>)?.CLIENT_NAME).toBe('');
      expect((fallbackServer.env as Record<string, string>)?.CLIENT_TITLE).toBe('');
      expect((fallbackServer.env as Record<string, string>)?.CLIENT_INFO_AVAILABLE).toBe('false');

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

      const rawConfig = JSON.parse(await fsPromises.readFile(configFilePath, 'utf-8'));
      const result = await templateProcessor.loadConfigWithTemplates(rawConfig);

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
            args: ['-y', 'invalid', '{{project.nonexistent}}'],
            env: { INVALID: '{{invalid.variable}}' },
            tags: [],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));

      const rawConfig = JSON.parse(await fsPromises.readFile(configFilePath, 'utf-8'));
      const result = await templateProcessor.loadConfigWithTemplates(rawConfig, mockContext);

      expect(result.staticServers).toEqual({});
      expect(Object.keys(result.templateServers)).toContain('invalid-template');
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

      const rawConfig = JSON.parse(await fsPromises.readFile(configFilePath, 'utf-8'));

      const result1 = await templateProcessor.loadConfigWithTemplates(rawConfig, mockContext);
      expect(result1.templateServers).toHaveProperty('cached-server');

      const result2 = await templateProcessor.loadConfigWithTemplates(rawConfig, mockContext);
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

      const rawConfig = JSON.parse(await fsPromises.readFile(configFilePath, 'utf-8'));

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

      const result1 = await templateProcessor.loadConfigWithTemplates(rawConfig, context1);
      expect((result1.templateServers['context-sensitive'].env as Record<string, string>)?.PROJECT_ID).toBe('proj-1');

      const result2 = await templateProcessor.loadConfigWithTemplates(rawConfig, context2);
      expect((result2.templateServers['context-sensitive'].env as Record<string, string>)?.PROJECT_ID).toBe('proj-2');
    });

    it('should handle malformed JSON in config', async () => {
      const result = await templateProcessor.loadConfigWithTemplates({ invalid: 'data' }, mockContext);

      expect(result.staticServers).toEqual({});
      expect(result.templateServers).toEqual({});
    });
  });

  describe('clearTemplateCache', () => {
    it('should clear the template cache', async () => {
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

      const rawConfig = JSON.parse(await fsPromises.readFile(configFilePath, 'utf-8'));

      // First call should process templates
      const result1 = await templateProcessor.loadConfigWithTemplates(rawConfig, mockContext);
      expect(result1.templateServers).toHaveProperty('cached-server');

      // Clear cache
      templateProcessor.clearTemplateCache();

      // Second call should reprocess templates (not use cache)
      const result2 = await templateProcessor.loadConfigWithTemplates(rawConfig, mockContext);
      expect(result2.templateServers).toHaveProperty('cached-server');
    });
  });

  describe('getTemplateProcessingErrors', () => {
    it('should return empty array when no errors', () => {
      expect(templateProcessor.getTemplateProcessingErrors()).toEqual([]);
    });
  });

  describe('hasTemplateProcessingErrors', () => {
    it('should return false when no errors', () => {
      expect(templateProcessor.hasTemplateProcessingErrors()).toBe(false);
    });
  });
});
