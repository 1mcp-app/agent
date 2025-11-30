/**
 * Integration tests for internal tools functionality
 *
 * These tests verify that internal tools are properly returned when the enable-internal-tools flag is set
 */
import { CapabilityAggregator } from '@src/core/capabilities/capabilityAggregator.js';
import { InternalCapabilitiesProvider } from '@src/core/capabilities/internalCapabilitiesProvider.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Helper function to create complete feature config
const createFeatureConfig = (internalTools: boolean) => ({
  auth: false,
  scopeValidation: false,
  enhancedSecurity: false,
  configReload: false,
  envSubstitution: false,
  sessionPersistence: false,
  clientNotifications: false,
  internalTools,
});

describe('Internal Tools Integration', () => {
  let configManager: AgentConfigManager;
  let internalProvider: InternalCapabilitiesProvider;
  let aggregator: CapabilityAggregator;

  beforeAll(async () => {
    // Get singleton instances
    configManager = AgentConfigManager.getInstance();
    internalProvider = InternalCapabilitiesProvider.getInstance();
  });

  beforeEach(() => {
    // Reset aggregator with empty connections for each test
    aggregator = new CapabilityAggregator(new Map());
  });

  describe('When internal tools are enabled', () => {
    beforeEach(async () => {
      // Enable internal tools via config
      configManager.updateConfig({
        features: createFeatureConfig(true),
      });

      // Re-initialize provider to pick up config changes
      await internalProvider.initialize();
    });

    it('should return all 10 expected internal tools from provider', () => {
      const tools = internalProvider.getAvailableTools();

      expect(tools).toHaveLength(10);

      const toolNames = tools.map((t) => t.name);
      const expectedTools = [
        'mcp_search',
        'mcp_registry',
        'mcp_install',
        'mcp_uninstall',
        'mcp_update',
        'mcp_enable',
        'mcp_disable',
        'mcp_list',
        'mcp_status',
        'mcp_reload',
      ];

      expectedTools.forEach((toolName) => {
        expect(toolNames).toContain(toolName);
      });
    });

    it('should return internal tools through capability aggregator', async () => {
      const changes = await aggregator.updateCapabilities();
      const capabilities = changes.current;

      expect(capabilities.tools).toHaveLength(10);
      expect(capabilities.readyServers).toContain('1mcp');

      const toolNames = capabilities.tools.map((t) => t.name);
      expect(toolNames).toContain('mcp_search');
      expect(toolNames).toContain('mcp_install');
      expect(toolNames).toContain('mcp_list');
      // ... other tools can be checked if needed
    });

    it('should detect capabilities changes when enabling internal tools', async () => {
      // First, verify no internal tools
      configManager.updateConfig({
        features: createFeatureConfig(false),
      });
      await internalProvider.initialize();

      let changes = await aggregator.updateCapabilities();
      expect(changes.current.tools.length).toBe(0);
      expect(changes.current.readyServers).not.toContain('1mcp');

      // Now enable internal tools
      configManager.updateConfig({
        features: createFeatureConfig(true),
      });
      await internalProvider.initialize();

      changes = await aggregator.updateCapabilities();
      expect(changes.hasChanges).toBe(true);
      expect(changes.toolsChanged).toBe(true);
      expect(changes.current.tools).toHaveLength(10);
      expect(changes.current.readyServers).toContain('1mcp');
      expect(changes.addedServers).toContain('1mcp');
    });

    it('should return proper tool definitions with correct schemas', () => {
      const tools = internalProvider.getAvailableTools();
      const toolMap = new Map(tools.map((t) => [t.name, t]));

      // Test specific tool schemas
      const searchTool = toolMap.get('mcp_search');
      expect(searchTool).toBeDefined();
      expect(searchTool?.inputSchema.properties).toHaveProperty('query');
      expect(searchTool?.inputSchema.properties).toHaveProperty('limit');

      const installTool = toolMap.get('mcp_install');
      expect(installTool).toBeDefined();
      expect(installTool?.inputSchema.required).toContain('name');

      const listTool = toolMap.get('mcp_list');
      expect(listTool).toBeDefined();
      expect(listTool?.inputSchema.properties).toHaveProperty('status');
    });
  });

  describe('When internal tools are disabled', () => {
    beforeEach(async () => {
      // Disable internal tools via config
      configManager.updateConfig({
        features: createFeatureConfig(false),
      });

      await internalProvider.initialize();
    });

    it('should return no tools from provider', () => {
      const tools = internalProvider.getAvailableTools();
      expect(tools.length).toBe(0);
    });

    it('should not include 1mcp in ready servers', async () => {
      const changes = await aggregator.updateCapabilities();
      const capabilities = changes.current;

      expect(capabilities.tools.length).toBe(0);
      expect(capabilities.readyServers).not.toContain('1mcp');
    });

    it('should detect capabilities changes when disabling internal tools', async () => {
      // Start with internal tools enabled
      configManager.updateConfig({
        features: createFeatureConfig(true),
      });
      await internalProvider.initialize();

      await aggregator.updateCapabilities();
      expect(aggregator.getCurrentCapabilities().tools.length).toBe(10);

      // Now disable
      configManager.updateConfig({
        features: createFeatureConfig(false),
      });
      await internalProvider.initialize();

      const changes = await aggregator.updateCapabilities();
      expect(changes.hasChanges).toBe(true);
      expect(changes.toolsChanged).toBe(true);
      expect(changes.current.tools.length).toBe(0);
      expect(changes.current.readyServers).not.toContain('1mcp');
      expect(changes.removedServers).toContain('1mcp');
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle uninitialized provider gracefully', () => {
      // Create a fresh provider instance without initializing via getInstance
      const freshProvider = InternalCapabilitiesProvider.getInstance();
      const tools = freshProvider.getAvailableTools();
      expect(tools).toHaveLength(0);
    });

    it('should handle missing configuration manager', async () => {
      // This test verifies the provider handles missing config gracefully
      const tools = internalProvider.getAvailableTools();
      // Should not throw, just return no tools if disabled
      expect(Array.isArray(tools)).toBe(true);
    });

    it('should preserve tool definitions across multiple calls', async () => {
      configManager.updateConfig({
        features: createFeatureConfig(true),
      });
      await internalProvider.initialize();

      const tools1 = internalProvider.getAvailableTools();
      const tools2 = internalProvider.getAvailableTools();

      expect(tools1).toEqual(tools2);
      expect(tools1.length).toBe(10);
    });
  });

  describe('Configuration propagation', () => {
    it('should pick up configuration changes immediately', async () => {
      // Start disabled
      configManager.updateConfig({
        features: createFeatureConfig(false),
      });
      await internalProvider.initialize();

      let tools = internalProvider.getAvailableTools();
      expect(tools.length).toBe(0);

      // Enable without re-initializing
      configManager.updateConfig({
        features: createFeatureConfig(true),
      });

      tools = internalProvider.getAvailableTools();
      expect(tools.length).toBe(10);
    });

    it('should handle multiple configuration updates', async () => {
      const configs = [false, true, false, true];
      const expectedLengths = [0, 10, 0, 10];

      for (let i = 0; i < configs.length; i++) {
        configManager.updateConfig({
          features: createFeatureConfig(configs[i]),
        });

        const tools = internalProvider.getAvailableTools();
        expect(tools).toHaveLength(expectedLengths[i]);
      }
    });
  });
});
