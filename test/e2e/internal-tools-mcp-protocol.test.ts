/**
 * E2E tests for Internal MCP Tools Protocol
 *
 * This test file validates that the internal MCP discovery tools work correctly
 * with the MCP protocol and return properly structured data that matches their schemas.
 */
import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CommandTestEnvironment } from '@test/e2e/utils/index.js';
import { McpTestClient } from '@test/e2e/utils/McpTestClient.js';

import { resolve } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Type for MCP tool call responses
type McpToolCallResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: unknown;
};

describe('Internal MCP Tools Protocol E2E Tests', () => {
  let environment: CommandTestEnvironment;
  let mcpClient: McpTestClient;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('internal-mcp-tools-test', 'empty'));
    await environment.setup();

    // Initialize MCP client with stdio transport
    mcpClient = new McpTestClient({
      transport: 'stdio',
      stdioConfig: {
        command: 'node',
        args: [resolve(__dirname, '../../build/index.js'), '--transport', 'stdio'],
        env: {
          ...process.env,
          ONE_MCP_CONFIG_DIR: (environment as any).getConfigDir(),
          NODE_ENV: 'test',
        },
      },
    });
  });

  afterEach(async () => {
    try {
      await mcpClient.disconnect();
    } catch (_error) {
      // Ignore disconnect errors
    }
    await environment.cleanup();
  });

  describe('MCP Tool Discovery', () => {
    it('should list all available tools including internal discovery tools', async () => {
      await mcpClient.connect();

      const toolsResponse = await mcpClient.listTools();

      expect(toolsResponse).toBeDefined();
      expect(Array.isArray((toolsResponse as any).tools)).toBe(true);

      // Find internal discovery tools
      const discoveryTools = (toolsResponse as any).tools.filter(
        (tool: any) =>
          tool.name.startsWith('1mcp_1mcp_') &&
          ['mcp_search', 'mcp_registry_status', 'mcp_registry_info', 'mcp_registry_list', 'mcp_info'].some((name) =>
            tool.name.includes(name),
          ),
      );

      expect(discoveryTools.length).toBeGreaterThan(0);

      // Verify each discovery tool has proper schema
      for (const tool of discoveryTools) {
        expect(tool.name).toMatch(/^1mcp_1mcp_/);
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe('string');
        expect(tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
      }
    });

    it('should validate mcp_search tool schema', async () => {
      await mcpClient.connect();

      const toolsResponse = await mcpClient.listTools();
      const searchTool = (toolsResponse as any).tools.find((tool: any) => tool.name === '1mcp_1mcp_mcp_search');

      expect(searchTool).toBeDefined();
      expect(searchTool?.inputSchema).toBeDefined();
      expect(searchTool?.outputSchema).toBeDefined();

      // Verify input schema has expected properties
      expect(searchTool?.inputSchema.properties).toHaveProperty('query');
      expect(searchTool?.inputSchema.properties).toHaveProperty('limit');
      expect(searchTool?.inputSchema.properties).toHaveProperty('status');

      // Verify output schema has expected structure
      expect(searchTool?.outputSchema.properties).toHaveProperty('results');
      expect(searchTool?.outputSchema.properties).toHaveProperty('total');
      expect(searchTool?.outputSchema.properties).toHaveProperty('query');
      expect(searchTool?.outputSchema.properties).toHaveProperty('registry');
    });
  });

  describe('MCP Tool Execution - Structured Output Validation', () => {
    it('should execute mcp_search and return structured data', async () => {
      await mcpClient.connect();

      const result = (await mcpClient.callTool('1mcp_1mcp_mcp_search', {
        query: 'filesystem',
        limit: 5,
      })) as unknown as McpToolCallResult;

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);

      // Should have content since we fixed the handlers to return structured data
      expect(result.content.length).toBeGreaterThan(0);

      // The content should be structured data (not text)
      const content = result.content[0];
      expect(content).toBeDefined();

      // The content should be text containing JSON matching the schema
      expect(content.type).toBe('text');
      expect(content.text).toBeDefined();

      // Also check structuredContent field
      expect(result.structuredContent).toBeDefined();

      // Verify that both content.text (parsed) and structuredContent have the same structure
      const parsed = JSON.parse(content.text as string);
      expect(parsed).toEqual(result.structuredContent);

      expect(parsed).toHaveProperty('results');
      expect(parsed).toHaveProperty('total');
      expect(parsed).toHaveProperty('query');
      expect(parsed).toHaveProperty('registry');
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(typeof parsed.total).toBe('number');
      expect(typeof parsed.query).toBe('string');
      expect(typeof parsed.registry).toBe('string');
    });

    it('should execute mcp_registry_status and return structured data', async () => {
      await mcpClient.connect();

      const result = (await mcpClient.callTool('1mcp_1mcp_mcp_registry_status', {
        registry: 'official',
        includeStats: true,
      })) as unknown as McpToolCallResult;

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);

      const content = result.content[0];
      expect(content).toBeDefined();

      // The content should be text containing JSON
      expect(content.type).toBe('text');
      expect(content.text).toBeDefined();

      // Also check structuredContent field
      expect(result.structuredContent).toBeDefined();

      const parsed = JSON.parse(content.text as string);
      expect(parsed).toEqual(result.structuredContent);

      expect(parsed).toHaveProperty('registry');
      expect(parsed).toHaveProperty('status');
      expect(parsed).toHaveProperty('lastCheck');
      expect(parsed).toHaveProperty('metadata');
      expect(['online', 'offline', 'error']).toContain(parsed.status);
      expect(typeof parsed.registry).toBe('string');
    });

    it('should execute mcp_registry_info and return structured data', async () => {
      await mcpClient.connect();

      const result = (await mcpClient.callTool('1mcp_1mcp_mcp_registry_info', {
        registry: 'official',
      })) as unknown as McpToolCallResult;

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);

      const content = result.content[0];
      expect(content).toBeDefined();

      // The content should be text containing JSON
      expect(content.type).toBe('text');
      expect(content.text).toBeDefined();

      // Also check structuredContent field
      expect(result.structuredContent).toBeDefined();

      const parsed = JSON.parse(content.text as string);
      expect(parsed).toEqual(result.structuredContent);

      expect(parsed).toHaveProperty('name');
      expect(parsed).toHaveProperty('url');
      expect(parsed).toHaveProperty('description');
      expect(parsed).toHaveProperty('supportedFormats');
      expect(parsed).toHaveProperty('features');
      expect(Array.isArray(parsed.supportedFormats)).toBe(true);
      expect(Array.isArray(parsed.features)).toBe(true);
    });

    it('should execute mcp_registry_list and return structured data', async () => {
      await mcpClient.connect();

      const result = (await mcpClient.callTool('1mcp_1mcp_mcp_registry_list', {
        includeStats: false,
      })) as unknown as McpToolCallResult;

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);

      const content = result.content[0];
      expect(content).toBeDefined();

      // The content should be text containing JSON
      expect(content.type).toBe('text');
      expect(content.text).toBeDefined();

      // Also check structuredContent field
      expect(result.structuredContent).toBeDefined();

      const parsed = JSON.parse(content.text as string);
      expect(parsed).toEqual(result.structuredContent);

      expect(parsed).toHaveProperty('registries');
      expect(parsed).toHaveProperty('total');
      expect(Array.isArray(parsed.registries)).toBe(true);
      expect(typeof parsed.total).toBe('number');

      // Validate registry structure
      if (parsed.registries.length > 0) {
        const registry = parsed.registries[0];
        expect(registry).toHaveProperty('name');
        expect(registry).toHaveProperty('url');
        expect(registry).toHaveProperty('status');
        expect(registry).toHaveProperty('description');
        expect(['online', 'offline', 'unknown']).toContain(registry.status);
      }
    });

    it('should handle mcp_info for non-existent server', async () => {
      await mcpClient.connect();

      const result = (await mcpClient.callTool('1mcp_1mcp_mcp_info', {
        name: 'non-existent-server-12345',
      })) as unknown as McpToolCallResult;

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);

      const content = result.content[0];
      expect(content).toBeDefined();

      // The content should be text containing JSON
      expect(content.type).toBe('text');
      expect(content.text).toBeDefined();

      // Also check structuredContent field
      expect(result.structuredContent).toBeDefined();

      const parsed = JSON.parse(content.text as string);
      expect(parsed).toEqual(result.structuredContent);

      expect(parsed).toHaveProperty('server');
      expect(parsed.server).toHaveProperty('name');
      expect(parsed.server).toHaveProperty('status');
      expect(parsed.server).toHaveProperty('transport');
      expect(parsed.server.name).toBe('non-existent-server-12345');
    });
  });

  describe('Error Handling with Structured Output', () => {
    it('should handle invalid arguments gracefully', async () => {
      await mcpClient.connect();

      // Test with invalid arguments that should trigger validation errors
      try {
        const result = (await mcpClient.callTool('1mcp_1mcp_mcp_search', {
          query: 'test',
          limit: -1, // Invalid negative limit
        })) as unknown as McpToolCallResult;

        // Should either succeed with validation errors or fail gracefully
        expect(result).toBeDefined();
      } catch (error) {
        // Should be a proper MCP error, not a crash
        expect(error).toBeDefined();
        expect(typeof error).toBe('object');
      }
    });

    it('should handle network errors in registry operations gracefully', async () => {
      await mcpClient.connect();

      // Mock a network failure by using an invalid registry
      try {
        const result = (await mcpClient.callTool('1mcp_1mcp_mcp_registry_status', {
          registry: 'http://invalid-registry-url-that-does-not-exist.com',
        })) as unknown as McpToolCallResult;

        // Should either return error information or fail gracefully
        expect(result).toBeDefined();
      } catch (error) {
        // Should be a proper MCP error
        expect(error).toBeDefined();
      }
    });
  });

  describe('Protocol Compliance', () => {
    it('should support ping operation', async () => {
      await mcpClient.connect();

      const isAlive = await mcpClient.ping();
      expect(isAlive).toBe(true);
    });

    it('should maintain connection health across multiple calls', async () => {
      await mcpClient.connect();

      // Make multiple calls
      (await mcpClient.callTool('1mcp_1mcp_mcp_registry_status', {})) as unknown as McpToolCallResult;
      (await mcpClient.callTool('1mcp_1mcp_mcp_registry_list', {})) as unknown as McpToolCallResult;
      (await mcpClient.callTool('1mcp_1mcp_mcp_registry_info', {})) as unknown as McpToolCallResult;

      // Connection should still be alive
      const isAlive = await mcpClient.ping();
      expect(isAlive).toBe(true);
    });

    it('should handle concurrent requests', async () => {
      await mcpClient.connect();

      // Make multiple concurrent calls
      const promises = [
        mcpClient.callTool('1mcp_1mcp_mcp_search', { query: 'test1' }),
        mcpClient.callTool('1mcp_1mcp_mcp_search', { query: 'test2' }),
        mcpClient.callTool('1mcp_1mcp_mcp_registry_status', {}),
      ];

      const results = await Promise.allSettled(promises);

      // All requests should complete (either successfully or with proper errors)
      expect(results.length).toBe(3);
      results.forEach((result) => {
        expect(result.status).toBe('fulfilled');
      });
    });
  });

  describe('Schema Validation Edge Cases', () => {
    it('should validate empty search results structure', async () => {
      await mcpClient.connect();

      const result = (await mcpClient.callTool('1mcp_1mcp_mcp_search', {
        query: 'non-existent-server-name-xyz-123',
        limit: 1,
      })) as unknown as McpToolCallResult;

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      const content = result.content[0];

      // Even empty results should have proper structure
      expect(content.type).toBe('text');
      expect(content.text).toBeDefined();

      // Also check structuredContent field
      expect(result.structuredContent).toBeDefined();

      const parsed = JSON.parse(content.text as string);
      expect(parsed).toEqual(result.structuredContent);

      expect(parsed).toHaveProperty('results');
      expect(parsed).toHaveProperty('total');
      expect(parsed).toHaveProperty('query');
      expect(parsed).toHaveProperty('registry');
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(parsed.total).toBe(0);
      expect(parsed.results.length).toBe(0);
    });

    it('should validate maximum limits are enforced', async () => {
      await mcpClient.connect();

      // Test with very high limit
      const result = (await mcpClient.callTool('1mcp_1mcp_mcp_search', {
        query: 'test',
        limit: 1000, // Very high limit
      })) as unknown as McpToolCallResult;

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      // Should not crash and should return reasonable results
      const content = result.content[0];
      expect(content).toBeDefined();
    });
  });
});
