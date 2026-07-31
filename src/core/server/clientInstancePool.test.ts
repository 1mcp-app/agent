import type { MCPServerParams } from '@src/core/types/transport.js';
import type { ContextData } from '@src/types/context.js';
import { createHash } from '@src/utils/crypto.js';

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
      expect(instance.id).toMatch(/^[0-9a-f]{64}$/);
    });

    it('recovers a supervised template with the same logical ID, rendered config, and memberships', async () => {
      vi.useFakeTimers();
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const replacementTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
        pid: 202,
      } as any;
      const initialTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
        pid: 101,
        stdioSupervision: {
          policy: { restartOnExit: true as const, maxRestarts: 2, restartDelay: 25 },
          recreate: () => replacementTransport,
          getLastExit: () => ({ code: 12, signal: null, pid: 101, at: new Date() }),
        },
      } as any;
      replacementTransport.stdioSupervision = {
        ...initialTransport.stdioSupervision,
        getLastExit: () => null,
      };
      vi.mocked(createTransportsWithContext)
        .mockResolvedValueOnce({ testTemplate: initialTransport })
        .mockResolvedValueOnce({ testTemplate: replacementTransport });

      const instance = await pool.getOrCreateClientInstance(
        'testTemplate',
        { ...mockTemplateConfig, restartOnExit: true, restartDelay: 25 },
        mockContext,
        'client-a',
      );
      const id = instance.id;
      const processedConfig = instance.processedConfig;
      instance.outboundKeys.add('testTemplate:client-a');

      expect(instance.supervision).toMatchObject({ state: 'connected', currentPid: 101 });

      instance.client.onclose?.();
      expect(instance).toMatchObject({ id, status: 'restarting', supervision: { attempt: 1 } });

      await vi.advanceTimersByTimeAsync(25);

      expect(instance).toMatchObject({
        id,
        status: 'active',
        transport: replacementTransport,
        processedConfig,
        supervision: { state: 'connected', currentPid: 202 },
      });
      expect(instance.clientIds).toEqual(new Set(['client-a']));
      expect(instance.outboundKeys).toEqual(new Set(['testTemplate:client-a']));
      vi.useRealTimers();
    });

    it('removes an idle supervised template when its child exits without scheduling recovery', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const initialTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
        pid: 101,
        stdioSupervision: {
          policy: { restartOnExit: true as const, maxRestarts: 2, restartDelay: 25 },
          recreate: vi.fn(),
          getLastExit: () => ({ code: 12, signal: null, pid: 101, at: new Date() }),
        },
      } as any;
      vi.mocked(createTransportsWithContext).mockResolvedValue({ testTemplate: initialTransport });

      const instance = await pool.getOrCreateClientInstance(
        'testTemplate',
        { ...mockTemplateConfig, restartOnExit: true, restartDelay: 25 },
        mockContext,
        'client-a',
      );

      pool.removeClientFromInstance(instance.instanceKey, 'client-a');
      expect(instance).toMatchObject({ referenceCount: 0, status: 'idle' });

      instance.client.onclose?.();

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(pool.getInstance(instance.instanceKey)).toBeUndefined();
      expect(instance.supervision).toMatchObject({ state: 'stopped', attempt: 0 });
      expect(instance.client.close).toHaveBeenCalledTimes(1);
      expect(initialTransport.close).toHaveBeenCalledTimes(1);
      expect(createTransportsWithContext).toHaveBeenCalledTimes(1);
      expect(initialTransport.stdioSupervision.recreate).not.toHaveBeenCalled();
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

    it('should assign a new opaque ID after a logical instance is removed and recreated', async () => {
      const first = await pool.getOrCreateClientInstance('testTemplate', mockTemplateConfig, mockContext, 'client-1');

      await pool.removeInstance(first.instanceKey);

      const recreated = await pool.getOrCreateClientInstance(
        'testTemplate',
        mockTemplateConfig,
        mockContext,
        'client-1',
      );

      expect(recreated.id).toMatch(/^[0-9a-f]{64}$/);
      expect(recreated.id).not.toBe(first.id);
    });

    it('should deduplicate concurrent shareable instance creation for the same rendered config', async () => {
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
      let resolveTransportCreation: (value: Record<string, typeof mockTransport>) => void;
      const transportCreation = new Promise<Record<string, typeof mockTransport>>((resolve) => {
        resolveTransportCreation = resolve;
      });

      vi.mocked(createTransportsWithContext).mockReturnValue(transportCreation);
      vi.mocked(ClientManager.getOrCreateInstance().createPooledClientInstance).mockReturnValue(mockClient);

      const firstRequest = pool.getOrCreateClientInstance('testTemplate', mockTemplateConfig, mockContext, 'client-1');
      const secondRequest = pool.getOrCreateClientInstance('testTemplate', mockTemplateConfig, mockContext, 'client-2');

      expect(createTransportsWithContext).toHaveBeenCalledTimes(1);
      resolveTransportCreation!({ testTemplate: mockTransport });

      const [instance1, instance2] = await Promise.all([firstRequest, secondRequest]);

      expect(instance1).toBe(instance2);
      expect(instance1.referenceCount).toBe(2);
      expect(instance1.clientIds.has('client-1')).toBe(true);
      expect(instance1.clientIds.has('client-2')).toBe(true);
      expect(createTransportsWithContext).toHaveBeenCalledTimes(1);
      expect(pool.getStats().totalInstances).toBe(1);
    });

    it('blocks new creation and waits for a pending candidate to be disposed during shutdown', async () => {
      const { createTransportsWithContext } = await import('@src/transport/transportFactory.js');
      const { ClientManager } = await import('@src/core/client/clientManager.js');
      let finishTransportCreation!: (transports: Record<string, any>) => void;
      const transportCreation = new Promise<Record<string, any>>((resolve) => {
        finishTransportCreation = resolve;
      });
      const transport = {
        close: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        send: vi.fn(),
      } as any;
      const client = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      } as any;
      vi.mocked(createTransportsWithContext).mockReturnValue(transportCreation);
      const getClientManager = vi.mocked(ClientManager.getOrCreateInstance);
      const originalGetClientManager = getClientManager.getMockImplementation();
      getClientManager.mockReturnValue({ createPooledClientInstance: vi.fn(() => client) } as any);

      try {
        const creation = pool.getOrCreateClientInstance('testTemplate', mockTemplateConfig, mockContext, 'client-1');
        await vi.waitFor(() => expect(createTransportsWithContext).toHaveBeenCalledTimes(1));

        let shutdownResolved = false;
        const shutdown = pool.shutdown().then(() => {
          shutdownResolved = true;
        });
        await Promise.resolve();

        expect(shutdownResolved).toBe(false);
        await expect(
          pool.getOrCreateClientInstance('testTemplate', mockTemplateConfig, mockContext, 'client-2'),
        ).rejects.toThrow('ClientInstancePool is shutting down');

        finishTransportCreation({ testTemplate: transport });
        await expect(creation).rejects.toThrow('ClientInstancePool is shutting down');
        await shutdown;

        expect(client.close).toHaveBeenCalledTimes(1);
        expect(transport.close).toHaveBeenCalledTimes(1);
        expect(shutdownResolved).toBe(true);
        expect(pool.getStats().totalInstances).toBe(0);
      } finally {
        getClientManager.mockImplementation(originalGetClientManager!);
      }
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
});
