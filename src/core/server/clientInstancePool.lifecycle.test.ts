import type { MCPServerParams } from '@src/core/types/transport.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientInstancePool } from './clientInstancePool.js';

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      _clientInfo: {},
      _capabilities: {},
      _jsonSchemaValidator: {},
      _cachedToolOutputValidators: new Map(),
      // Add all other required properties with mock implementations
    };
  }),
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
  TemplateProcessor: vi.fn().mockImplementation(function () {
    return {
      processServerConfig: vi.fn().mockResolvedValue({
        processedConfig: {},
      }),
    };
  }),
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
  createHash: vi.fn((data) => `hash-${Buffer.from(data).toString('hex')}`),
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
});
