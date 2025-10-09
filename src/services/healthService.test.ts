import { ClientStatus } from '@src/core/types/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthService, HealthStatus } from './healthService.js';

// Mock dependencies
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    current: null,
  },
}));

vi.mock('@src/config/mcpConfigManager.js', () => ({
  McpConfigManager: {
    getInstance: vi.fn(),
  },
}));

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: vi.fn(),
  },
}));

describe('HealthService', () => {
  let healthService: HealthService;
  let mockServerManager: any;
  let mockMcpConfig: any;
  let mockAgentConfig: any;

  beforeEach(async () => {
    // Reset the singleton instance
    (HealthService as any).instance = undefined;

    // Mock ServerManager
    mockServerManager = {
      getClients: vi.fn(),
    };

    // Mock McpConfigManager
    mockMcpConfig = {
      getTransportConfig: vi.fn(),
    };

    // Mock AgentConfigManager
    mockAgentConfig = {
      isAuthEnabled: vi.fn(),
      getHealthDetailLevel: vi.fn().mockReturnValue('minimal'),
    };

    // Setup mocks
    const { ServerManager } = await import('@src/core/server/serverManager.js');
    (ServerManager as any).current = mockServerManager;

    const { McpConfigManager } = await import('@src/config/mcpConfigManager.js');
    vi.mocked(McpConfigManager.getInstance).mockReturnValue(mockMcpConfig);

    const { AgentConfigManager } = await import('@src/core/server/agentConfig.js');
    vi.mocked(AgentConfigManager.getInstance).mockReturnValue(mockAgentConfig);

    // Create HealthService instance after mocks are set up
    healthService = HealthService.getInstance();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = HealthService.getInstance();
      const instance2 = HealthService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('performHealthCheck', () => {
    it('should return healthy status when all servers are connected', async () => {
      // Set to full detail level for this test
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('full');
      // Setup mocks
      const mockClients = new Map([
        [
          'server1',
          {
            status: ClientStatus.Connected,
            lastConnected: new Date(),
            transport: { tags: ['test'] },
          },
        ],
        [
          'server2',
          {
            status: ClientStatus.Connected,
            lastConnected: new Date(),
            transport: { tags: ['network'] },
          },
        ],
      ]);

      mockServerManager.getClients.mockReturnValue(mockClients);
      mockMcpConfig.getTransportConfig.mockReturnValue({
        server1: { command: 'test' },
        server2: { command: 'test' },
      });
      mockAgentConfig.isAuthEnabled.mockReturnValue(false);

      const result = await healthService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.servers.total).toBe(2);
      expect(result.servers.healthy).toBe(2);
      expect(result.servers.unhealthy).toBe(0);
      expect(result.configuration.loaded).toBe(true);
      expect(result.configuration.serverCount).toBe(2);
      expect(result.configuration.enabledCount).toBe(2);
      expect(result.configuration.disabledCount).toBe(0);
    });

    it('should return degraded status when some servers are unhealthy', async () => {
      // Set to full detail level for this test
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('full');
      const mockClients = new Map([
        [
          'server1',
          {
            status: ClientStatus.Connected,
            lastConnected: new Date(),
            transport: { tags: ['test'] },
          },
        ],
        [
          'server2',
          {
            status: ClientStatus.Error,
            lastError: new Error('Connection failed'),
            transport: { tags: ['network'] },
          },
        ],
        [
          'server3',
          {
            status: ClientStatus.Connected,
            lastConnected: new Date(),
            transport: { tags: ['filesystem'] },
          },
        ],
      ]);

      mockServerManager.getClients.mockReturnValue(mockClients);
      mockMcpConfig.getTransportConfig.mockReturnValue({
        server1: { command: 'test' },
        server2: { command: 'test' },
        server3: { command: 'test' },
      });
      mockAgentConfig.isAuthEnabled.mockReturnValue(true);

      const result = await healthService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.servers.total).toBe(3);
      expect(result.servers.healthy).toBe(2);
      expect(result.servers.unhealthy).toBe(1);
      expect(result.configuration.authEnabled).toBe(true);
      expect(result.configuration.enabledCount).toBe(3);
      expect(result.configuration.disabledCount).toBe(0);
    });

    it('should return unhealthy status when majority of servers are down', async () => {
      // Set to full detail level for this test
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('full');
      const mockClients = new Map([
        [
          'server1',
          {
            status: ClientStatus.Error,
            lastError: new Error('Connection failed'),
            transport: { tags: ['test'] },
          },
        ],
        [
          'server2',
          {
            status: ClientStatus.Disconnected,
            transport: { tags: ['network'] },
          },
        ],
        [
          'server3',
          {
            status: ClientStatus.Connected,
            lastConnected: new Date(),
            transport: { tags: ['filesystem'] },
          },
        ],
      ]);

      mockServerManager.getClients.mockReturnValue(mockClients);
      mockMcpConfig.getTransportConfig.mockReturnValue({
        server1: { command: 'test' },
        server2: { command: 'test' },
        server3: { command: 'test' },
      });
      mockAgentConfig.isAuthEnabled.mockReturnValue(false);

      const result = await healthService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.servers.total).toBe(3);
      expect(result.servers.healthy).toBe(1);
      expect(result.servers.unhealthy).toBe(2);
      expect(result.configuration.enabledCount).toBe(3);
      expect(result.configuration.disabledCount).toBe(0);
    });

    it('should return degraded status when no servers are configured', async () => {
      // Set to full detail level for this test
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('full');
      mockServerManager.getClients.mockReturnValue(new Map());
      mockMcpConfig.getTransportConfig.mockReturnValue({});
      mockAgentConfig.isAuthEnabled.mockReturnValue(false);

      const result = await healthService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.servers.total).toBe(0);
      expect(result.servers.healthy).toBe(0);
      expect(result.servers.unhealthy).toBe(0);
      expect(result.configuration.serverCount).toBe(0);
      expect(result.configuration.enabledCount).toBe(0);
      expect(result.configuration.disabledCount).toBe(0);
    });

    it('should return unhealthy status when configuration fails to load', async () => {
      // Set to full detail level for this test
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('full');
      mockServerManager.getClients.mockReturnValue(new Map());
      mockMcpConfig.getTransportConfig.mockImplementation(() => {
        throw new Error('Config load failed');
      });

      const result = await healthService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.configuration.loaded).toBe(false);
      expect(result.configuration.enabledCount).toBe(0);
      expect(result.configuration.disabledCount).toBe(0);
    });

    it('should include system health metrics', async () => {
      // Set to full detail level for this test
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('full');
      mockServerManager.getClients.mockReturnValue(new Map());
      mockMcpConfig.getTransportConfig.mockReturnValue({});
      mockAgentConfig.isAuthEnabled.mockReturnValue(false);

      const result = await healthService.performHealthCheck();

      expect(result.system).toBeDefined();
      expect(result.system.uptime).toBeGreaterThanOrEqual(0);
      expect(result.system.memory.used).toBeGreaterThan(0);
      expect(result.system.memory.total).toBeGreaterThan(0);
      expect(result.system.memory.percentage).toBeGreaterThanOrEqual(0);
      expect(result.system.process.pid).toBe(process.pid);
      expect(result.system.process.nodeVersion).toBe(process.version);
      expect(result.system.process.platform).toBe(process.platform);
      expect(result.system.process.arch).toBe(process.arch);
    });

    it('should handle server manager being null', async () => {
      // Set to full detail level for this test
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('full');
      const { ServerManager } = await import('../core/server/serverManager.js');
      (ServerManager as any).current = null;

      mockMcpConfig.getTransportConfig.mockReturnValue({});
      mockAgentConfig.isAuthEnabled.mockReturnValue(false);

      const result = await healthService.performHealthCheck();

      expect(result.servers.total).toBe(0);
      expect(result.servers.healthy).toBe(0);
      expect(result.servers.unhealthy).toBe(0);
      expect(result.servers.details).toEqual([]);
    });

    it('should include server details with error messages', async () => {
      // Set to full detail level for this test
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('full');
      const mockClients = new Map([
        [
          'server1',
          {
            status: ClientStatus.Error,
            lastError: new Error('Authentication failed'),
            lastConnected: new Date('2025-01-01'),
            transport: { tags: ['test'] },
          },
        ],
      ]);

      mockServerManager.getClients.mockReturnValue(mockClients);
      mockMcpConfig.getTransportConfig.mockReturnValue({
        server1: { command: 'test' },
      });
      mockAgentConfig.isAuthEnabled.mockReturnValue(false);

      const result = await healthService.performHealthCheck();

      expect(result.servers.details).toHaveLength(1);
      expect(result.servers.details[0]).toEqual({
        name: 'server1',
        status: ClientStatus.Error,
        healthy: false,
        lastConnected: new Date('2025-01-01'),
        lastError: 'Authentication failed',
        tags: ['test'],
      });
    });
  });

  describe('getHttpStatusCode', () => {
    it('should return 200 for healthy status', () => {
      const code = healthService.getHttpStatusCode(HealthStatus.HEALTHY);
      expect(code).toBe(200);
    });

    it('should return 200 for degraded status', () => {
      const code = healthService.getHttpStatusCode(HealthStatus.DEGRADED);
      expect(code).toBe(200);
    });

    it('should return 503 for unhealthy status', () => {
      const code = healthService.getHttpStatusCode(HealthStatus.UNHEALTHY);
      expect(code).toBe(503);
    });

    it('should return 500 for unknown status', () => {
      const code = healthService.getHttpStatusCode('unknown' as HealthStatus);
      expect(code).toBe(500);
    });
  });

  describe('Health Security Features', () => {
    beforeEach(() => {
      const mockClients = new Map([
        [
          'test-server',
          {
            status: ClientStatus.Connected,
            lastConnected: new Date(),
            lastError: new Error('Connection failed with credentials user:password@localhost:5432/database'),
            transport: { tags: ['test'] },
          },
        ],
      ]);

      mockServerManager.getClients.mockReturnValue(mockClients);
      mockMcpConfig.getTransportConfig.mockReturnValue({
        'test-server': { command: 'test' },
      });
      mockAgentConfig.isAuthEnabled.mockReturnValue(false);
    });

    it('should return minimal detail level with no sensitive information', async () => {
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('minimal');

      const result = await healthService.performHealthCheck();

      expect(result.system.memory.used).toBe(0);
      expect(result.system.memory.total).toBe(0);
      expect(result.system.process.pid).toBe(0);
      expect(result.system.process.nodeVersion).toBe('');
      expect(result.servers.details).toEqual([]);
      expect(result.configuration.serverCount).toBe(0);
      expect(result.configuration.authEnabled).toBe(false);
    });

    it('should return basic detail level with sanitized errors', async () => {
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('basic');

      const result = await healthService.performHealthCheck();

      expect(result.system.memory.used).toBeGreaterThan(0);
      expect(result.system.process.pid).toBe(0);
      expect(result.system.process.nodeVersion).toBe('');
      expect(result.servers.details).toHaveLength(1);
      expect(result.servers.details[0].lastError).toBe(
        'Connection failed with credentials [REDACTED_CREDENTIAL][REDACTED_HOST]/database',
      );
    });

    it('should return full detail level with sanitized errors', async () => {
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('full');

      const result = await healthService.performHealthCheck();

      expect(result.system.memory.used).toBeGreaterThan(0);
      expect(result.system.process.pid).toBe(process.pid);
      expect(result.system.process.nodeVersion).toBe(process.version);
      expect(result.servers.details).toHaveLength(1);
      expect(result.servers.details[0].lastError).toBe(
        'Connection failed with credentials [REDACTED_CREDENTIAL][REDACTED_HOST]/database',
      );
    });

    it('should sanitize error messages containing URLs', async () => {
      // Set to full detail level for this test
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('full');
      const mockClients = new Map([
        [
          'web-server',
          {
            status: ClientStatus.Error,
            lastError: new Error('Failed to connect to https://api.example.com/v1/endpoint'),
            transport: { tags: ['web'] },
          },
        ],
      ]);

      mockServerManager.getClients.mockReturnValue(mockClients);

      const result = await healthService.performHealthCheck();

      expect(result.servers.details[0].lastError).toBe('Failed to connect to [REDACTED_URL]');
    });

    it('should sanitize error messages containing file paths', async () => {
      // Set to full detail level for this test
      mockAgentConfig.getHealthDetailLevel.mockReturnValue('full');
      const mockClients = new Map([
        [
          'file-server',
          {
            status: ClientStatus.Error,
            lastError: new Error('Cannot read config file /etc/app/config.json'),
            transport: { tags: ['file'] },
          },
        ],
      ]);

      mockServerManager.getClients.mockReturnValue(mockClients);

      const result = await healthService.performHealthCheck();

      expect(result.servers.details[0].lastError).toBe('Cannot read config file [REDACTED_PATH]');
    });
  });
});
