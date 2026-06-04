/**
 * Integration tests for internal tools
 *
 * These tests validate the complete flow from handlers through adapters
 * to domain services with minimal mocking, ensuring the restructuring
 * works end-to-end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleMcpInfo,
  handleMcpRegistryInfo,
  handleMcpRegistryList,
  handleMcpRegistryStatus,
  handleMcpSearch,
} from './discoveryHandlers.js';
import { handleMcpInstall, handleMcpUninstall, handleMcpUpdate } from './installationHandlers.js';
import './integration.testSetup.js';
import {
  handleMcpDisable,
  handleMcpEnable,
  handleMcpList,
  handleMcpReload,
  handleMcpStatus,
} from './managementHandlers.js';

describe('Internal Tools Integration Tests', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the AdapterFactory to clear cached adapters
    const { AdapterFactory } = await import('./adapters/index.js');
    AdapterFactory.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Discovery Handlers Integration', () => {
    it('should handle mcp_search end-to-end', async () => {
      const args = {
        status: 'all' as const,
        format: 'json' as const,
        query: 'test',
        limit: 10,
        offset: 0,
        transport: undefined,
        tags: undefined,
      };

      const result = await handleMcpSearch(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('registry');

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        name: 'test-server',
        version: '1.0.0',
        registry: 'official',
      });
      expect(result.total).toBe(1);
      expect(result.query).toBe('test');
      expect(result.registry).toBe('official');
    });

    it('should handle mcp_info end-to-end', async () => {
      const args = {
        name: 'test-server',
        includeCapabilities: true,
        includeConfig: true,
        format: 'table' as const,
      };

      const result = await handleMcpInfo(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('server');
      expect(result).toHaveProperty('configuration');
      expect(result).toHaveProperty('capabilities');
      expect(result).toHaveProperty('health');

      expect(result.server.name).toBe('test-server');
      expect(result.server.status).toBe('unknown');
      expect(result.server.transport).toBe('stdio');
      // Configuration is optional in schema, so we check for existence
      if (result.configuration) {
        if (result.configuration.command) {
          expect(result.configuration.command).toBe('test-server');
        }
        expect(result.configuration.tags).toEqual(['test', 'server']);
      }
    });

    it('should handle mcp_registry_status end-to-end', async () => {
      const args = {
        registry: 'official',
        includeStats: false,
      };

      const result = await handleMcpRegistryStatus(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('registry');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('responseTime');
      expect(result).toHaveProperty('lastCheck');
      expect(result).toHaveProperty('metadata');

      expect(result.registry).toBe('official');
      expect(result.status).toBe('online');
      expect(result.responseTime).toBe(100);
      expect(result.lastCheck).toBe('2023-01-01T00:00:00Z');
    });

    it('should handle mcp_registry_info end-to-end', async () => {
      const args = {
        registry: 'official',
      };

      const result = await handleMcpRegistryInfo(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('supportedFormats');
      expect(result).toHaveProperty('features');
      expect(result).toHaveProperty('statistics');

      expect(result.name).toBe('official');
      expect(result.url).toBe('https://registry.modelcontextprotocol.io');
      expect(result.description).toBe('The official Model Context Protocol server registry');
      expect(result.version).toBe('1.0.0');
    });

    it('should handle mcp_registry_list end-to-end', async () => {
      const args = {
        includeStats: false,
      };

      const result = await handleMcpRegistryList(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('registries');
      expect(result).toHaveProperty('total');

      expect(result.registries).toHaveLength(3);
      expect(result.total).toBe(3);

      const registryNames = result.registries.map((r: any) => r.name);
      expect(registryNames).toContain('Official MCP Registry');
      expect(registryNames).toContain('Community Registry');
      expect(registryNames).toContain('Experimental Registry');
    });
  });

  describe('Installation Handlers Integration', () => {
    it('should handle mcp_install end-to-end', async () => {
      const args = {
        name: 'test-server',
        version: '1.0.0',
        transport: 'stdio' as const,
        enabled: true,
        autoRestart: false,
        force: false,
        backup: false,
      };

      const result = await handleMcpInstall(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('location');
      expect(result).toHaveProperty('configPath');
      expect(result).toHaveProperty('reloadRecommended');

      expect(result.name).toBe('test-server');
      expect(result.status).toBe('applied');
      expect(result.version).toBe('1.0.0');
      expect(result.reloadRecommended).toBe(true);
      expect(result.location).toBe('/path/to/config');
      expect(result.configPath).toBe('/path/to/config');
    });

    it('should handle mcp_uninstall end-to-end', async () => {
      const args = {
        name: 'test-server',
        force: true,
        preserveConfig: false,
        graceful: true,
        backup: false,
        removeAll: false,
      };

      const result = await handleMcpUninstall(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('removed');
      expect(result).toHaveProperty('removedAt');
      expect(result).toHaveProperty('gracefulShutdown');
      expect(result).toHaveProperty('reloadRecommended');

      expect(result.name).toBe('test-server');
      expect(result.status).toBe('success');
      expect(result.removed).toBe(true);
      expect(result.gracefulShutdown).toBe(true);
      expect(result.reloadRecommended).toBe(true);
    });

    it('should handle mcp_update end-to-end', async () => {
      const args = {
        name: 'test-server',
        version: '2.0.0',
        autoRestart: false,
        backup: true,
        force: false,
        dryRun: false,
      };

      const result = await handleMcpUpdate(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('previousVersion');
      expect(result).toHaveProperty('newVersion');
      expect(result).toHaveProperty('updatedAt');
      expect(result).toHaveProperty('reloadRecommended');

      expect(result.name).toBe('test-server');
      expect(result.status).toBe('success');
      expect(result.previousVersion).toBe('1.0.0');
      expect(result.newVersion).toBe('2.0.0');
      expect(result.reloadRecommended).toBe(true);
    });
  });

  describe('Management Handlers Integration', () => {
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
      expect(result.restarted).toBeUndefined();
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
      expect(result.gracefulShutdown).toBeUndefined();
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

      expect(result.target).toBe('all-servers');
      expect(result.action).toBe('config-reload');
      expect(result.status).toBe('success');
      expect(result.timestamp).toBeDefined();
      expect(result.reloadedServers).toEqual(['test-server', 'disabled-server']);
    });
  });
});
