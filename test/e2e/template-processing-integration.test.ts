import { randomBytes } from 'crypto';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigManager } from '@src/config/configManager.js';
import { getGlobalContextManager } from '@src/core/context/globalContextManager.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { setupServer } from '@src/server.js';
import { TemplateDetector } from '@src/template/templateDetector.js';
import { contextMiddleware, createContextHeaders } from '@src/transport/http/middlewares/contextMiddleware.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Template Processing Integration', () => {
  let tempConfigDir: string;
  let configFilePath: string;
  let projectConfigPath: string;
  let mockContext: ContextData;

  beforeEach(async () => {
    // Create temporary directories
    tempConfigDir = join(tmpdir(), `template-integration-test-${randomBytes(4).toString('hex')}`);
    await fsPromises.mkdir(tempConfigDir, { recursive: true });

    configFilePath = join(tempConfigDir, 'mcp.json');
    projectConfigPath = join(tempConfigDir, '.1mcprc');

    // Reset singleton instances
    (ConfigManager as any).instance = null;
    (ServerManager as any).instance = null;

    // Mock context data
    mockContext = {
      sessionId: 'integration-test-session',
      version: '1.0.0',
      project: {
        name: 'integration-test-project',
        path: tempConfigDir,
        environment: 'test',
        git: {
          branch: 'main',
          commit: 'abc123def',
          repository: 'origin',
        },
        custom: {
          projectId: 'proj-integration-123',
          team: 'testing',
          apiEndpoint: 'https://api.test.local',
          debugMode: true,
        },
      },
      user: {
        uid: 'user-integration-456',
        username: 'testuser',
        email: 'test@example.com',
        name: 'Test User',
      },
      environment: {
        variables: {
          role: 'tester',
          permissions: 'read,write,test',
        },
      },
      timestamp: '2024-01-15T10:30:00Z',
    };

    // Mock AgentConfigManager
    vi.mock('@src/core/server/agentConfig.js', () => ({
      AgentConfigManager: {
        getInstance: () => ({
          get: vi.fn().mockReturnValue({
            features: {
              configReload: true,
              enhancedSecurity: false,
            },
            configReload: { debounceMs: 100 },
            asyncLoading: { enabled: false },
            trustProxy: false,
            rateLimit: { windowMs: 60000, max: 100 },
            auth: { sessionStoragePath: tempConfigDir },
            getUrl: () => 'http://localhost:3050',
            getConfig: () => ({ port: 3050, host: 'localhost' }),
          }),
        }),
      },
    }));

    // Mock file system watchers
    vi.mock('fs', async () => {
      const actual = await vi.importActual<typeof fs>('fs');
      return {
        ...actual,
        watchFile: vi.fn(),
        unwatchFile: vi.fn(),
      };
    });
  });

  afterEach(async () => {
    // Clean up
    try {
      await fsPromises.rm(tempConfigDir, { recursive: true, force: true });
      vi.clearAllMocks();
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe('Complete Template Processing Flow', () => {
    it('should process templates from .1mcprc context through to server configuration', async () => {
      // Create project configuration
      const projectConfig = {
        context: {
          projectId: 'proj-integration-123',
          environment: 'test',
          team: 'testing',
          custom: {
            apiEndpoint: 'https://api.test.local',
            debugMode: true,
          },
          envPrefixes: ['TEST_', 'APP_'],
          includeGit: true,
          sanitizePaths: true,
        },
      };

      await fsPromises.writeFile(projectConfigPath, JSON.stringify(projectConfig, null, 2));

      // Create MCP configuration with templates
      const mcpConfig = {
        version: '1.0.0',
        templateSettings: {
          validateOnReload: true,
          failureMode: 'graceful' as const,
          cacheContext: true,
        },
        mcpServers: {
          'static-filesystem': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
            env: {},
            tags: ['filesystem', 'static'],
          },
        },
        mcpTemplates: {
          'project-serena': {
            command: 'npx',
            args: ['-y', 'serena', '{project.path}'],
            env: {
              PROJECT_ID: '{project.custom.projectId}',
              SESSION_ID: '{sessionId}',
              ENVIRONMENT: '{project.environment}',
              TEAM: '{project.custom.team}',
            },
            tags: ['filesystem', 'project'],
          },
          'api-server': {
            command: 'node',
            args: ['{project.path}/api/server.js'],
            cwd: '{project.path}',
            env: {
              API_ENDPOINT: '{project.custom.apiEndpoint}',
              NODE_ENV: '{project.environment}',
              PROJECT_NAME: '{project.name}',
              USER_ROLE: '{user.custom.role}',
            },
            tags: ['api', 'development'],
            disabled: '{?project.environment=production}',
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(mcpConfig, null, 2));

      // Initialize ConfigManager and process templates
      const configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      const result = await configManager.loadConfigWithTemplates(mockContext);

      // Verify static servers are preserved
      expect(result.staticServers).toHaveProperty('static-filesystem');
      expect(result.staticServers['static-filesystem']).toEqual(mcpConfig.mcpServers['static-filesystem']);

      // Verify templates are processed correctly
      expect(result.templateServers).toHaveProperty('project-serena');
      expect(result.templateServers).toHaveProperty('api-server');

      const projectSerena = result.templateServers['project-serena'];
      expect(projectSerena.args).toContain(tempConfigDir); // {project.path} replaced
      expect((projectSerena.env as Record<string, string>)?.PROJECT_ID).toBe('proj-integration-123'); // {project.custom.projectId} replaced
      expect((projectSerena.env as Record<string, string>)?.SESSION_ID).toBe('integration-test-session'); // {sessionId} replaced
      expect((projectSerena.env as Record<string, string>)?.ENVIRONMENT).toBe('test'); // {project.environment} replaced
      expect((projectSerena.env as Record<string, string>)?.TEAM).toBe('testing'); // {project.custom.team} replaced

      const apiServer = result.templateServers['api-server'];
      expect(apiServer.args).toContain(`${tempConfigDir}/api/server.js`); // {project.path} replaced
      expect(apiServer.cwd).toBe(tempConfigDir); // {project.path} replaced
      expect((apiServer.env as Record<string, string>)?.API_ENDPOINT).toBe('https://api.test.local'); // {project.custom.apiEndpoint} replaced
      expect((apiServer.env as Record<string, string>)?.NODE_ENV).toBe('test'); // {project.environment} replaced
      expect((apiServer.env as Record<string, string>)?.PROJECT_NAME).toBe('integration-test-project'); // {project.name} replaced
      expect((apiServer.env as Record<string, string>)?.USER_ROLE).toBe('tester'); // {user.custom.role} replaced
      expect(apiServer.disabled).toBe(false); // {project.environment} != 'production'

      expect(result.errors).toEqual([]);
    });

    it('should handle template processing errors gracefully without blocking static servers', async () => {
      // Create MCP configuration with invalid templates
      const mcpConfig = {
        mcpServers: {
          'working-server': {
            command: 'echo',
            args: ['hello'],
            env: {},
            tags: ['working'],
          },
        },
        mcpTemplates: {
          'invalid-template': {
            command: 'npx',
            args: ['-y', 'invalid', '{project.nonexistent}'], // Invalid variable
            env: { INVALID: '{invalid.variable}' },
            tags: ['invalid'],
          },
          'syntax-error': {
            command: 'npx',
            args: ['-y', 'syntax', '{unclosed.template'], // Syntax error
            env: {},
            tags: ['syntax'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(mcpConfig, null, 2));

      const configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      const result = await configManager.loadConfigWithTemplates(mockContext);

      // Static servers should still work
      expect(result.staticServers).toHaveProperty('working-server');
      expect(result.staticServers['working-server']).toEqual(mcpConfig.mcpServers['working-server']);

      // Template processing should fail gracefully
      expect(result.templateServers).toEqual({});
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('invalid-template'))).toBe(true);
      expect(result.errors.some((e) => e.includes('syntax-error'))).toBe(true);
    });
  });

  describe('Context Middleware Integration', () => {
    it('should extract context from HTTP headers and update global context', async () => {
      // Create request with context headers
      const headers = createContextHeaders(mockContext);
      const mockRequest: any = {
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        locals: {},
      };

      const mockResponse: any = {};
      const mockNext = vi.fn();

      const globalContextManager = getGlobalContextManager();

      // Apply context middleware
      const middleware = contextMiddleware();
      middleware(mockRequest, mockResponse, mockNext);

      // Verify middleware behavior
      expect(mockNext).toHaveBeenCalled();
      expect(mockRequest.locals.hasContext).toBe(true);
      expect(mockRequest.locals.context).toEqual(mockContext);

      // Verify global context was updated
      expect(globalContextManager.getContext()).toEqual(mockContext);
    });

    it('should handle context changes and trigger template reprocessing', async () => {
      // Create initial configuration
      const mcpConfig = {
        templateSettings: {
          cacheContext: true,
        },
        mcpServers: {},
        mcpTemplates: {
          'context-dependent': {
            command: 'node',
            args: ['{project.path}/server.js'],
            env: {
              PROJECT_ID: '{project.custom.projectId}',
              ENVIRONMENT: '{project.environment}',
            },
            tags: ['context'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(mcpConfig, null, 2));

      const configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      const globalContextManager = getGlobalContextManager();
      const changeListener = vi.fn();
      globalContextManager.on('context-changed', changeListener);

      // Process with initial context
      const result1 = await configManager.loadConfigWithTemplates(mockContext);
      expect((result1.templateServers['context-dependent'].env as Record<string, string>)?.PROJECT_ID).toBe(
        'proj-integration-123',
      );

      // Change context
      const newContext: ContextData = {
        ...mockContext,
        project: {
          ...mockContext.project,
          custom: {
            ...mockContext.project.custom,
            projectId: 'new-project-id',
          },
          environment: 'staging',
        },
      };

      globalContextManager.updateContext(newContext);

      // Verify change event was emitted
      expect(changeListener).toHaveBeenCalledWith({
        oldContext: mockContext,
        newContext: newContext,
        sessionIdChanged: false,
      });

      // Process with new context
      const result2 = await configManager.loadConfigWithTemplates(newContext);
      expect((result2.templateServers['context-dependent'].env as Record<string, string>)?.PROJECT_ID).toBe(
        'new-project-id',
      );
      expect((result2.templateServers['context-dependent'].env as Record<string, string>)?.ENVIRONMENT).toBe('staging');
    });
  });

  describe('Template Detection and Validation', () => {
    it('should detect and prevent templates in static server configurations', () => {
      const configWithTemplates = {
        command: 'npx',
        args: ['-y', 'server', '{project.path}'], // Template in static config
        env: {
          PROJECT_ID: '{project.custom.projectId}', // Template in static config
        },
      };

      const detection = TemplateDetector.validateTemplateFree(configWithTemplates);

      expect(detection.valid).toBe(false);
      expect(detection.templates).toContain('{project.path}');
      expect(detection.templates).toContain('{project.custom.projectId}');
      expect(detection.locations).toContain('command: "npx -y server {project.path}"');
    });

    it('should allow templates in template server configurations', () => {
      const templateConfig = {
        command: 'npx',
        args: ['-y', 'server', '{project.path}'], // Template allowed here
        env: {
          PROJECT_ID: '{project.custom.projectId}', // Template allowed here
        },
      };

      // This should not throw when processed as templates
      expect(() => {
        TemplateDetector.validateTemplateSyntax(templateConfig);
      }).not.toThrow();

      const validation = TemplateDetector.validateTemplateSyntax(templateConfig);
      expect(validation.hasTemplates).toBe(true);
      expect(validation.isValid).toBe(true);
    });
  });

  describe('Server Setup Integration', () => {
    it('should integrate template processing into server setup', async () => {
      // Create configuration
      const mcpConfig = {
        mcpServers: {
          'static-server': {
            command: 'echo',
            args: ['static'],
            env: {},
            tags: ['static'],
          },
        },
        mcpTemplates: {
          'dynamic-server': {
            command: 'echo',
            args: ['{project.name}'],
            env: {
              PROJECT_ID: '{project.custom.projectId}',
            },
            tags: ['dynamic'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(mcpConfig, null, 2));

      // Mock the transport factory and related dependencies
      vi.mock('@src/transport/transportFactory.js', () => ({
        createTransports: vi.fn().mockReturnValue({}),
      }));

      vi.mock('@src/core/client/clientManager.js', () => ({
        ClientManager: {
          getOrCreateInstance: vi.fn().mockReturnValue({
            setInstructionAggregator: vi.fn(),
            createClients: vi.fn().mockResolvedValue(new Map()),
            initializeClientsAsync: vi.fn().mockReturnValue({}),
          }),
        },
      }));

      vi.mock('@src/core/instructions/instructionAggregator.js', () => ({
        InstructionAggregator: vi.fn().mockImplementation(() => ({
          aggregateInstructions: vi.fn().mockResolvedValue([]),
        })),
      }));

      vi.mock('@src/domains/preset/manager/presetManager.js', () => ({
        PresetManager: {
          getInstance: vi.fn().mockReturnValue({
            initialize: vi.fn().mockResolvedValue(undefined),
            onPresetChange: vi.fn(),
          }),
        },
      }));

      vi.mock('@src/domains/preset/services/presetNotificationService.js', () => ({
        PresetNotificationService: {
          getInstance: vi.fn().mockReturnValue({
            notifyPresetChange: vi.fn().mockResolvedValue(undefined),
          }),
        },
      }));

      // Mock server manager to avoid actual server startup
      vi.mock('@src/core/server/serverManager.js', () => ({
        ServerManager: {
          getOrCreateInstance: vi.fn().mockReturnValue({
            setInstructionAggregator: vi.fn(),
            initialize: vi.fn().mockResolvedValue(undefined),
          }),
        },
      }));

      // Setup server with context (should trigger template processing)
      const setupResult = await setupServer(configFilePath, mockContext);

      // Verify the setup completed without errors
      expect(setupResult).toBeDefined();
      expect(setupResult.serverManager).toBeDefined();
      expect(setupResult.loadingManager).toBeDefined();
      expect(setupResult.instructionAggregator).toBeDefined();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed configuration files', async () => {
      // Write invalid JSON
      await fsPromises.writeFile(configFilePath, '{ invalid json }');

      const configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      const result = await configManager.loadConfigWithTemplates(mockContext);

      // Should gracefully handle invalid JSON
      expect(result.staticServers).toEqual({});
      expect(result.templateServers).toEqual({});
      expect(result.errors).toEqual([]);
    });

    it('should handle missing configuration file', async () => {
      const nonExistentPath = join(tempConfigDir, 'nonexistent.json');
      const configManager = ConfigManager.getInstance(nonExistentPath);
      await configManager.initialize();

      const result = await configManager.loadConfigWithTemplates(mockContext);

      // Should handle missing file gracefully
      expect(result.staticServers).toEqual({});
      expect(result.templateServers).toEqual({});
      expect(result.errors).toEqual([]);
    });

    it('should handle circular dependencies in template processing', async () => {
      // This tests for potential infinite loops or stack overflow
      const config = {
        mcpServers: {},
        mcpTemplates: {
          'circular-template': {
            command: 'echo',
            args: ['{project.path}'],
            env: {
              PATH: '{project.path}', // Same variable used multiple times
              PROJECT: '{project.name}',
              NAME: '{project.name}', // Duplicate variable
            },
            tags: [],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));

      const configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();

      // Should complete without hanging or crashing
      const startTime = Date.now();
      const result = await configManager.loadConfigWithTemplates(mockContext);
      const endTime = Date.now();

      // Should complete quickly (not hang)
      expect(endTime - startTime).toBeLessThan(1000); // 1 second max
      expect(result.templateServers).toHaveProperty('circular-template');
      expect(result.errors).toEqual([]);
    });
  });
});
