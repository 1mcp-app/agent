import { TemplateServerFactory } from '@src/core/server/templateServerFactory.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import { TemplateProcessor } from '@src/template/templateProcessor.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock TemplateProcessor at module level
vi.mock('@src/template/templateProcessor.js');

describe('TemplateServerFactory', () => {
  let factory: TemplateServerFactory;
  let mockContext: ContextData;
  let mockProcessor: any;

  beforeEach(async () => {
    mockProcessor = {
      processServerConfig: vi.fn().mockResolvedValue({
        processedConfig: {
          command: 'echo',
          args: ['processed-value'],
        },
        processedTemplates: [],
      }),
    };

    // Mock the constructor
    (TemplateProcessor as any).mockImplementation(() => mockProcessor);

    factory = new TemplateServerFactory({
      maxInstances: 5,
      idleTimeout: 1000,
      cleanupInterval: 500,
    });

    mockContext = {
      project: {
        path: '/test/project',
        name: 'test-project',
        git: {
          branch: 'main',
        },
        custom: {
          projectId: 'proj-123',
        },
      },
      user: {
        name: 'Test User',
        username: 'testuser',
        email: 'test@example.com',
      },
      environment: {
        variables: {
          NODE_ENV: 'development',
        },
      },
      sessionId: 'session-123',
      timestamp: '2024-01-01T00:00:00Z',
      version: 'v1',
    };
  });

  afterEach(() => {
    factory.shutdown();
  });

  describe('Server Instance Creation', () => {
    it('should create a new server instance from template', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}', '{user.username}'],
        template: {
          shareable: true,
        },
      };

      const instance = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-1',
        templateConfig.template,
      );

      expect(instance).toBeDefined();
      expect(instance.templateName).toBe('test-template');
      expect(instance.clientCount).toBe(1);
      expect(instance.clientIds.has('client-1')).toBe(true);
      expect(instance.status).toBe('active');
    });

    it('should reuse existing instance when template variables match', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
        template: {
          shareable: true,
        },
      };

      // Create first instance
      const instance1 = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-1',
      );

      // Create second instance with same context
      const instance2 = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-2',
      );

      expect(instance1).toBe(instance2); // Should be the same instance
      expect(instance1.clientCount).toBe(2);
      expect(instance1.clientIds.has('client-1')).toBe(true);
      expect(instance1.clientIds.has('client-2')).toBe(true);
    });

    it('should create new instance when perClient is true', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
        template: {
          shareable: true,
          perClient: true,
        },
      };

      const instance1 = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-1',
      );

      const instance2 = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-2',
      );

      expect(instance1).not.toBe(instance2);
      expect(instance1.clientCount).toBe(1);
      expect(instance2.clientCount).toBe(1);
    });

    it('should create new instance when shareable is false', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
        template: {
          shareable: false,
        },
      };

      const instance1 = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-1',
      );

      const instance2 = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-2',
      );

      expect(instance1).not.toBe(instance2);
    });

    it('should create new instance when template variables differ', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
        template: {
          shareable: true,
        },
      };

      const context1: ContextData = {
        ...mockContext,
        project: { ...mockContext.project, name: 'Project A' },
      };

      const context2: ContextData = {
        ...mockContext,
        project: { ...mockContext.project, name: 'Project B' },
      };

      const instance1 = await factory.getOrCreateServerInstance('test-template', templateConfig, context1, 'client-1');

      const instance2 = await factory.getOrCreateServerInstance('test-template', templateConfig, context2, 'client-2');

      expect(instance1).not.toBe(instance2);
    });

    it('should use default template options when not provided', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
      };

      const instance = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-1',
        undefined, // No template options
      );

      expect(instance).toBeDefined();
      expect(instance.clientCount).toBe(1);
    });
  });

  describe('Client Removal', () => {
    it('should remove client from instance', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
        template: { shareable: true },
      };

      const instance = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-1',
      );

      expect(instance.clientCount).toBe(1);

      // Add second client
      const instanceWithSecond = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-2',
      );

      expect(instanceWithSecond.clientCount).toBe(2);

      // Remove first client
      factory.removeClientFromInstance('test-template', { 'project.name': 'test-project' }, 'client-1');

      const finalInstance = factory.getInstance('test-template', { 'project.name': 'test-project' });
      expect(finalInstance?.clientCount).toBe(1);
    });
  });

  describe('Instance Retrieval', () => {
    it('should retrieve existing instance', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
        template: { shareable: true },
      };

      const instance = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-1',
      );

      const retrieved = factory.getInstance('test-template', { 'project.name': 'test-project' });
      expect(retrieved).toBe(instance);
    });

    it('should return undefined for non-existent instance', () => {
      const retrieved = factory.getInstance('non-existent', {});
      expect(retrieved).toBeUndefined();
    });

    it('should get all instances', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: { shareable: true },
      };

      // Create instances for different templates
      await factory.getOrCreateServerInstance('template-1', templateConfig, mockContext, 'client-1');
      await factory.getOrCreateServerInstance('template-2', templateConfig, mockContext, 'client-2');

      const allInstances = factory.getAllInstances();
      expect(allInstances).toHaveLength(2);
    });

    it('should get instances for specific template', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
        template: { shareable: true },
      };

      // Create multiple instances for same template with different variables
      const context1: ContextData = { ...mockContext, project: { ...mockContext.project, name: 'A' } };
      const context2: ContextData = { ...mockContext, project: { ...mockContext.project, name: 'B' } };

      await factory.getOrCreateServerInstance('test-template', templateConfig, context1, 'client-1');
      await factory.getOrCreateServerInstance('test-template', templateConfig, context2, 'client-2');

      const instances = factory.getTemplateInstances('test-template');
      expect(instances).toHaveLength(2);
    });
  });

  describe('Instance Management', () => {
    it('should manually remove instance', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: { shareable: true },
      };

      const instance = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-1',
      );

      expect(factory.getInstance('test-template', {})).toBe(instance);

      factory.removeInstance('test-template', {});

      expect(factory.getInstance('test-template', {})).toBeUndefined();
    });

    it('should force cleanup of idle instances', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: {
          shareable: true,
          idleTimeout: 100, // Short timeout for testing
        },
      };

      // Create instance and remove client to make it idle
      await factory.getOrCreateServerInstance('test-template', templateConfig, mockContext, 'client-1');

      factory.removeClientFromInstance('test-template', { 'project.name': 'test-project' }, 'client-1');

      // Force cleanup
      factory.cleanupIdleInstances();

      // Instance should be removed
      expect(factory.getInstance('test-template', { 'project.name': 'test-project' })).toBeUndefined();
    });
  });

  describe('Statistics', () => {
    it('should return factory statistics', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: { shareable: true },
      };

      // Create some instances
      await factory.getOrCreateServerInstance('template-1', templateConfig, mockContext, 'client-1');
      await factory.getOrCreateServerInstance('template-2', templateConfig, mockContext, 'client-2');

      const stats = factory.getStats();

      expect(stats.pool).toBeDefined();
      expect(stats.cache).toBeDefined();
      expect(stats.pool.totalInstances).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Template Processing', () => {
    it('should process template with context variables', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
      };

      await factory.getOrCreateServerInstance('test-template', templateConfig, mockContext, 'client-1');

      // Verify template processor was called
      expect(mockProcessor.processServerConfig).toHaveBeenCalledWith(
        'template-instance',
        templateConfig,
        expect.objectContaining({
          project: expect.objectContaining({
            name: 'test-project',
          }),
        }),
      );
    });

    it('should handle template processing errors gracefully', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
      };

      mockProcessor.processServerConfig.mockRejectedValue(new Error('Template error'));

      const instance = await factory.getOrCreateServerInstance(
        'test-template',
        templateConfig,
        mockContext,
        'client-1',
      );

      expect(instance).toBeDefined();
      expect(instance.processedConfig).toEqual(templateConfig); // Falls back to original config
    });
  });

  describe('Shutdown', () => {
    it('should shutdown cleanly', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: { shareable: true },
      };

      // Create some instances
      await factory.getOrCreateServerInstance('template-1', templateConfig, mockContext, 'client-1');
      await factory.getOrCreateServerInstance('template-2', templateConfig, mockContext, 'client-2');

      expect(factory.getAllInstances()).toHaveLength(2);

      factory.shutdown();

      expect(factory.getAllInstances()).toHaveLength(0);
    });

    it('should clear cache on shutdown', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: { shareable: true },
      };

      await factory.getOrCreateServerInstance('template-1', templateConfig, mockContext, 'client-1');

      expect(factory.getStats().cache.size).toBeGreaterThan(0);

      factory.shutdown();

      expect(factory.getStats().cache.size).toBe(0);
    });
  });
});
