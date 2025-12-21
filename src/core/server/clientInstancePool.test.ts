import type { MCPServerParams } from '@src/core/types/transport.js';
import type { ContextData } from '@src/types/context.js';
import { createHash } from '@src/utils/crypto.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientInstancePool } from './clientInstancePool.js';

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    _clientInfo: {},
    _capabilities: {},
    _jsonSchemaValidator: {},
    _cachedToolOutputValidators: new Map(),
    // Add all other required properties with mock implementations
  })),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
  infoIf: vi.fn(),
  warnIf: vi.fn(),
}));

vi.mock('@src/template/templateProcessor.js', () => ({
  TemplateProcessor: vi.fn().mockImplementation(() => ({
    processServerConfig: vi.fn().mockResolvedValue({
      processedConfig: {},
    }),
  })),
}));

vi.mock('@src/transport/transportFactory.js', () => ({
  createTransportsWithContext: vi.fn((configs) => {
    // Return mock transports for each config key
    const transports: Record<string, any> = {};
    for (const [key] of Object.entries(configs)) {
      transports[key] = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      };
    }
    return Promise.resolve(transports);
  }),
}));

vi.mock('@src/core/client/clientManager.js', () => ({
  ClientManager: {
    getOrCreateInstance: vi.fn(() => ({
      createPooledClientInstance: vi.fn(() => ({
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      })),
    })),
  },
}));

vi.mock('@src/utils/crypto.js', () => ({
  createHash: vi.fn((data) => `hash-${data}`),
}));

