import { ServerInstancePool, type ServerPoolOptions } from '@src/core/server/serverInstancePool.js';
import type { MCPServerParams } from '@src/core/types/transport.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('ServerInstancePool', () => {
  let pool: ServerInstancePool;
  let testOptions: ServerPoolOptions;

  beforeEach(() => {
    testOptions = {
      maxInstances: 3,
      idleTimeout: 1000, // 1 second for tests
      cleanupInterval: 500, // 0.5 seconds for tests
      maxTotalInstances: 5,
    };
    pool = new ServerInstancePool(testOptions);
  });

  afterEach(() => {
    pool.shutdown();
  });

  describe('Instance Creation and Reuse', () => {
    it('should create a new instance when no existing instance exists', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
      };
      const processedConfig: MCPServerParams = {
        command: 'echo',
        args: ['test-project'],
      };
      const templateVariables = { 'project.name': 'test-project' };
      const clientId = 'client-1';

      const instance = pool.getOrCreateInstance(
        'test-template',
        templateConfig,
        processedConfig,
        templateVariables,
        clientId,
      );

      expect(instance).toBeDefined();
      expect(instance.templateName).toBe('test-template');
      expect(instance.processedConfig).toEqual(processedConfig);
      expect(instance.templateVariables).toEqual(templateVariables);
      expect(instance.clientCount).toBe(1);
      expect(instance.clientIds.has(clientId)).toBe(true);
      expect(instance.status).toBe('active');
    });

    it('should reuse an existing instance when template variables match', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
        template: { shareable: true },
      };
      const processedConfig: MCPServerParams = {
        command: 'echo',
        args: ['test-project'],
      };
      const templateVariables = { 'project.name': 'test-project' };

      // Create first instance
      const instance1 = pool.getOrCreateInstance(
        'test-template',
        templateConfig,
        processedConfig,
        templateVariables,
        'client-1',
      );

      // Create second instance with same variables
      const instance2 = pool.getOrCreateInstance(
        'test-template',
        templateConfig,
        processedConfig,
        templateVariables,
        'client-2',
      );

      expect(instance1).toBe(instance2); // Should be the same instance
      expect(instance1.clientCount).toBe(2);
      expect(instance1.clientIds.has('client-1')).toBe(true);
      expect(instance1.clientIds.has('client-2')).toBe(true);
    });

    it('should create a new instance when template is not shareable', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
        template: { shareable: false, perClient: true },
      };
      const processedConfig: MCPServerParams = {
        command: 'echo',
        args: ['test-project'],
      };
      const templateVariables = { 'project.name': 'test-project' };

      const instance1 = pool.getOrCreateInstance(
        'test-template',
        templateConfig,
        processedConfig,
        templateVariables,
        'client-1',
      );

      const instance2 = pool.getOrCreateInstance(
        'test-template',
        templateConfig,
        processedConfig,
        templateVariables,
        'client-2',
      );

      expect(instance1).not.toBe(instance2); // Should be different instances
      expect(instance1.clientCount).toBe(1);
      expect(instance2.clientCount).toBe(1);
    });

    it('should create a new instance when template variables differ', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
        template: { shareable: true },
      };
      const processedConfig1: MCPServerParams = {
        command: 'echo',
        args: ['project-a'],
      };
      const processedConfig2: MCPServerParams = {
        command: 'echo',
        args: ['project-b'],
      };
      const variables1 = { 'project.name': 'project-a' };
      const variables2 = { 'project.name': 'project-b' };

      const instance1 = pool.getOrCreateInstance(
        'test-template',
        templateConfig,
        processedConfig1,
        variables1,
        'client-1',
      );

      const instance2 = pool.getOrCreateInstance(
        'test-template',
        templateConfig,
        processedConfig2,
        variables2,
        'client-2',
      );

      expect(instance1).not.toBe(instance2); // Should be different instances
      expect(instance1.clientCount).toBe(1);
      expect(instance2.clientCount).toBe(1);
    });
  });

  describe('Instance Limits', () => {
    it('should enforce per-template instance limit', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
        template: { perClient: true }, // Force per-client instances
      };
      const processedConfig: MCPServerParams = {
        command: 'echo',
        args: ['test-project'],
      };
      const templateVariables = { 'project.name': 'test-project' };

      // Create 3 instances (at the limit)
      pool.getOrCreateInstance('test-template', templateConfig, processedConfig, templateVariables, 'client-1');
      pool.getOrCreateInstance('test-template', templateConfig, processedConfig, templateVariables, 'client-2');
      pool.getOrCreateInstance('test-template', templateConfig, processedConfig, templateVariables, 'client-3');

      // Fourth instance should throw an error
      expect(() => {
        pool.getOrCreateInstance('test-template', templateConfig, processedConfig, templateVariables, 'client-4');
      }).toThrow("Maximum instances (3) reached for template 'test-template'");
    });

    it('should enforce total instance limit', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: { perClient: true },
      };
      const processedConfig: MCPServerParams = {
        command: 'echo',
      };
      const templateVariables = {};

      // Create 5 instances (at the total limit)
      pool.getOrCreateInstance('template-1', templateConfig, processedConfig, templateVariables, 'client-1');
      pool.getOrCreateInstance('template-2', templateConfig, processedConfig, templateVariables, 'client-2');
      pool.getOrCreateInstance('template-3', templateConfig, processedConfig, templateVariables, 'client-3');
      pool.getOrCreateInstance('template-4', templateConfig, processedConfig, templateVariables, 'client-4');
      pool.getOrCreateInstance('template-5', templateConfig, processedConfig, templateVariables, 'client-5');

      // Sixth instance should throw an error
      expect(() => {
        pool.getOrCreateInstance('template-6', templateConfig, processedConfig, templateVariables, 'client-6');
      }).toThrow('Maximum total instances (5) reached');
    });
  });

  describe('Client Management', () => {
    it('should track client additions and removals', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: { shareable: true },
      };
      const processedConfig: MCPServerParams = {
        command: 'echo',
      };
      const templateVariables = {};

      const instance = pool.getOrCreateInstance(
        'test-template',
        templateConfig,
        processedConfig,
        templateVariables,
        'client-1',
      );

      expect(instance.clientCount).toBe(1);

      // Add second client
      pool.addClientToInstance(instance, 'client-2');
      expect(instance.clientCount).toBe(2);
      expect(instance.clientIds.has('client-2')).toBe(true);

      // Remove first client
      const instanceKey = 'test-template:' + pool['createVariableHash'](templateVariables);
      pool.removeClientFromInstance(instanceKey, 'client-1');
      expect(instance.clientCount).toBe(1);
      expect(instance.clientIds.has('client-1')).toBe(false);
      expect(instance.clientIds.has('client-2')).toBe(true);
    });

    it('should mark instance as idle when no clients remain', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: { shareable: true },
      };
      const processedConfig: MCPServerParams = {
        command: 'echo',
      };
      const templateVariables = {};

      const instance = pool.getOrCreateInstance(
        'test-template',
        templateConfig,
        processedConfig,
        templateVariables,
        'client-1',
      );

      expect(instance.status).toBe('active');

      // Remove the only client
      const instanceKey = 'test-template:' + pool['createVariableHash'](templateVariables);
      pool.removeClientFromInstance(instanceKey, 'client-1');

      expect(instance.status).toBe('idle');
      expect(instance.clientCount).toBe(0);
    });
  });

  describe('Instance Retrieval', () => {
    it('should retrieve instance by key', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: { shareable: true },
      };
      const processedConfig: MCPServerParams = {
        command: 'echo',
      };
      const templateVariables = { 'project.name': 'test' };

      const instance = pool.getOrCreateInstance(
        'test-template',
        templateConfig,
        processedConfig,
        templateVariables,
        'client-1',
      );

      const instanceKey = 'test-template:' + pool['createVariableHash'](templateVariables);
      const retrieved = pool.getInstance(instanceKey);

      expect(retrieved).toBe(instance);
    });

    it('should return undefined for non-existent instance', () => {
      const retrieved = pool.getInstance('non-existent-key');
      expect(retrieved).toBeUndefined();
    });

    it('should get all instances for a template', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: { shareable: true },
      };
      const processedConfig: MCPServerParams = {
        command: 'echo',
      };

      // Create instances with different variables
      pool.getOrCreateInstance('test-template', templateConfig, processedConfig, { 'project.name': 'a' }, 'client-1');
      pool.getOrCreateInstance('test-template', templateConfig, processedConfig, { 'project.name': 'b' }, 'client-2');

      const instances = pool.getTemplateInstances('test-template');
      expect(instances).toHaveLength(2);

      // Create instance for different template
      pool.getOrCreateInstance('other-template', templateConfig, processedConfig, {}, 'client-3');

      const testTemplateInstances = pool.getTemplateInstances('test-template');
      expect(testTemplateInstances).toHaveLength(2);

      const otherTemplateInstances = pool.getTemplateInstances('other-template');
      expect(otherTemplateInstances).toHaveLength(1);
    });
  });

  describe('Cleanup and Shutdown', () => {
    it('should cleanup idle instances', async () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: { shareable: true },
      };
      const processedConfig: MCPServerParams = {
        command: 'echo',
      };
      const templateVariables = {};

      // Create instance
      const instance = pool.getOrCreateInstance(
        'test-template',
        templateConfig,
        processedConfig,
        templateVariables,
        'client-1',
      );

      expect(instance.status).toBe('active');

      // Get the actual instance key by finding it in the pool
      const allInstances = pool.getAllInstances();
      expect(allInstances).toHaveLength(1);
      const actualInstanceKey = pool['createInstanceKey'](
        'test-template',
        pool['createVariableHash'](templateVariables),
      );

      // Remove client to make it idle
      pool.removeClientFromInstance(actualInstanceKey, 'client-1');

      expect(instance.status).toBe('idle');

      // Wait for idle timeout to pass
      await new Promise((resolve) => setTimeout(resolve, 1100)); // Wait longer than 1000ms timeout

      // Manually trigger cleanup
      pool.cleanupIdleInstances();

      // Instance should be removed
      const retrieved = pool.getInstance(actualInstanceKey);
      expect(retrieved).toBeUndefined();
    });

    it('should return statistics', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        template: { shareable: true },
      };
      const processedConfig: MCPServerParams = {
        command: 'echo',
      };

      // Create instances
      pool.getOrCreateInstance('template-1', templateConfig, processedConfig, {}, 'client-1');
      pool.getOrCreateInstance('template-2', templateConfig, processedConfig, { 'project.name': 'a' }, 'client-2');
      const instance3 = pool.getOrCreateInstance(
        'template-3',
        templateConfig,
        processedConfig,
        { 'project.name': 'b' },
        'client-3',
      );

      // Add another client to instance 3
      pool.addClientToInstance(instance3, 'client-4');

      const stats = pool.getStats();
      expect(stats.totalInstances).toBe(3);
      expect(stats.activeInstances).toBe(3);
      expect(stats.idleInstances).toBe(0);
      expect(stats.templateCount).toBe(3);
      expect(stats.totalClients).toBe(4);
    });

    it('should shutdown cleanly', () => {
      // Create some instances
      pool.getOrCreateInstance('template-1', { command: 'echo' }, { command: 'echo' }, {}, 'client-1');
      pool.getOrCreateInstance('template-2', { command: 'echo' }, { command: 'echo' }, {}, 'client-2');

      expect(pool.getAllInstances()).toHaveLength(2);

      // Shutdown
      pool.shutdown();

      // All instances should be cleared
      expect(pool.getAllInstances()).toHaveLength(0);
    });
  });
});
