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
});
