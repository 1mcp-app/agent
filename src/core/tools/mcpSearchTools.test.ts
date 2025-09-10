import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSearchToolsInfo, registerSearchTools } from './mcpSearchTools.js';

// Mock the Server class
const mockServer = {
  setRequestHandler: vi.fn(),
};

describe('mcpSearchTools', () => {
  beforeEach(() => {
    mockServer.setRequestHandler.mockReset();
  });

  describe('getSearchToolsInfo', () => {
    it('should return correct tool information', () => {
      const info = getSearchToolsInfo();

      expect(info.count).toBe(2);
      expect(info.tools).toHaveLength(2);

      const toolNames = info.tools.map((tool) => tool.name);
      expect(toolNames).toContain('search_mcp_servers');
      expect(toolNames).toContain('get_registry_status');
    });

    it('should have proper tool schemas', () => {
      const info = getSearchToolsInfo();

      const searchTool = info.tools.find((tool) => tool.name === 'search_mcp_servers');
      expect(searchTool).toBeDefined();
      expect(searchTool?.description).toContain('Search for MCP servers');
      expect(searchTool?.inputSchema).toBeDefined();

      const statusTool = info.tools.find((tool) => tool.name === 'get_registry_status');
      expect(statusTool).toBeDefined();
      expect(statusTool?.description).toContain('MCP Registry availability status');
      expect(statusTool?.inputSchema).toBeDefined();
    });
  });

  describe('registerSearchTools', () => {
    it('should register both list and call handlers', () => {
      registerSearchTools(mockServer as any);

      expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(2);

      // Should register ListToolsRequestSchema and CallToolRequestSchema handlers
      const handlerTypes = mockServer.setRequestHandler.mock.calls.map((call) => call[0]);
      expect(handlerTypes).toHaveLength(2);
    });

    it('should register handlers without errors', () => {
      expect(() => {
        registerSearchTools(mockServer as any);
      }).not.toThrow();
    });
  });
});
