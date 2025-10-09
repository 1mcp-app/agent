import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { setupCapabilities } from '@src/core/capabilities/capabilityManager.js';
import { OutboundConnections } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { enhanceServerWithLogging } from '@src/logger/mcpLoggingEnhancer.js';
import configReloadService from '@src/services/configReloadService.js';

import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { ServerManager } from './serverManager.js';

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/shared/transport.js', () => ({
  Transport: vi.fn(),
}));

vi.mock('@src/logger/logger.js', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
  return {
    __esModule: true,
    default: mockLogger,
    debugIf: vi.fn(),
  };
});

vi.mock('../../services/configReloadService.js', () => ({
  __esModule: true,
  default: {
    updateServerInfo: vi.fn(),
    removeServerInfo: vi.fn(),
  },
}));

vi.mock('../capabilities/capabilityManager.js', () => ({
  setupCapabilities: vi.fn(),
}));

vi.mock('../../logger/mcpLoggingEnhancer.js', () => ({
  enhanceServerWithLogging: vi.fn(),
}));

vi.mock('@src/utils/config/presetNotificationService.js', () => ({
  PresetNotificationService: {
    getInstance: vi.fn().mockReturnValue({
      trackClient: vi.fn(),
      untrackClient: vi.fn(),
    }),
  },
}));

describe('ServerManager', () => {
  let mockConfig: { name: string; version: string };
  let mockCapabilities: { capabilities: Record<string, unknown> };
  let mockOutboundConns: OutboundConnections;
  let mockTransports: Record<string, Transport>;
  let mockTransport: Transport;
  let mockServer: Server;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Reset singleton state for test isolation
    ServerManager.resetInstance();

    // Setup test data
    mockConfig = { name: 'test-server', version: '1.0.0' };
    mockCapabilities = { capabilities: { test: true } };
    mockOutboundConns = new Map();
    mockTransports = {};
    mockTransport = {
      // Add any required Transport properties here
    } as Transport;
    mockServer = {
      connect: vi.fn().mockImplementation(async (transport: Transport) => {
        // Simulate setting transport property on connection
        (mockServer as any).transport = transport;
      }),
      transport: undefined,
    } as unknown as Server;

    // Setup mocks
    (Server as unknown as MockInstance).mockImplementation(() => mockServer);
    (setupCapabilities as unknown as MockInstance).mockResolvedValue(undefined);
    (enhanceServerWithLogging as unknown as MockInstance).mockReturnValue(undefined);
    (configReloadService.updateServerInfo as unknown as MockInstance).mockImplementation(() => undefined);
    (configReloadService.removeServerInfo as unknown as MockInstance).mockImplementation(() => undefined);
  });

  describe('getInstance', () => {
    it('should create a singleton instance', () => {
      const instance1 = ServerManager.getOrCreateInstance(
        mockConfig,
        mockCapabilities,
        mockOutboundConns,
        mockTransports,
      );
      const instance2 = ServerManager.getOrCreateInstance(
        mockConfig,
        mockCapabilities,
        mockOutboundConns,
        mockTransports,
      );

      expect(instance1).toBe(instance2);
    });
  });

  describe('connectTransport', () => {
    let serverManager: ServerManager;
    const sessionId = 'test-session';
    const tags = ['tag1', 'tag2'];

    beforeEach(() => {
      serverManager = ServerManager.getOrCreateInstance(
        mockConfig,
        mockCapabilities,
        mockOutboundConns,
        mockTransports,
      );
    });

    it('should successfully connect a transport', async () => {
      await serverManager.connectTransport(mockTransport, sessionId, { tags, enablePagination: false });

      expect(Server).toHaveBeenCalledWith(mockConfig, mockCapabilities);
      expect(enhanceServerWithLogging).toHaveBeenCalledWith(mockServer);
      expect(setupCapabilities).toHaveBeenCalled();
      expect(configReloadService.updateServerInfo).toHaveBeenCalledWith(sessionId, expect.any(Object));
      expect(mockServer.connect).toHaveBeenCalledWith(mockTransport);
      expect(logger.info).toHaveBeenCalledWith(`Connected transport for session ${sessionId}`);
    });

    it('should handle connection errors', async () => {
      const error = new Error('Connection failed');
      (mockServer.connect as unknown as MockInstance).mockRejectedValueOnce(error);

      await expect(
        serverManager.connectTransport(mockTransport, sessionId, { tags, enablePagination: false }),
      ).rejects.toThrow('Connection failed');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('disconnectTransport', () => {
    let serverManager: ServerManager;
    const sessionId = 'test-session';

    beforeEach(() => {
      serverManager = ServerManager.getOrCreateInstance(
        mockConfig,
        mockCapabilities,
        mockOutboundConns,
        mockTransports,
      );
    });

    it('should successfully disconnect a transport', async () => {
      await serverManager.connectTransport(mockTransport, sessionId, { enablePagination: false });
      vi.clearAllMocks(); // Clear the logs from connectTransport
      serverManager.disconnectTransport(sessionId);
      expect(configReloadService.removeServerInfo).toHaveBeenCalledWith(sessionId);
      expect(logger.info).toHaveBeenCalledWith(`Disconnected transport for session ${sessionId}`);
    });

    it('should handle non-existent session gracefully', () => {
      serverManager.disconnectTransport('non-existent');
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('transport management methods', () => {
    let serverManager: ServerManager;
    const sessionId = 'test-session';

    beforeEach(async () => {
      serverManager = ServerManager.getOrCreateInstance(
        mockConfig,
        mockCapabilities,
        mockOutboundConns,
        mockTransports,
      );
      await serverManager.connectTransport(mockTransport, sessionId, { enablePagination: false });
    });

    it('should get transport by session id', () => {
      const transport = serverManager.getTransport(sessionId);
      expect(transport).toBe(mockTransport);
    });

    it('should return undefined for non-existent session', () => {
      const transport = serverManager.getTransport('non-existent');
      expect(transport).toBeUndefined();
    });

    it('should get all transports', () => {
      const transports = serverManager.getTransports();
      expect(transports.size).toBe(1);
      expect(transports.get(sessionId)).toBe(mockTransport);
    });

    it('should get client transports', () => {
      const clientTransports = serverManager.getClientTransports();
      expect(clientTransports).toEqual(mockTransports);
    });

    it('should get active transports count', () => {
      expect(serverManager.getActiveTransportsCount()).toBe(1);
    });
  });

  describe('getServer', () => {
    let serverManager: ServerManager;
    const sessionId = 'test-session';
    const tags = ['tag1', 'tag2'];

    beforeEach(async () => {
      serverManager = ServerManager.getOrCreateInstance(
        mockConfig,
        mockCapabilities,
        mockOutboundConns,
        mockTransports,
      );
      await serverManager.connectTransport(mockTransport, sessionId, { tags, enablePagination: false });
    });

    it('should return server info for existing session', () => {
      const serverInfo = serverManager.getServer(sessionId);
      expect(serverInfo).toBeDefined();
      expect(serverInfo?.server).toBe(mockServer);
      expect(serverInfo?.tags).toEqual(tags);
    });

    it('should return undefined for non-existent session', () => {
      const serverInfo = serverManager.getServer('non-existent');
      expect(serverInfo).toBeUndefined();
    });
  });
});
