import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { MCP_SERVER_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@src/constants.js';
// Import the mocked modules
import logger from '@src/logger/logger.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientManager } from './core/client/clientManager.js';
import { ServerManager } from './core/server/serverManager.js';
import { setupServer } from './server.js';
import configReloadService from './services/configReloadService.js';
import { createTransports } from './transport/transportFactory.js';

// Mock dependencies
vi.mock('@src/logger/logger.ts', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./transport/transportFactory.js', () => ({
  createTransports: vi.fn(),
}));

vi.mock('./core/client/clientManager.js', () => ({
  ClientManager: {
    getOrCreateInstance: vi.fn(),
  },
}));

vi.mock('./core/server/serverManager.js', () => ({
  ServerManager: {
    getOrCreateInstance: vi.fn(),
  },
}));

vi.mock('@src/config/mcpConfigManager.ts', () => ({
  McpConfigManager: {
    getInstance: vi.fn(),
  },
}));

vi.mock('./services/configReloadService.js', () => ({
  default: {
    initialize: vi.fn(),
  },
}));

describe('server', () => {
  let mockTransports: any;
  let mockClients: any;
  let mockServerManager: any;
  let mockConfigManager: any;
  let mockClientManager: any;

  beforeEach(() => {
    vi.resetAllMocks();

    // Setup mock transports
    mockTransports = {
      stdio: { name: 'stdio' },
      http: { name: 'http' },
    };
    vi.mocked(createTransports).mockReturnValue(mockTransports);

    // Setup mock clients
    mockClients = new Map([
      ['client1', { connect: vi.fn() }],
      ['client2', { connect: vi.fn() }],
    ]);
    mockClientManager = {
      createClients: vi.fn().mockResolvedValue(mockClients),
      initializeClientsAsync: vi.fn().mockReturnValue(mockClients),
      setInstructionAggregator: vi.fn(),
    };
    vi.mocked(ClientManager.getOrCreateInstance).mockReturnValue(mockClientManager);

    // Setup mock server manager
    mockServerManager = {
      start: vi.fn(),
      stop: vi.fn(),
      getStatus: vi.fn().mockReturnValue('running'),
      setInstructionAggregator: vi.fn(),
    };
    vi.mocked(ServerManager.getOrCreateInstance).mockReturnValue(mockServerManager);

    // Setup mock config manager
    mockConfigManager = {
      getTransportConfig: vi.fn().mockReturnValue({ mcpServers: {} }),
    };
    vi.mocked(McpConfigManager.getInstance).mockReturnValue(mockConfigManager);
  });

  describe('setupServer', () => {
    it('should set up server successfully', async () => {
      const result = await setupServer();

      expect(result.serverManager).toBe(mockServerManager);
      expect(result.loadingManager).toBeDefined();
      expect(result.loadingPromise).toBeDefined();
      expect(result.instructionAggregator).toBeDefined();
    });

    it('should get transport configuration from McpConfigManager', async () => {
      // Clear the call count before the test to isolate this test
      vi.mocked(McpConfigManager.getInstance).mockClear();
      vi.mocked(mockConfigManager.getTransportConfig).mockClear();

      await setupServer();

      // Check that methods were called during setupServer
      expect(McpConfigManager.getInstance).toHaveBeenCalled();
      expect(mockConfigManager.getTransportConfig).toHaveBeenCalled();
    });

    it('should create transports from configuration', async () => {
      await setupServer();

      expect(createTransports).toHaveBeenCalledWith({ mcpServers: {} });
    });

    it('should log transport creation', async () => {
      await setupServer();

      expect(logger.info).toHaveBeenCalledWith('Created 2 transports');
    });

    it('should create clients for each transport', async () => {
      await setupServer();

      expect(mockClientManager.createClients).toHaveBeenCalledWith(mockTransports);
    });

    it('should log client creation', async () => {
      await setupServer();

      expect(logger.info).toHaveBeenCalledWith('Connected to 2 MCP servers synchronously');
    });

    it('should create ServerManager instance with correct parameters', async () => {
      await setupServer();

      expect(ServerManager.getOrCreateInstance).toHaveBeenCalledWith(
        { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        { capabilities: MCP_SERVER_CAPABILITIES },
        mockClients,
        mockTransports,
      );
    });

    it('should initialize config reload service', async () => {
      await setupServer();

      expect(configReloadService.initialize).toHaveBeenCalledWith(mockTransports);
    });

    it('should log successful setup completion', async () => {
      await setupServer();

      expect(logger.info).toHaveBeenCalledWith('Synchronous server setup completed - all MCP servers connected');
    });

    it('should return the ServerManager instance', async () => {
      const result = await setupServer();

      expect(result.serverManager).toBe(mockServerManager);
      expect(result.loadingManager).toBeDefined();
      expect(result.loadingPromise).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle transport creation errors', async () => {
      const error = new Error('Transport creation failed');
      vi.mocked(createTransports).mockImplementation(() => {
        throw error;
      });

      await expect(setupServer()).rejects.toThrow('Transport creation failed');
      expect(logger.error).toHaveBeenCalledWith('Failed to set up server: Error: Transport creation failed');
    });

    it('should handle client creation errors gracefully with sync loading', async () => {
      const error = new Error('Client creation failed');
      mockClientManager.createClients.mockRejectedValue(error);

      await expect(setupServer()).rejects.toThrow('Client creation failed');
      expect(mockClientManager.createClients).toHaveBeenCalled();
    });

    it('should handle ServerManager creation errors', async () => {
      const error = new Error('ServerManager creation failed');
      vi.mocked(ServerManager.getOrCreateInstance).mockImplementation(() => {
        throw error;
      });

      await expect(setupServer()).rejects.toThrow('ServerManager creation failed');
    });

    it('should rethrow errors after logging', async () => {
      const error = new Error('Test error');
      vi.mocked(createTransports).mockImplementation(() => {
        throw error;
      });

      await expect(setupServer()).rejects.toThrow(error);
    });
  });
});
