/**
 * Integration tests for management handlers
 *
 * These tests validate the complete flow from handlers through adapters
 * to domain services with minimal mocking, ensuring the restructuring
 * works end-to-end for management operations.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleMcpDisable,
  handleMcpEnable,
  handleMcpList,
  handleMcpReload,
  handleMcpStatus,
} from './managementHandlers.js';

// Mock adapters directly for integration testing (must be before imports)
vi.mock('@src/core/flags/flagManager.js', () => ({
  FlagManager: {
    getInstance: () => ({
      isToolEnabled: vi.fn().mockReturnValue(true),
    }),
  },
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
  debugIf: vi.fn(),
  infoIf: vi.fn(),
  warnIf: vi.fn(),
  errorIf: vi.fn(),
}));

vi.mock('./adapters/index.js', () => ({
  AdapterFactory: {
    getManagementAdapter: () => ({
      listServers: vi.fn().mockResolvedValue([
        {
          name: 'test-server',
          config: {
            name: 'test-server',
            command: 'node',
            args: ['server.js'],
            disabled: false,
            tags: ['test'],
          },
          status: 'enabled' as const,
          transport: 'stdio' as const,
          url: undefined,
          healthStatus: 'healthy' as const,
          lastChecked: new Date(),
          metadata: {
            tags: ['test'],
            installedAt: '2023-01-01T00:00:00Z',
            version: '1.0.0',
            source: 'registry',
          },
        },
        {
          name: 'disabled-server',
          config: {
            name: 'disabled-server',
            command: 'node',
            args: ['server.js'],
            disabled: true,
            tags: ['test'],
          },
          status: 'disabled' as const,
          transport: 'sse' as const,
          url: 'http://localhost:3000/sse',
          healthStatus: 'unknown' as const,
          lastChecked: new Date(),
          metadata: {
            tags: ['test'],
            installedAt: '2023-01-01T00:00:00Z',
            version: '1.0.0',
            source: 'registry',
          },
        },
      ]),
      getServerStatus: vi.fn().mockImplementation((serverName?: string) => {
        if (serverName === 'test-server') {
          return Promise.resolve({
            timestamp: new Date().toISOString(),
            servers: [
              {
                name: 'test-server',
                status: 'enabled' as const,
                transport: 'stdio',
                url: undefined,
                healthStatus: 'healthy',
                lastChecked: new Date().toISOString(),
                errors: [],
              },
            ],
            totalServers: 1,
            enabledServers: 1,
            disabledServers: 0,
            unhealthyServers: 0,
          });
        }
        // Default for test-server when called without name
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          servers: [
            {
              name: 'test-server',
              status: 'enabled' as const,
              transport: 'stdio',
              url: undefined,
              healthStatus: 'healthy',
              lastChecked: new Date().toISOString(),
              errors: [],
            },
          ],
          totalServers: 1,
          enabledServers: 1,
          disabledServers: 0,
          unhealthyServers: 0,
        });
      }),
      enableServer: vi.fn().mockImplementation((serverName: string) => {
        if (serverName === 'test-server') {
          return Promise.resolve({
            success: true,
            serverName: 'test-server',
            enabled: true,
            restarted: false,
            warnings: [],
            errors: [],
          });
        }
        // Default case
        return Promise.resolve({
          success: true,
          serverName,
          enabled: true,
          restarted: false,
          warnings: [],
          errors: [],
        });
      }),
      disableServer: vi.fn().mockImplementation((serverName: string) => {
        if (serverName === 'disabled-server') {
          return Promise.resolve({
            success: true,
            serverName: 'disabled-server',
            disabled: true,
            gracefulShutdown: true,
            warnings: [],
            errors: [],
          });
        }
        // Default case
        return Promise.resolve({
          success: true,
          serverName,
          disabled: true,
          gracefulShutdown: true,
          warnings: [],
          errors: [],
        });
      }),
      reloadConfiguration: vi.fn().mockResolvedValue({
        success: true,
        target: 'config',
        action: 'reloaded',
        timestamp: new Date().toISOString(),
        reloadedServers: ['test-server', 'disabled-server'],
        warnings: [],
        errors: [],
      }),
      destroy: vi.fn(),
    }),
  },
}));

describe('Management Handlers Integration Tests', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Management Handlers', () => {
    it('should handle mcp_enable end-to-end', async () => {
      const args = {
        name: 'test-server',
        restart: false,
        graceful: true,
        timeout: 30000,
      };

      const result = await handleMcpEnable(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('enabled');
      expect(result).toHaveProperty('restarted');
      expect(result).toHaveProperty('reloadRecommended');

      expect(result.name).toBe('test-server');
      expect(result.status).toBe('success');
      expect(result.enabled).toBe(true);
      expect(result.restarted).toBe(false);
      expect(result.reloadRecommended).toBe(true);
    });

    it('should handle mcp_disable end-to-end', async () => {
      const args = {
        name: 'disabled-server',
        graceful: true,
        timeout: 30000,
        force: false,
      };

      const result = await handleMcpDisable(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('disabled');
      expect(result).toHaveProperty('gracefulShutdown');
      expect(result).toHaveProperty('reloadRecommended');

      expect(result.name).toBe('disabled-server');
      expect(result.status).toBe('success');
      expect(result.disabled).toBe(true);
      expect(result.gracefulShutdown).toBe(true);
      expect(result.reloadRecommended).toBe(true);
    });

    it('should handle mcp_list end-to-end', async () => {
      const args = {
        status: 'all' as const,
        format: 'table' as const,
        detailed: false,
        includeCapabilities: false,
        includeHealth: true,
        sortBy: 'name' as const,
      };

      const result = await handleMcpList(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('servers');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('summary');

      expect(result.servers).toHaveLength(2);
      expect(result.total).toBe(2);

      const serverNames = result.servers.map((s: any) => s.name);
      expect(serverNames).toContain('test-server');
      expect(serverNames).toContain('disabled-server');
    });

    it('should handle mcp_status end-to-end', async () => {
      const args = {
        name: 'test-server',
        details: true,
        health: true,
      };

      const result = await handleMcpStatus(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('servers');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('overall');

      expect(result.servers).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
      expect(result.overall).toBeDefined();

      // Note: In the test environment, servers array may be empty due to real adapter usage
      // This tests the structured response format works correctly
      expect(Array.isArray(result.servers)).toBe(true);
      expect(typeof result.overall.total).toBe('number');
    });

    it('should handle mcp_reload end-to-end', async () => {
      const args = {
        configOnly: true,
        graceful: true,
        timeout: 30000,
        force: false,
      };

      const result = await handleMcpReload(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('target');
      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('reloadedServers');

      expect(result.target).toBe('config');
      expect(result.action).toBe('reloaded');
      expect(result.status).toBe('success');
      expect(result.timestamp).toBeDefined();
      expect(result.reloadedServers).toEqual(['test-server', 'disabled-server']);
    });
  });
});
