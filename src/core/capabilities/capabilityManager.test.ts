import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

import {
  setupClientToServerNotifications,
  setupServerToClientNotifications,
} from '@src/core/protocol/notificationHandlers.js';
import { registerRequestHandlers } from '@src/core/protocol/requestHandlers.js';
import {
  ClientStatus,
  InboundConnection,
  OutboundConnection,
  OutboundConnections,
  ServerStatus,
} from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { setupCapabilities } from './capabilityManager.js';

// Mock dependencies
vi.mock('@src/logger/logger.js', () => ({
  __esModule: true,
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  debugIf: vi.fn(),
}));

vi.mock('@src/core/protocol/notificationHandlers.js', () => ({
  setupClientToServerNotifications: vi.fn(),
  setupServerToClientNotifications: vi.fn(),
}));

vi.mock('@src/core/protocol/requestHandlers.js', () => ({
  registerRequestHandlers: vi.fn(),
}));

describe('CapabilityManager', () => {
  let mockServerInfo: InboundConnection;
  let mockClient1: Client;
  let mockClient2: Client;
  let mockClient3: Client;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock server info
    mockServerInfo = {
      server: {
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
      } as any,
      status: ServerStatus.Connected,
      tags: [],
      enablePagination: false,
    };

    // Setup mock clients
    mockClient1 = {
      getServerCapabilities: vi.fn(),
      setNotificationHandler: vi.fn(),
      setRequestHandler: vi.fn(),
    } as unknown as Client;

    mockClient2 = {
      getServerCapabilities: vi.fn(),
      setNotificationHandler: vi.fn(),
      setRequestHandler: vi.fn(),
    } as unknown as Client;

    mockClient3 = {
      getServerCapabilities: vi.fn(),
      setNotificationHandler: vi.fn(),
      setRequestHandler: vi.fn(),
    } as unknown as Client;
  });

  describe('setupCapabilities', () => {
    it('should setup capabilities and handlers for empty clients', async () => {
      const clients: OutboundConnections = new Map();

      const result = await setupCapabilities(clients, mockServerInfo);

      expect(result).toEqual({});
      expect(setupClientToServerNotifications).toHaveBeenCalledWith(clients, mockServerInfo);
      expect(setupServerToClientNotifications).toHaveBeenCalledWith(clients, mockServerInfo);
      expect(registerRequestHandlers).toHaveBeenCalledWith(clients, mockServerInfo);
    });

    it('should collect capabilities from single client', async () => {
      const mockCapabilities: ServerCapabilities = {
        resources: { subscribe: true },
        tools: { listChanged: true },
        prompts: { listChanged: true },
      };

      (mockClient1.getServerCapabilities as unknown as MockInstance).mockReturnValue(mockCapabilities);

      const clientInfo: OutboundConnection = {
        name: 'client1',
        client: mockClient1,
        status: ClientStatus.Connected,
        transport: {} as any,
      };

      const clients: OutboundConnections = new Map();
      clients.set('client1', clientInfo);

      const result = await setupCapabilities(clients, mockServerInfo);

      expect(result).toEqual(mockCapabilities);
      expect(clientInfo.capabilities).toEqual(mockCapabilities);
      expect(logger.debug).toHaveBeenCalledWith(`Capabilities from client1: ${JSON.stringify(mockCapabilities)}`);
    });

    it('should merge capabilities from multiple clients without conflicts', async () => {
      const capabilities1: ServerCapabilities = {
        resources: { subscribe: true },
        tools: { listChanged: true },
      };

      const capabilities2: ServerCapabilities = {
        prompts: { listChanged: true },
        experimental: { feature1: { test: 'value' } },
      };

      (mockClient1.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities1);
      (mockClient2.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities2);

      const clients: OutboundConnections = new Map();
      clients.set('client1', {
        name: 'client1',
        client: mockClient1,
        status: ClientStatus.Connected,
        transport: {} as any,
      });
      clients.set('client2', {
        name: 'client2',
        client: mockClient2,
        status: ClientStatus.Connected,
        transport: {} as any,
      });

      const result = await setupCapabilities(clients, mockServerInfo);

      expect(result).toEqual({
        resources: { subscribe: true },
        tools: { listChanged: true },
        prompts: { listChanged: true },
        experimental: { feature1: { test: 'value' } },
      });
    });

    it('should detect and resolve capability conflicts', async () => {
      const capabilities1: ServerCapabilities = {
        resources: { subscribe: true, listChanged: true },
        tools: { listChanged: true },
      };

      const capabilities2: ServerCapabilities = {
        resources: { subscribe: false, listChanged: false }, // Conflicts with client1
        prompts: { listChanged: true },
      };

      (mockClient1.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities1);
      (mockClient2.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities2);

      const clients: OutboundConnections = new Map();
      clients.set('client1', {
        name: 'client1',
        client: mockClient1,
        status: ClientStatus.Connected,
        transport: {} as any,
      });
      clients.set('client2', {
        name: 'client2',
        client: mockClient2,
        status: ClientStatus.Connected,
        transport: {} as any,
      });

      const result = await setupCapabilities(clients, mockServerInfo);

      // client2 should override client1 values
      expect(result).toEqual({
        resources: { subscribe: true, listChanged: true },
        tools: { listChanged: true },
        prompts: { listChanged: true },
      });

      // Should log conflicts
      expect(logger.warn).toHaveBeenCalledWith(
        'Capability conflict in resources.subscribe: client client2 overriding existing value',
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Capability conflict in resources.listChanged: client client2 overriding existing value',
      );
      expect(logger.debug).toHaveBeenCalledWith('Existing: true, New: false');
      expect(logger.debug).toHaveBeenCalledWith('Existing: true, New: false');
      expect(logger.info).toHaveBeenCalledWith(
        'Client client2 has 2 resources capability conflicts: subscribe, listChanged',
      );
    });

    it('should handle notification capabilities without logging conflicts', async () => {
      const capabilities1: ServerCapabilities = {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
      };

      const capabilities2: ServerCapabilities = {
        tools: { listChanged: true },
        prompts: { listChanged: true },
      };

      (mockClient1.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities1);
      (mockClient2.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities2);

      const clients: OutboundConnections = new Map();
      clients.set('client1', {
        name: 'client1',
        client: mockClient1,
        status: ClientStatus.Connected,
        transport: {} as any,
      });
      clients.set('client2', {
        name: 'client2',
        client: mockClient2,
        status: ClientStatus.Connected,
        transport: {} as any,
      });

      const result = await setupCapabilities(clients, mockServerInfo);

      // Verify listChanged is aggregated with OR logic
      expect(result.tools?.listChanged).toBe(true);
      expect(result.resources?.listChanged).toBe(true);
      expect(result.prompts?.listChanged).toBe(true);

      // Verify NO warnings logged for listChanged
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('listChanged'));
    });

    it('should handle clients with no capabilities', async () => {
      (mockClient1.getServerCapabilities as unknown as MockInstance).mockReturnValue(null);
      (mockClient2.getServerCapabilities as unknown as MockInstance).mockReturnValue(undefined);
      (mockClient3.getServerCapabilities as unknown as MockInstance).mockReturnValue({});

      const clients: OutboundConnections = new Map();
      clients.set('client1', {
        name: 'client1',
        client: mockClient1,
        status: ClientStatus.Connected,
        transport: {} as any,
      });
      clients.set('client2', {
        name: 'client2',
        client: mockClient2,
        status: ClientStatus.Connected,
        transport: {} as any,
      });
      clients.set('client3', {
        name: 'client3',
        client: mockClient3,
        status: ClientStatus.Connected,
        transport: {} as any,
      });

      const result = await setupCapabilities(clients, mockServerInfo);

      expect(result).toEqual({});
    });

    it('should handle client capability retrieval errors', async () => {
      const error = new Error('Failed to get capabilities');
      (mockClient1.getServerCapabilities as unknown as MockInstance).mockImplementation(() => {
        throw error;
      });

      const capabilities2: ServerCapabilities = {
        tools: { listChanged: true },
      };
      (mockClient2.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities2);

      const clients: OutboundConnections = new Map();
      clients.set('client1', {
        name: 'client1',
        client: mockClient1,
        status: ClientStatus.Connected,
        transport: {} as any,
      });
      clients.set('client2', {
        name: 'client2',
        client: mockClient2,
        status: ClientStatus.Connected,
        transport: {} as any,
      });

      const result = await setupCapabilities(clients, mockServerInfo);

      // Should continue with other clients despite error
      expect(result).toEqual({
        tools: { listChanged: true },
      });

      expect(logger.error).toHaveBeenCalledWith(`Failed to get capabilities from client1: ${error}`);
    });

    it('should handle complex nested capability merging', async () => {
      const capabilities1: ServerCapabilities = {
        resources: {
          listChanged: true,
          subscribe: true,
        },
        experimental: {
          feature1: { enabled: true, config: { timeout: 5000 } },
          feature2: { test: 'value' },
        },
      };

      const capabilities2: ServerCapabilities = {
        resources: {
          listChanged: true, // Same value, no conflict
          subscribe: false, // New capability
        },
        experimental: {
          feature1: { enabled: false, config: { timeout: 10000 } }, // Conflict
          feature3: { value: 'new' }, // New capability
        },
        logging: {
          level: 'debug',
        },
      };

      (mockClient1.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities1);
      (mockClient2.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities2);

      const clients: OutboundConnections = new Map();
      clients.set('client1', {
        name: 'client1',
        client: mockClient1,
        status: ClientStatus.Connected,
        transport: {} as any,
      });
      clients.set('client2', {
        name: 'client2',
        client: mockClient2,
        status: ClientStatus.Connected,
        transport: {} as any,
      });

      const result = await setupCapabilities(clients, mockServerInfo);

      expect(result).toEqual({
        resources: {
          listChanged: true,
          subscribe: true,
        },
        experimental: {
          feature1: { enabled: false, config: { timeout: 10000 } },
          feature2: { test: 'value' },
          feature3: { value: 'new' },
        },
        logging: {
          level: 'debug',
        },
      });

      // Should log conflicts for subscribe and feature1
      expect(logger.warn).toHaveBeenCalledWith(
        'Capability conflict in resources.subscribe: client client2 overriding existing value',
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Capability conflict in experimental.feature1: client client2 overriding existing value',
      );
      expect(logger.info).toHaveBeenCalledWith('Client client2 has 1 resources capability conflicts: subscribe');
      expect(logger.info).toHaveBeenCalledWith('Client client2 has 1 experimental capability conflicts: feature1');
    });

    it('should handle three-way capability conflicts', async () => {
      const capabilities1: ServerCapabilities = {
        tools: { listChanged: true },
      };

      const capabilities2: ServerCapabilities = {
        tools: { listChanged: false }, // Conflicts with client1
      };

      const capabilities3: ServerCapabilities = {
        tools: { listChanged: true }, // Conflicts with client2
      };

      (mockClient1.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities1);
      (mockClient2.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities2);
      (mockClient3.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities3);

      const clients: OutboundConnections = new Map();
      clients.set('client1', {
        name: 'client1',
        client: mockClient1,
        status: ClientStatus.Connected,
        transport: {} as any,
      });
      clients.set('client2', {
        name: 'client2',
        client: mockClient2,
        status: ClientStatus.Connected,
        transport: {} as any,
      });
      clients.set('client3', {
        name: 'client3',
        client: mockClient3,
        status: ClientStatus.Connected,
        transport: {} as any,
      });

      const result = await setupCapabilities(clients, mockServerInfo);

      // Final result should have client3's value (last one wins)
      expect(result).toEqual({
        tools: { listChanged: true },
      });

      // Should log conflict for client2 only (client3 doesn't conflict due to OR logic)
      expect(logger.warn).toHaveBeenCalledWith(
        'Capability conflict in tools.listChanged: client client2 overriding existing value',
      );
      // Note: client3 doesn't log conflict because current value is already true (OR logic)
    });

    it('should handle edge cases with null and undefined values', async () => {
      const capabilities1: ServerCapabilities = {
        resources: { listChanged: null as any },
        tools: { listChanged: undefined as any },
      };

      const capabilities2: ServerCapabilities = {
        resources: { listChanged: true },
        tools: { listChanged: false },
      };

      (mockClient1.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities1);
      (mockClient2.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities2);

      const clients: OutboundConnections = new Map();
      clients.set('client1', {
        name: 'client1',
        client: mockClient1,
        status: ClientStatus.Connected,
        transport: {} as any,
      });
      clients.set('client2', {
        name: 'client2',
        client: mockClient2,
        status: ClientStatus.Connected,
        transport: {} as any,
      });

      const result = await setupCapabilities(clients, mockServerInfo);

      expect(result).toEqual({
        resources: { listChanged: true },
        tools: { listChanged: false },
      });

      // Should detect conflicts between null/undefined and actual values
      expect(logger.warn).toHaveBeenCalledWith(
        'Capability conflict in resources.listChanged: client client2 overriding existing value',
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Capability conflict in tools.listChanged: client client2 overriding existing value',
      );
    });

    it('should store capabilities on individual client info objects', async () => {
      const capabilities1: ServerCapabilities = {
        resources: { listChanged: true },
      };

      const capabilities2: ServerCapabilities = {
        tools: { listChanged: true },
      };

      (mockClient1.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities1);
      (mockClient2.getServerCapabilities as unknown as MockInstance).mockReturnValue(capabilities2);

      const clientInfo1: OutboundConnection = {
        name: 'client1',
        client: mockClient1,
        status: ClientStatus.Connected,
        transport: {} as any,
      };

      const clientInfo2: OutboundConnection = {
        name: 'client2',
        client: mockClient2,
        status: ClientStatus.Connected,
        transport: {} as any,
      };

      const clients: OutboundConnections = new Map();
      clients.set('client1', clientInfo1);
      clients.set('client2', clientInfo2);

      await setupCapabilities(clients, mockServerInfo);

      // Each client should have its own capabilities stored
      expect(clientInfo1.capabilities).toEqual(capabilities1);
      expect(clientInfo2.capabilities).toEqual(capabilities2);
    });
  });
});
