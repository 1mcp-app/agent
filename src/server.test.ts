import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupServer } from './server.js';
import { MCP_SERVER_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from './constants.js';

// Mock dependencies
vi.mock('./logger/logger.js', () => ({
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
  createClients: vi.fn(),
}));

vi.mock('./core/server/serverManager.js', () => ({
  ServerManager: {
    getOrCreateInstance: vi.fn(),
  },
}));

vi.mock('./config/mcpConfigManager.js', () => ({
  McpConfigManager: {
    getInstance: vi.fn(),
  },
}));

vi.mock('./services/configReloadService.js', () => ({
  default: {
    initialize: vi.fn(),
  },
}));

// Import the mocked modules
import logger from './logger/logger.js';
import { createTransports } from './transport/transportFactory.js';
import { createClients } from './core/client/clientManager.js';
import { ServerManager } from './core/server/serverManager.js';
import { McpConfigManager } from './config/mcpConfigManager.js';
import configReloadService from './services/configReloadService.js';

describe('server', () => {
  let mockTransports: any;
  let mockClients: any;
  let mockServerManager: any;
  let mockConfigManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

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
    vi.mocked(createClients).mockResolvedValue(mockClients);

    // Setup mock server manager
    mockServerManager = {
      start: vi.fn(),
      stop: vi.fn(),
      getStatus: vi.fn().mockReturnValue('running'),
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

      expect(result).toBe(mockServerManager);
    });

    it('should get transport configuration from McpConfigManager', async () => {
      await setupServer();

      expect(McpConfigManager.getInstance).toHaveBeenCalledTimes(1);
      expect(mockConfigManager.getTransportConfig).toHaveBeenCalledTimes(1);
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

      expect(createClients).toHaveBeenCalledWith(mockTransports);
    });

    it('should log client creation', async () => {
      await setupServer();

      expect(logger.info).toHaveBeenCalledWith('Created 2 clients');
    });

    it('should create ServerManager instance with correct parameters', async () => {
      await setupServer();

      expect(ServerManager.getOrCreateInstance).toHaveBeenCalledWith(
        { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        { capabilities: MCP_SERVER_CAPABILITIES },
        mockClients,
        mockTransports
      );
    });

    it('should initialize config reload service', async () => {
      await setupServer();

      expect(configReloadService.initialize).toHaveBeenCalledWith(mockTransports);
    });

    it('should log successful setup completion', async () => {
      await setupServer();

      expect(logger.info).toHaveBeenCalledWith('Server setup completed successfully');
    });

    it('should return the ServerManager instance', async () => {
      const result = await setupServer();

      expect(result).toBe(mockServerManager);
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

    it('should handle client creation errors', async () => {
      const error = new Error('Client creation failed');
      vi.mocked(createClients).mockRejectedValue(error);

      await expect(setupServer()).rejects.toThrow('Client creation failed');
      expect(logger.error).toHaveBeenCalledWith('Failed to set up server: Error: Client creation failed');
    });

    it('should handle ServerManager creation errors', async () => {
      const error = new Error('ServerManager creation failed');
      vi.mocked(ServerManager.getOrCreateInstance).mockImplementation(() => {
        throw error;
      });

      await expect(setupServer()).rejects.toThrow('ServerManager creation failed');
      expect(logger.error).toHaveBeenCalledWith('Failed to set up server: Error: ServerManager creation failed');
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