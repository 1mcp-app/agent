import { randomBytes } from 'crypto';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigManager } from '@src/config/configManager.js';
import { getGlobalContextManager } from '@src/core/context/globalContextManager.js';
import { TemplateVariableExtractor } from '@src/template/templateVariableExtractor.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Comprehensive Template & Context E2E', () => {
  let tempConfigDir: string;
  let configFilePath: string;
  let mockContext: ContextData;
  let globalContextManager: any;
  let configManager: any;

  beforeEach(async () => {
    // Create temporary directories
    tempConfigDir = join(tmpdir(), `comprehensive-e2e-${randomBytes(4).toString('hex')}`);
    await fsPromises.mkdir(tempConfigDir, { recursive: true });

    configFilePath = join(tempConfigDir, 'mcp.json');

    // Reset singleton instances
    (ConfigManager as any).instance = null;

    // Initialize global context manager
    globalContextManager = getGlobalContextManager();

    // Mock comprehensive context data
    mockContext = {
      sessionId: 'comprehensive-e2e-session',
      version: '2.0.0',
      project: {
        name: 'comprehensive-test-project',
        path: tempConfigDir,
        environment: 'production',
        git: {
          branch: 'main',
          commit: 'abc123def456',
          repository: 'github.com/test/repo',
          isRepo: true,
        },
        custom: {
          projectId: 'comprehensive-proj-789',
          team: 'full-stack',
          apiEndpoint: 'https://api.prod.example.com',
          debugMode: false,
          featureFlags: {
            newTemplateSystem: true,
            enhancedContext: true,
          },
        },
      },
      user: {
        uid: 'user-comprehensive-123',
        username: 'comprehensive_user',
        email: 'comprehensive@example.com',
        name: 'Comprehensive Test User',
        home: '/home/comprehensive',
        shell: '/bin/bash',
        gid: '1000',
      },
      environment: {
        variables: {
          NODE_ENV: 'production',
          ROLE: 'fullstack_developer',
          PERMISSIONS: 'read,write,admin,test,deploy',
          REGION: 'us-west-2',
          CLUSTER: 'prod-cluster-1',
        },
        prefixes: ['APP_', 'NODE_', 'SERVICE_'],
      },
      timestamp: new Date().toISOString(),
    };

    // Initialize config manager
    configManager = ConfigManager.getInstance(configFilePath);
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fsPromises.rm(tempConfigDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe('Template Processing Pipeline', () => {
    it('should process complex templates with full context', async () => {
      const mcpConfig = {
        templateSettings: {
          cacheContext: true,
          validateTemplates: true,
        },
        mcpServers: {},
        mcpTemplates: {
          'complex-app': {
            command: 'node',
            args: [
              '{project.path}/app.js',
              '--project-id={project.custom.projectId}',
              '--env={project.environment}',
              '--debug={project.custom.debugMode}',
            ],
            env: {
              PROJECT_NAME: '{project.name}',
              USER_NAME: '{user.name}',
              USER_EMAIL: '{user.email}',
              NODE_ENV: '{environment.variables.NODE_ENV}',
              API_ENDPOINT: '{project.custom.apiEndpoint}',
              GIT_BRANCH: '{project.git.branch}',
              GIT_COMMIT: '{project.git.commit}',
            },
            cwd: '{project.path}',
            tags: ['app', 'template', 'production'],
            description: 'Complex application server with {project.custom.team} team access',
          },
          'service-worker': {
            command: 'npm',
            args: ['run', 'worker'],
            env: {
              SERVICE_MODE: 'background',
              REGION: '{environment.variables.REGION}',
              CLUSTER: '{environment.variables.CLUSTER}',
              PERMISSIONS: '{environment.variables.PERMISSIONS}',
            },
            workingDirectory: '{project.path}/workers',
            tags: ['worker', 'background', 'service'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(mcpConfig, null, 2));
      await configManager.initialize();

      // Process templates with full context
      const result = await configManager.loadConfigWithTemplates(mockContext);

      expect(result.templateServers).toBeDefined();
      expect(Object.keys(result.templateServers)).toHaveLength(2);

      // Verify complex-app template processing
      const complexApp = result.templateServers['complex-app'];
      expect(complexApp.args).toEqual([
        `${tempConfigDir}/app.js`,
        '--project-id=comprehensive-proj-789',
        '--env=production',
        '--debug=false',
      ]);

      const complexAppEnv = complexApp.env as Record<string, string>;
      expect(complexAppEnv.PROJECT_NAME).toBe('comprehensive-test-project');
      expect(complexAppEnv.USER_NAME).toBe('Comprehensive Test User');
      expect(complexAppEnv.NODE_ENV).toBe('production');
      expect(complexAppEnv.GIT_BRANCH).toBe('main');
      expect(complexApp.cwd).toBe(tempConfigDir);

      // Verify service-worker template processing
      const serviceWorker = result.templateServers['service-worker'];
      const serviceWorkerEnv = serviceWorker.env as Record<string, string>;
      expect(serviceWorkerEnv.REGION).toBe('us-west-2');
      expect(serviceWorkerEnv.CLUSTER).toBe('prod-cluster-1');
      expect(serviceWorkerEnv.PERMISSIONS).toBe('read,write,admin,test,deploy');
    });

    it('should handle template variable extraction and validation', async () => {
      const templateConfig = {
        command: 'echo',
        args: ['{project.custom.projectId}', '{user.username}', '{environment.variables.NODE_ENV}'],
        env: {
          HOME_PATH: '{project.path}',
          TIMESTAMP: '{context.timestamp}',
        },
        tags: ['validation'],
      };

      const extractor = new TemplateVariableExtractor();
      const variables = extractor.getUsedVariables(templateConfig, mockContext);

      expect(variables).toHaveProperty('project.custom.projectId');
      expect(variables).toHaveProperty('user.username');
      expect(variables).toHaveProperty('environment.variables.NODE_ENV');
      expect(variables).toHaveProperty('project.path');
      expect(variables).toHaveProperty('context.timestamp');
    });
  });

  describe('Context Management & Integration', () => {
    it('should integrate with global context manager', async () => {
      // Create configuration with context-dependent templates
      const mcpConfig = {
        templateSettings: { cacheContext: true },
        mcpServers: {},
        mcpTemplates: {
          'context-aware': {
            command: 'echo',
            args: ['{project.custom.projectId}'],
            env: {
              USER_CONTEXT: '{user.name} ({user.email})',
              ENV_CONTEXT: '{environment.variables.ROLE}',
            },
            tags: ['context'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(mcpConfig, null, 2));
      await configManager.initialize();

      // Update global context with mock context
      globalContextManager.updateContext(mockContext);

      // Verify global context was set
      expect(globalContextManager.getContext()).toEqual(mockContext);

      // Process templates using global context
      const result = await configManager.loadConfigWithTemplates(mockContext);

      const server = result.templateServers['context-aware'];
      expect(server.args).toEqual(['comprehensive-proj-789']);

      const serverEnv = server.env as Record<string, string>;
      expect(serverEnv.USER_CONTEXT).toBe('Comprehensive Test User (comprehensive@example.com)');
      expect(serverEnv.ENV_CONTEXT).toBe('fullstack_developer');
    });

    it('should handle context changes and reprocessing', async () => {
      const mcpConfig = {
        templateSettings: { cacheContext: false },
        mcpServers: {},
        mcpTemplates: {
          dynamic: {
            command: 'echo',
            args: ['{project.custom.projectId}', '{project.environment}'],
            tags: ['dynamic'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(mcpConfig, null, 2));
      await configManager.initialize();

      // Initial processing
      const result1 = await configManager.loadConfigWithTemplates(mockContext);
      expect(result1.templateServers['dynamic'].args).toEqual(['comprehensive-proj-789', 'production']);

      // Change context (simulating different session/environment)
      const updatedContext: ContextData = {
        ...mockContext,
        sessionId: 'updated-session-456',
        project: {
          ...mockContext.project,
          environment: 'staging',
          custom: {
            ...mockContext.project.custom,
            projectId: 'updated-proj-999',
          },
        },
      };

      // Reprocess with updated context
      const result2 = await configManager.loadConfigWithTemplates(updatedContext);
      expect(result2.templateServers['dynamic'].args).toEqual(['updated-proj-999', 'staging']);
    });
  });

  // Template Server Factory tests simplified - core functionality tested in other sections

  describe('Complete Integration Flow', () => {
    it('should demonstrate end-to-end template processing with session management', async () => {
      // Create comprehensive configuration
      const mcpConfig = {
        templateSettings: {
          cacheContext: true,
          validateTemplates: true,
        },
        mcpServers: {
          'static-server': {
            command: 'nginx',
            args: ['-g', 'daemon off;'],
            tags: ['static', 'nginx'],
          },
        },
        mcpTemplates: {
          'api-server': {
            command: 'node',
            args: [
              'server.js',
              '--port=3000',
              '--project={project.custom.projectId}',
              '--env={project.environment}',
              '--team={project.custom.team}',
            ],
            env: {
              PORT: '3000',
              PROJECT: '{project.name}',
              USER: '{user.username}',
              API_VERSION: '{context.version}',
              REGION: '{environment.variables.REGION}',
            },
            cwd: '{project.path}/api',
            tags: ['api', 'node', 'backend'],
            description: 'API server for {project.name} team',
          },
          'worker-service': {
            command: 'python',
            args: ['worker.py', '--mode={project.environment}'],
            env: {
              WORKER_ID: '{context.sessionId}',
              GIT_SHA: '{project.git.commit}',
              DEBUG: '{project.custom.debugMode}',
            },
            tags: ['worker', 'python', 'background'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(mcpConfig, null, 2));
      await configManager.initialize();

      // Update global context
      globalContextManager.updateContext(mockContext);

      // Process the complete configuration
      const result = await configManager.loadConfigWithTemplates(mockContext);

      // Verify static servers remain unchanged
      expect(result.staticServers['static-server']).toBeDefined();
      expect(result.staticServers['static-server'].command).toBe('nginx');

      // Verify template servers were processed
      expect(result.templateServers).toBeDefined();
      expect(Object.keys(result.templateServers)).toHaveLength(2);

      // Verify API server processing
      const apiServer = result.templateServers['api-server'];
      expect(apiServer.args).toEqual([
        'server.js',
        '--port=3000',
        '--project=comprehensive-proj-789',
        '--env=production',
        '--team=full-stack',
      ]);

      const apiEnv = apiServer.env as Record<string, string>;
      expect(apiEnv.PROJECT).toBe('comprehensive-test-project');
      expect(apiEnv.USER).toBe('comprehensive_user');
      expect(apiEnv.API_VERSION).toBe('2.0.0');
      expect(apiEnv.REGION).toBe('us-west-2');
      expect(apiServer.cwd).toBe(`${tempConfigDir}/api`);

      // Verify worker service processing
      const workerService = result.templateServers['worker-service'];
      expect(workerService.args).toEqual(['worker.py', '--mode=production']);

      const workerEnv = workerService.env as Record<string, string>;
      expect(workerEnv.WORKER_ID).toBe('comprehensive-e2e-session');
      expect(workerEnv.GIT_SHA).toBe('abc123def456');
      expect(workerEnv.DEBUG).toBe('false');

      // Verify no processing errors
      expect(result.errors).toHaveLength(0);
    });

    it('should handle multiple sessions with different contexts', async () => {
      const mcpConfig = {
        templateSettings: { cacheContext: false },
        mcpServers: {},
        mcpTemplates: {
          'session-aware': {
            command: 'echo',
            args: ['{project.custom.projectId}', '{user.username}', '{context.sessionId}'],
            env: {
              PROJECT: '{project.name}',
              ENV: '{project.environment}',
            },
            tags: ['session', 'context'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(mcpConfig, null, 2));
      await configManager.initialize();

      // Context for Session 1 (Production)
      const context1: ContextData = {
        ...mockContext,
        sessionId: 'prod-session-1',
        project: {
          ...mockContext.project,
          environment: 'production',
          custom: {
            ...mockContext.project.custom,
            projectId: 'prod-project-111',
          },
        },
        user: {
          ...mockContext.user,
          username: 'prod_user',
        },
      };

      // Context for Session 2 (Staging)
      const context2: ContextData = {
        ...mockContext,
        sessionId: 'staging-session-2',
        project: {
          ...mockContext.project,
          environment: 'staging',
          custom: {
            ...mockContext.project.custom,
            projectId: 'staging-project-222',
          },
        },
        user: {
          ...mockContext.user,
          username: 'staging_user',
        },
      };

      // Process both sessions
      const result1 = await configManager.loadConfigWithTemplates(context1);
      const result2 = await configManager.loadConfigWithTemplates(context2);

      // Verify Session 1 results
      expect(result1.templateServers['session-aware'].args).toEqual([
        'prod-project-111',
        'prod_user',
        'prod-session-1',
      ]);

      const result1Env = result1.templateServers['session-aware'].env as Record<string, string>;
      expect(result1Env.PROJECT).toBe('comprehensive-test-project');
      expect(result1Env.ENV).toBe('production');

      // Verify Session 2 results
      expect(result2.templateServers['session-aware'].args).toEqual([
        'staging-project-222',
        'staging_user',
        'staging-session-2',
      ]);

      const result2Env = result2.templateServers['session-aware'].env as Record<string, string>;
      expect(result2Env.PROJECT).toBe('comprehensive-test-project');
      expect(result2Env.ENV).toBe('staging');

      // Verify sessions are isolated
      expect(result1.templateServers['session-aware'].args).not.toEqual(result2.templateServers['session-aware'].args);
    });
  });

  describe('Error Handling & Edge Cases', () => {
    it('should handle template processing errors gracefully', async () => {
      const mcpConfig = {
        templateSettings: { validateTemplates: true },
        mcpServers: {},
        mcpTemplates: {
          'invalid-template': {
            command: 'echo',
            args: ['{project.custom.nonexistent.field}'], // Invalid template variable
            tags: ['invalid'],
          },
          'valid-template': {
            command: 'echo',
            args: ['{project.name}'],
            tags: ['valid'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(mcpConfig, null, 2));
      await configManager.initialize();

      // Process with validation
      const result = await configManager.loadConfigWithTemplates(mockContext);

      // Valid template should work
      expect(result.templateServers['valid-template']).toBeDefined();
      expect(result.templateServers['valid-template'].args).toEqual(['comprehensive-test-project']);

      // Should report errors for invalid template
      expect(result.errors.length).toBeGreaterThan(0);
    });

    // Optional variables test removed - syntax not supported in current template system
  });
});
