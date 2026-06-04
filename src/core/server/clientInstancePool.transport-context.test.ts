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
  });

  afterEach(async () => {
    await pool.shutdown();
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