describe('ClientInstancePool', () => {
  let pool: ClientInstancePool;
  let mockContext: ContextData;
  let mockTemplateConfig: MCPServerParams;

  beforeEach(() => {
    vi.clearAllMocks();

    pool = new ClientInstancePool({
      maxInstances: 3,
      idleTimeout: 1000, // 1 second for tests
      cleanupInterval: 500, // 0.5 seconds for tests
      maxTotalInstances: 5,
    });

    mockContext = {
      sessionId: 'test-session-123',
      version: '1.0.0',
      project: {
        name: 'test-project',
        path: '/test/path',
      },
      user: {
        uid: 'user-456',
        username: 'testuser',
      },
      environment: {
        variables: {},
      },
      timestamp: '2024-01-15T10:30:00Z',
    };

    mockTemplateConfig = {
      command: 'echo',
      args: ['hello'],
      type: 'stdio',
      template: {
        shareable: true,
        idleTimeout: 2000,
      },
    };
  });

  afterEach(async () => {
    await pool.shutdown();
  });

  describe('getOrCreateClientInstance', () => {
    it('should create a new instance for first request', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      const instance = await pool.getOrCreateClientInstance(
        'testTemplate',
        mockTemplateConfig,
        mockContext,
        'client-1',
      );

      expect(instance).toBeDefined();
      expect(instance.templateName).toBe('testTemplate');
      expect(instance.referenceCount).toBe(1);
      expect(instance.status).toBe('active');
      expect(instance.clientIds.has('client-1')).toBe(true);
    });

    it('should reuse existing instance for shareable templates with same variables', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      // Create first instance
      const instance1 = await pool.getOrCreateClientInstance(
        'testTemplate',
        mockTemplateConfig,
        mockContext,
        'client-1',
      );

      // Create second instance with same template and context
      const instance2 = await pool.getOrCreateClientInstance(
        'testTemplate',
        mockTemplateConfig,
        mockContext,
        'client-2',
      );

      // Should reuse the same instance
      expect(instance1).toBe(instance2);
      expect(instance1.referenceCount).toBe(2);
      expect(instance1.clientIds.has('client-1')).toBe(true);
      expect(instance1.clientIds.has('client-2')).toBe(true);

      // Should only create transport once
      expect(createTransportsWithContext).toHaveBeenCalledTimes(1);
    });

    it('should create separate instances for non-shareable templates', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      const nonShareableConfig = {
        ...mockTemplateConfig,
        template: { ...mockTemplateConfig.template, shareable: false },
      };

      const instance1 = await pool.getOrCreateClientInstance(
        'testTemplate',
        nonShareableConfig,
        mockContext,
        'client-1',
      );

      const instance2 = await pool.getOrCreateClientInstance(
        'testTemplate',
        nonShareableConfig,
        mockContext,
        'client-2',
      );

      expect(instance1).not.toBe(instance2);
      expect(instance1.referenceCount).toBe(1);
      expect(instance2.referenceCount).toBe(1);
    });

    it('should create separate instances for per-client templates', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      const perClientConfig = {
        ...mockTemplateConfig,
        template: { ...mockTemplateConfig.template, perClient: true },
      };

      const instance1 = await pool.getOrCreateClientInstance('testTemplate', perClientConfig, mockContext, 'client-1');

      const instance2 = await pool.getOrCreateClientInstance('testTemplate', perClientConfig, mockContext, 'client-2');

      expect(instance1).not.toBe(instance2);
      expect(instance1.referenceCount).toBe(1);
      expect(instance2.referenceCount).toBe(1);
    });

    it('should create separate instances for different variable hashes', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      // Mock different variable hashes to simulate different contexts
      vi.mocked(createHash).mockReturnValueOnce('hash1').mockReturnValueOnce('hash2');

      // Use non-shareable config to force separate instances
      const nonShareableConfig = {
        ...mockTemplateConfig,
        template: { ...mockTemplateConfig.template, shareable: false },
      };

      const instance1 = await pool.getOrCreateClientInstance(
        'testTemplate',
        nonShareableConfig,
        mockContext,
        'client-1',
      );

      const instance2 = await pool.getOrCreateClientInstance(
        'testTemplate',
        nonShareableConfig,
        mockContext,
        'client-2',
      );

      expect(instance1).not.toBe(instance2);
      expect(createTransportsWithContext).toHaveBeenCalledTimes(2);
    });

    it('should respect max instances limit per template', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      // Mock different variable hashes for each call to simulate different contexts
      vi.mocked(createHash)
        .mockReturnValueOnce('hash1')
        .mockReturnValueOnce('hash2')
        .mockReturnValueOnce('hash3')
        .mockReturnValueOnce('hash4');

      const nonShareableConfig = {
        ...mockTemplateConfig,
        template: { ...mockTemplateConfig.template, shareable: false },
      };

      // Create maximum instances
      await pool.getOrCreateClientInstance('testTemplate', nonShareableConfig, mockContext, 'client-1');
      await pool.getOrCreateClientInstance('testTemplate', nonShareableConfig, mockContext, 'client-2');
      await pool.getOrCreateClientInstance('testTemplate', nonShareableConfig, mockContext, 'client-3');

      // Should throw when trying to create another instance
      await expect(
        pool.getOrCreateClientInstance('testTemplate', nonShareableConfig, mockContext, 'client-4'),
      ).rejects.toThrow("Maximum instances (3) reached for template 'testTemplate'");
    });

    it('should respect max total instances limit', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      // Mock to return transport for any template name
      vi.mocked(createTransportsWithContext).mockImplementation((configs) => {
        const transports: Record<string, any> = {};
        for (const [key] of Object.entries(configs)) {
          transports[key] = mockTransport;
        }
        return Promise.resolve(transports);
      });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      const nonShareableConfig = {
        ...mockTemplateConfig,
        template: { ...mockTemplateConfig.template, shareable: false },
      };

      // Create instances for different templates up to the total limit
      await pool.getOrCreateClientInstance('template1', nonShareableConfig, mockContext, 'client-1');
      await pool.getOrCreateClientInstance('template2', nonShareableConfig, mockContext, 'client-2');
      await pool.getOrCreateClientInstance('template3', nonShareableConfig, mockContext, 'client-3');
      await pool.getOrCreateClientInstance('template4', nonShareableConfig, mockContext, 'client-4');
      await pool.getOrCreateClientInstance('template5', nonShareableConfig, mockContext, 'client-5');

      // Should throw when trying to create another instance
      await expect(
        pool.getOrCreateClientInstance('template6', nonShareableConfig, mockContext, 'client-6'),
      ).rejects.toThrow('Maximum total instances (5) reached');
    });
  });

  describe('removeClientFromInstance', () => {
    it('should mark instance as idle when no more clients', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      const instance = await pool.getOrCreateClientInstance(
        'testTemplate',
        mockTemplateConfig,
        mockContext,
        'client-1',
      );

      expect(instance.referenceCount).toBe(1);
      expect(instance.status).toBe('active');

      // Add another client
      pool.addClientToInstance(instance, 'client-2');
      expect(instance.referenceCount).toBe(2);

      // Remove one client using the rendered hash from the instance
      const instanceKey = `testTemplate:${instance.renderedHash}`;
      pool.removeClientFromInstance(instanceKey, 'client-1');

      expect(instance.referenceCount).toBe(1);
      expect(instance.status).toBe('active'); // Still active because one client remains

      // Remove second client
      pool.removeClientFromInstance(instanceKey, 'client-2');

      expect(instance.referenceCount).toBe(0);
      expect(instance.status).toBe('idle');
    });
  });

  describe('getTemplateInstances', () => {
    it('should return all instances for a template', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      // Use different context values to create different instances

      vi.mocked(createHash).mockReturnValueOnce('hash1').mockReturnValueOnce('hash2');

      const nonShareableConfig = {
        ...mockTemplateConfig,
        template: { ...mockTemplateConfig.template, shareable: false },
      };

      await pool.getOrCreateClientInstance('testTemplate', nonShareableConfig, mockContext, 'client-1');
      await pool.getOrCreateClientInstance('testTemplate', nonShareableConfig, mockContext, 'client-2');

      const instances = pool.getTemplateInstances('testTemplate');
      expect(instances).toHaveLength(2);
    });

    it('should return empty array for non-existent template', () => {
      const instances = pool.getTemplateInstances('nonExistent');
      expect(instances).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return correct pool statistics', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      // Mock to return transport for any template name
      vi.mocked(createTransportsWithContext).mockImplementation((configs) => {
        const transports: Record<string, any> = {};
        for (const [key] of Object.entries(configs)) {
          transports[key] = mockTransport;
        }
        return Promise.resolve(transports);
      });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      // Create some instances
      const instance1 = await pool.getOrCreateClientInstance('template1', mockTemplateConfig, mockContext, 'client-1');

      await pool.getOrCreateClientInstance('template2', mockTemplateConfig, mockContext, 'client-2');

      // Add another client to first instance
      pool.addClientToInstance(instance1, 'client-3');

      const stats = pool.getStats();

      expect(stats.totalInstances).toBe(2);
      expect(stats.activeInstances).toBe(2);
      expect(stats.idleInstances).toBe(0);
      expect(stats.templateCount).toBe(2);
      expect(stats.totalClients).toBe(3); // client-1, client-2, client-3
    });

    it('should count idle instances correctly', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      const instance = await pool.getOrCreateClientInstance(
        'testTemplate',
        mockTemplateConfig,
        mockContext,
        'client-1',
      );

      // Remove the only client, making it idle
      const instanceKey = `testTemplate:${instance.renderedHash}`;
      pool.removeClientFromInstance(instanceKey, 'client-1');

      const stats = pool.getStats();

      expect(stats.totalInstances).toBe(1);
      expect(stats.activeInstances).toBe(0);
      expect(stats.idleInstances).toBe(1);
      expect(stats.totalClients).toBe(0);
    });
  });

  describe('cleanupIdleInstances', () => {
    beforeEach(() => {
      // Use a shorter cleanup interval for tests
      pool = new ClientInstancePool({
        maxInstances: 3,
        idleTimeout: 100, // 100ms
        cleanupInterval: 50, // 50ms
        maxTotalInstances: 5,
      });
    });

    it('should cleanup instances that have been idle longer than timeout', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      // Use a template config without custom idleTimeout for this test
      const configWithoutCustomTimeout = {
        command: 'echo',
        args: ['hello'],
        type: 'stdio' as const,
        template: {
          shareable: true,
          // No idleTimeout - should use pool's timeout of 100ms
        },
      };

      const instance = await pool.getOrCreateClientInstance(
        'testTemplate',
        configWithoutCustomTimeout,
        mockContext,
        'client-1',
      );

      // Make instance idle
      const instanceKey = `testTemplate:${instance.renderedHash}`;
      pool.removeClientFromInstance(instanceKey, 'client-1');

      // Wait for idle timeout plus some buffer
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Manually trigger cleanup to ensure it runs (in case automatic cleanup hasn't run yet)
      await pool.cleanupIdleInstances();

      const stats = pool.getStats();
      expect(stats.totalInstances).toBe(0);
    });

    it('should not cleanup active instances', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      await pool.getOrCreateClientInstance('testTemplate', mockTemplateConfig, mockContext, 'client-1');

      // Don't make it idle - keep it active

      // Wait for idle timeout plus some buffer
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Manually trigger cleanup to ensure it runs
      await pool.cleanupIdleInstances();

      const stats = pool.getStats();
      expect(stats.totalInstances).toBe(1);
      expect(stats.activeInstances).toBe(1);
    });
  });

  describe('removeInstance', () => {
    it('should remove instance and clean up resources', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });

      const instance = await pool.getOrCreateClientInstance(
        'testTemplate',
        mockTemplateConfig,
        mockContext,
        'client-1',
      );

      const instanceKey = `testTemplate:${instance.renderedHash}`;

      // Verify instance exists before removal
      expect(pool.getInstance(instanceKey)).toBe(instance);

      // Get the actual client and transport from the instance
      const actualClient = instance.client;
      const actualTransport = instance.transport;

      await pool.removeInstance(instanceKey);

      // Test that the actual client and transport from the instance were closed
      expect(actualClient.close).toHaveBeenCalled();
      expect(actualTransport.close).toHaveBeenCalled();

      const stats = pool.getStats();
      expect(stats.totalInstances).toBe(0);
    });

    it('should handle removing non-existent instance gracefully', async () => {
      await expect(pool.removeInstance('non-existent')).resolves.not.toThrow();
    });
  });

  describe('shutdown', () => {
    it('should shutdown all instances and stop cleanup timer', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;

      // Mock to return transport for any template name
      vi.mocked(createTransportsWithContext).mockImplementation((configs) => {
        const transports: Record<string, any> = {};
        for (const [key] of Object.entries(configs)) {
          transports[key] = mockTransport;
        }
        return Promise.resolve(transports);
      });

      const instance1 = await pool.getOrCreateClientInstance('template1', mockTemplateConfig, mockContext, 'client-1');
      const instance2 = await pool.getOrCreateClientInstance('template2', mockTemplateConfig, mockContext, 'client-2');

      // Get the actual clients from the instances
      const actualClient1 = instance1.client;
      const actualClient2 = instance2.client;

      await pool.shutdown();

      // Test that the actual clients were closed
      expect(actualClient1.close).toHaveBeenCalled();
      expect(actualClient2.close).toHaveBeenCalled();
      expect(mockTransport.close).toHaveBeenCalledTimes(2);

      const stats = pool.getStats();
      expect(stats.totalInstances).toBe(0);
    });
  });

  describe('template configuration defaults', () => {
    it('should use default values when template config is undefined', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      const configWithoutTemplate = {
        command: 'echo',
        args: ['hello'],
        type: 'stdio' as const,
      };

      const instance1 = await pool.getOrCreateClientInstance(
        'testTemplate',
        configWithoutTemplate,
        mockContext,
        'client-1',
      );

      const instance2 = await pool.getOrCreateClientInstance(
        'testTemplate',
        configWithoutTemplate,
        mockContext,
        'client-2',
      );

      // Should share by default
      expect(instance1).toBe(instance2);
      expect(instance1.referenceCount).toBe(2);
    });

    it('should use template-specific idle timeout', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: mockTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      const configWithCustomTimeout = {
        command: 'echo',
        args: ['hello'],
        type: 'stdio' as const,
        template: {
          idleTimeout: 5000, // 5 seconds
        },
      };

      const instance = await pool.getOrCreateClientInstance(
        'testTemplate',
        configWithCustomTimeout,
        mockContext,
        'client-1',
      );

      expect(instance.idleTimeout).toBe(5000);
    });
  });

  describe('HTTP and SSE transport support', () => {
    it('should create instances for SSE transport templates', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockSSETransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
        type: 'sse',
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ sseTemplate: mockSSETransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      const sseTemplateConfig: MCPServerParams = {
        type: 'sse',
        url: 'http://example.com/sse',
        template: {
          shareable: true,
          maxInstances: 5,
        },
      };

      const instance = await pool.getOrCreateClientInstance('sseTemplate', sseTemplateConfig, mockContext, 'client-1');

      expect(instance).toBeDefined();
      expect(instance.templateName).toBe('sseTemplate');
      expect(createTransportsWithContext).toHaveBeenCalledWith({ sseTemplate: expect.any(Object) }, undefined);
    });

    it('should create instances for HTTP transport templates', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockHttpTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
        type: 'http',
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      vi.mocked(createTransportsWithContext).mockResolvedValue({ httpTemplate: mockHttpTransport });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      const httpTemplateConfig: MCPServerParams = {
        type: 'streamableHttp',
        url: 'http://example.com/api',
        template: {
          shareable: true,
          idleTimeout: 120000,
        },
      };

      const instance = await pool.getOrCreateClientInstance(
        'httpTemplate',
        httpTemplateConfig,
        mockContext,
        'client-1',
      );

      expect(instance).toBeDefined();
      expect(instance.templateName).toBe('httpTemplate');
      expect(createTransportsWithContext).toHaveBeenCalledWith({ httpTemplate: expect.any(Object) }, undefined);
    });

    it('should properly cleanup SSE and HTTP transport instances', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockSSETransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
        type: 'sse',
      } as any;
      const mockHttpTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
        type: 'http',
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
        _jsonSchemaValidator: {},
        _cachedToolOutputValidators: new Map(),
      } as any;

      // Mock different transports for different templates
      vi.mocked(createTransportsWithContext).mockImplementation((configs) => {
        const transports: Record<string, any> = {};
        for (const [key, config] of Object.entries(configs)) {
          if (key === 'sseTemplate' || (config as any).type === 'sse') {
            transports[key] = mockSSETransport;
          } else if (key === 'httpTemplate' || (config as any).type === 'streamableHttp') {
            transports[key] = mockHttpTransport;
          }
        }
        return Promise.resolve(transports);
      });
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      const sseConfig: MCPServerParams = {
        type: 'sse',
        url: 'http://example.com/sse',
        template: { shareable: true },
      };

      const httpConfig: MCPServerParams = {
        type: 'streamableHttp',
        url: 'http://example.com/api',
        template: { shareable: true },
      };

      // Create instances
      const sseInstance = await pool.getOrCreateClientInstance('sseTemplate', sseConfig, mockContext, 'client-1');
      const httpInstance = await pool.getOrCreateClientInstance('httpTemplate', httpConfig, mockContext, 'client-2');

      // Remove instances to trigger cleanup
      const sseKey = `sseTemplate:${sseInstance.renderedHash}`;
      const httpKey = `httpTemplate:${httpInstance.renderedHash}`;

      await pool.removeInstance(sseKey);
      await pool.removeInstance(httpKey);

      // Verify cleanup was called for both transport types
      expect(mockSSETransport.close).toHaveBeenCalledTimes(1);
      expect(mockHttpTransport.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('Template Context Isolation', () => {
    it('should create different instances for different contexts with same template', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
      } as any;

      vi.mocked(createTransportsWithContext).mockReturnValue({ testTemplate: mockTransport } as any);
      vi.mocked(ClientManager.getOrCreateInstance).mockReturnValue({
        createSingleClient: vi.fn().mockResolvedValue(mockClient),
        createPooledClientInstance: vi.fn().mockReturnValue(mockClient),
        getClient: vi.fn().mockReturnValue(mockClient),
      } as any);

      // Create a template that includes context-dependent values
      const templateWithContext = {
        command: 'echo',
        args: ['{{project.path}}'],
        type: 'stdio' as const,
        template: {
          shareable: true,
          idleTimeout: 2000,
        },
      };

      // Create two different contexts
      const context1 = {
        ...mockContext,
        sessionId: 'session-1',
        project: {
          name: 'project-1',
          path: '/path/to/project-1',
          environment: 'development',
        },
      };

      const context2 = {
        ...mockContext,
        sessionId: 'session-2',
        project: {
          name: 'project-2',
          path: '/path/to/project-2',
          environment: 'production',
        },
      };

      // Create instances with different contexts
      const instance1 = await pool.getOrCreateClientInstance('testTemplate', templateWithContext, context1, 'client-1');
      const instance2 = await pool.getOrCreateClientInstance('testTemplate', templateWithContext, context2, 'client-1');

      // Should create different instances (different rendered configs)
      expect(instance1.id).not.toBe(instance2.id);
      expect(instance1.processedConfig.args).toEqual(['/path/to/project-1']);
      expect(instance2.processedConfig.args).toEqual(['/path/to/project-2']);

      // Verify both instances are tracked separately
      const stats = pool.getStats();
      expect(stats.totalInstances).toBe(2);
    });

    it('should reuse instances when context and template are identical', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');

      const mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        _clientInfo: {},
        _capabilities: {},
      } as any;

      vi.mocked(createTransportsWithContext).mockReturnValue({ testTemplate: mockTransport } as any);
      vi.mocked(ClientManager.getOrCreateInstance).mockReturnValue({
        createSingleClient: vi.fn().mockResolvedValue(mockClient),
        createPooledClientInstance: vi.fn().mockReturnValue(mockClient),
        getClient: vi.fn().mockReturnValue(mockClient),
      } as any);

      const templateConfig = {
        command: 'echo',
        args: ['hello', 'world'],
        type: 'stdio' as const,
        template: {
          shareable: true,
          idleTimeout: 2000,
        },
      };

      const sameContext = { ...mockContext };

      // Create instances with identical template and context
      const instance1 = await pool.getOrCreateClientInstance('testTemplate', templateConfig, sameContext, 'client-1');
      const instance2 = await pool.getOrCreateClientInstance('testTemplate', templateConfig, sameContext, 'client-2');

      // Should reuse the same instance (shareable template)
      expect(instance1.id).toBe(instance2.id);
      expect(instance1.referenceCount).toBe(2);
      expect(instance2.referenceCount).toBe(2);

      // Should only have one instance in the pool
      const stats = pool.getStats();
      expect(stats.totalInstances).toBe(1);
    });
  });
});
