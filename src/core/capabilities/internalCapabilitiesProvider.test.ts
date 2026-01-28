import { vi } from 'vitest';

import { AgentConfigManager } from '../server/agentConfig.js';
import { InternalCapabilitiesProvider } from './internalCapabilitiesProvider.js';

// Mock heavy dependencies to avoid loading them in tests
vi.mock('@src/core/tools/internal/index.js', () => ({
  handleMcpSearch: vi.fn(),
  handleMcpRegistryStatus: vi.fn(),
  handleMcpRegistryInfo: vi.fn(),
  handleMcpRegistryList: vi.fn(),
  handleMcpInfo: vi.fn(),
  handleMcpInstall: vi.fn(),
  handleMcpUninstall: vi.fn(),
  handleMcpUpdate: vi.fn(),
  handleMcpEdit: vi.fn(),
  handleMcpEnable: vi.fn(),
  handleMcpDisable: vi.fn(),
  handleMcpList: vi.fn(),
  handleMcpStatus: vi.fn(),
  handleMcpReload: vi.fn(),
  cleanupInternalToolHandlers: vi.fn(),
}));

// Mock the adapters to avoid loading domain services
vi.mock('@src/core/tools/internal/adapters/index.js', () => ({
  AdapterFactory: {
    getDiscoveryAdapter: vi.fn(() => ({
      searchServers: vi.fn(),
      getServerById: vi.fn(),
      getRegistryStatus: vi.fn(),
    })),
    getInstallationAdapter: vi.fn(() => ({
      installServer: vi.fn(),
      uninstallServer: vi.fn(),
      updateServer: vi.fn(),
    })),
    getManagementAdapter: vi.fn(() => ({
      enableServer: vi.fn(),
      disableServer: vi.fn(),
      listServers: vi.fn(),
      getServerStatus: vi.fn(),
      reloadServer: vi.fn(),
    })),
    cleanup: vi.fn(),
  },
}));

// Mock the tool creation functions
vi.mock('@src/core/capabilities/internal/discoveryTools.js', () => ({
  createSearchTool: vi.fn(() => ({
    name: 'mcp_search',
    description: 'Search for MCP servers in the registry',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for MCP servers' },
        limit: { type: 'number', description: 'Maximum number of results to return', default: 20 },
      },
    },
  })),
  createRegistryStatusTool: vi.fn(() => ({
    name: 'mcp_registry_status',
    description: 'Get registry status',
    inputSchema: {
      type: 'object',
      properties: {
        registry: { type: 'string' },
      },
      required: ['registry'],
    },
  })),
  createRegistryInfoTool: vi.fn(() => ({
    name: 'mcp_registry_info',
    description: 'Get registry info',
    inputSchema: {
      type: 'object',
      properties: {
        registry: { type: 'string' },
      },
      required: ['registry'],
    },
  })),
  createRegistryListTool: vi.fn(() => ({
    name: 'mcp_registry_list',
    description: 'List registries',
    inputSchema: {
      type: 'object',
      properties: {
        includeStats: { type: 'boolean' },
      },
    },
  })),
  createInfoTool: vi.fn(() => ({
    name: 'mcp_info',
    description: 'Get server info',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
  })),
}));

vi.mock('@src/core/capabilities/internal/installationTools.js', () => ({
  createInstallTool: vi.fn(() => ({
    name: 'mcp_install',
    description:
      'Install a new MCP server. Use package+command+args for direct package installation (e.g., npm packages), or just name for registry-based installation',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the MCP server configuration' },
      },
      required: ['name'],
    },
  })),
  createUninstallTool: vi.fn(() => ({
    name: 'mcp_uninstall',
    description: 'Uninstall an MCP server',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
  })),
  createUpdateTool: vi.fn(() => ({
    name: 'mcp_update',
    description: 'Update an MCP server',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
  })),
}));

vi.mock('@src/core/capabilities/internal/managementTools.js', () => ({
  createEnableTool: vi.fn(() => ({
    name: 'mcp_enable',
    description: 'Enable an MCP server',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
  })),
  createDisableTool: vi.fn(() => ({
    name: 'mcp_disable',
    description: 'Disable an MCP server',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
  })),
  createListTool: vi.fn(() => ({
    name: 'mcp_list',
    description: 'List MCP servers',
    inputSchema: { type: 'object', properties: {} },
  })),
  createStatusTool: vi.fn(() => ({
    name: 'mcp_status',
    description: 'Get MCP server status',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
  })),
  createReloadTool: vi.fn(() => ({
    name: 'mcp_reload',
    description: 'Reload MCP server',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
  })),
  createEditTool: vi.fn(() => ({
    name: 'mcp_edit',
    description: 'Edit MCP server configuration',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
  })),
}));

describe('InternalCapabilitiesProvider', () => {
  let capabilitiesProvider: InternalCapabilitiesProvider;
  let configManager: AgentConfigManager;

  // Initialize once before all tests
  beforeAll(async () => {
    capabilitiesProvider = InternalCapabilitiesProvider.getInstance();
    configManager = AgentConfigManager.getInstance();
  });

  beforeEach(async () => {
    // Reset configuration to defaults
    configManager.updateConfig({
      features: {
        auth: false,
        scopeValidation: false,
        enhancedSecurity: false,
        configReload: true,
        envSubstitution: true,
        sessionPersistence: true,
        clientNotifications: true,
        jsonRpcErrorLogging: true,
        internalTools: false,
        internalToolsList: [],
      },
    });

    // Only initialize if not already initialized
    if (!capabilitiesProvider['isInitialized']) {
      await capabilitiesProvider.initialize();
    }
  });

  afterEach(() => {
    // Don't cleanup after each test - reset state instead
    // capabilitiesProvider.cleanup();
  });

  afterAll(() => {
    // Cleanup once after all tests
    capabilitiesProvider.cleanup();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const provider = InternalCapabilitiesProvider.getInstance();
      await expect(provider.initialize()).resolves.not.toThrow();
    });

    it('should not initialize twice', async () => {
      await capabilitiesProvider.initialize();
      await expect(capabilitiesProvider.initialize()).resolves.not.toThrow();
    });

    it('should emit ready event on initialization', async () => {
      // Create fresh instance by calling cleanup first
      const provider = InternalCapabilitiesProvider.getInstance();
      provider.cleanup();

      const readySpy = vi.fn();
      provider.on('ready', readySpy);

      await provider.initialize();
      expect(readySpy).toHaveBeenCalled();
    });
  });

  describe('getAvailableTools', () => {
    it('should return no tools when internal tools are disabled', async () => {
      const tools = capabilitiesProvider.getAvailableTools();
      expect(tools).toHaveLength(0);
    });

    it('should return all tools when internal tools are enabled', async () => {
      // Enable internal tools
      configManager.updateConfig({
        features: {
          auth: false,
          scopeValidation: false,
          enhancedSecurity: false,
          configReload: true,
          envSubstitution: true,
          sessionPersistence: true,
          clientNotifications: true,
          jsonRpcErrorLogging: true,
          internalTools: true,
          internalToolsList: [],
        },
      });

      const tools = capabilitiesProvider.getAvailableTools();
      expect(tools.length).toBeGreaterThan(0);

      // Check for expected tool names
      const toolNames = tools.map((tool) => tool.name);
      expect(toolNames).toContain('mcp_search');
      expect(toolNames).toContain('mcp_registry_status');
      expect(toolNames).toContain('mcp_registry_info');
      expect(toolNames).toContain('mcp_registry_list');
      expect(toolNames).toContain('mcp_info');
      expect(toolNames).toContain('mcp_install');
      expect(toolNames).toContain('mcp_uninstall');
      expect(toolNames).toContain('mcp_update');
      expect(toolNames).toContain('mcp_enable');
      expect(toolNames).toContain('mcp_disable');
      expect(toolNames).toContain('mcp_list');
      expect(toolNames).toContain('mcp_status');
      expect(toolNames).toContain('mcp_reload');
    });

    it('should return tools with proper structure', async () => {
      // Enable internal tools
      configManager.updateConfig({
        features: {
          auth: false,
          scopeValidation: false,
          enhancedSecurity: false,
          configReload: true,
          envSubstitution: true,
          sessionPersistence: true,
          clientNotifications: true,
          jsonRpcErrorLogging: true,
          internalTools: true,
          internalToolsList: [],
        },
      });

      const tools = capabilitiesProvider.getAvailableTools();

      // Check tool structure
      tools.forEach((tool) => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool.inputSchema).toHaveProperty('type', 'object');
        expect(tool.inputSchema).toHaveProperty('properties');
      });
    });

    it('should return empty array when not initialized', () => {
      const provider = InternalCapabilitiesProvider.getInstance();
      // Don't initialize
      const tools = provider.getAvailableTools();
      expect(tools).toHaveLength(0);
    });
  });

  describe('executeTool', () => {
    beforeEach(async () => {
      // Enable internal tools for testing
      configManager.updateConfig({
        features: {
          auth: false,
          scopeValidation: false,
          enhancedSecurity: false,
          configReload: true,
          envSubstitution: true,
          sessionPersistence: true,
          clientNotifications: true,
          jsonRpcErrorLogging: true,
          internalTools: true,
          internalToolsList: [],
        },
      });
    });

    it('should throw error when not initialized', async () => {
      const provider = InternalCapabilitiesProvider.getInstance();
      // Force not initialized state by cleaning up
      provider.cleanup();

      await expect(provider.executeTool('mcp_search', {})).rejects.toThrow(
        'Internal capabilities provider not initialized',
      );
    });

    it('should throw error for unknown tool', async () => {
      await expect(capabilitiesProvider.executeTool('unknown_tool', {})).rejects.toThrow(
        'Unknown internal tool: unknown_tool',
      );
    });

    it('should execute mcp_search tool', async () => {
      const { handleMcpSearch } = await import('@src/core/tools/internal/index.js');
      (handleMcpSearch as any).mockResolvedValue({ results: [] });

      const result = await capabilitiesProvider.executeTool('mcp_search', {
        query: 'test',
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(handleMcpSearch).toHaveBeenCalledWith({
        query: 'test',
        limit: 10,
        status: 'active',
        format: 'table',
      });
    });

    it('should execute mcp_install tool', async () => {
      const { handleMcpInstall } = await import('@src/core/tools/internal/index.js');
      (handleMcpInstall as any).mockResolvedValue({ success: true });

      const result = await capabilitiesProvider.executeTool('mcp_install', {
        name: 'test-server',
        package: 'test-package',
      });

      expect(result).toBeDefined();
      expect(handleMcpInstall).toHaveBeenCalledWith({
        name: 'test-server',
        package: 'test-package',
        transport: 'stdio',
        enabled: true,
        autoRestart: false,
        backup: true,
        force: false,
      });
    });

    it('should validate required parameters for mcp_install', async () => {
      // Test validation by calling with missing required params
      await expect(capabilitiesProvider.executeTool('mcp_install', {})).rejects.toThrow();
    });

    it('should execute mcp_registry_status tool', async () => {
      const { handleMcpRegistryStatus } = await import('@src/core/tools/internal/index.js');
      (handleMcpRegistryStatus as any).mockResolvedValue({
        available: true,
        url: 'https://api.example.com',
        response_time_ms: 100,
        last_updated: '2024-01-01',
      });

      const result = await capabilitiesProvider.executeTool('mcp_registry_status', {
        registry: 'official',
      });

      expect(result).toBeDefined();
      expect(handleMcpRegistryStatus).toHaveBeenCalledWith({
        registry: 'official',
        includeStats: false,
      });
    });

    it('should execute mcp_registry_info tool', async () => {
      const { handleMcpRegistryInfo } = await import('@src/core/tools/internal/index.js');
      (handleMcpRegistryInfo as any).mockResolvedValue({
        name: 'official',
        url: 'https://api.example.com',
      });

      const result = await capabilitiesProvider.executeTool('mcp_registry_info', {
        registry: 'official',
      });

      expect(result).toBeDefined();
      expect(handleMcpRegistryInfo).toHaveBeenCalledWith({
        registry: 'official',
      });
    });

    it('should execute mcp_registry_list tool', async () => {
      const { handleMcpRegistryList } = await import('@src/core/tools/internal/index.js');
      (handleMcpRegistryList as any).mockResolvedValue({
        registries: ['official', 'community'],
      });

      const result = await capabilitiesProvider.executeTool('mcp_registry_list', {
        includeStats: true,
      });

      expect(result).toBeDefined();
      expect(handleMcpRegistryList).toHaveBeenCalledWith({
        includeStats: true,
      });
    });

    it('should execute mcp_info tool', async () => {
      const { handleMcpInfo } = await import('@src/core/tools/internal/index.js');
      (handleMcpInfo as any).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
        description: 'Test server',
      });

      const result = await capabilitiesProvider.executeTool('mcp_info', {
        name: 'test-server',
      });

      expect(result).toBeDefined();
      expect(handleMcpInfo).toHaveBeenCalledWith({
        name: 'test-server',
        format: 'table',
        includeCapabilities: true,
        includeConfig: true,
      });
    });
  });

  describe('tool definitions', () => {
    beforeEach(async () => {
      // Enable internal tools
      configManager.updateConfig({
        features: {
          auth: false,
          scopeValidation: false,
          enhancedSecurity: false,
          configReload: true,
          envSubstitution: true,
          sessionPersistence: true,
          clientNotifications: true,
          jsonRpcErrorLogging: true,
          internalTools: true,
          internalToolsList: [],
        },
      });
    });

    it('should create search tool with correct schema', async () => {
      const tools = capabilitiesProvider.getAvailableTools();
      const searchTool = tools.find((tool) => tool.name === 'mcp_search');

      expect(searchTool).toBeDefined();
      expect(searchTool?.description).toBe('Search for MCP servers in the registry');

      const schema = searchTool!.inputSchema;
      expect(schema.properties?.query).toEqual({
        type: 'string',
        description: 'Search query for MCP servers',
      });
      expect(schema.properties?.limit).toEqual({
        type: 'number',
        description: 'Maximum number of results to return',
        default: 20,
      });
    });

    it('should create install tool with correct schema', async () => {
      const tools = capabilitiesProvider.getAvailableTools();
      const installTool = tools.find((tool) => tool.name === 'mcp_install');

      expect(installTool).toBeDefined();
      expect(installTool?.description).toBe(
        'Install a new MCP server. Use package+command+args for direct package installation (e.g., npm packages), or just name for registry-based installation',
      );

      const schema = installTool!.inputSchema;
      expect(schema.properties?.name).toEqual({
        type: 'string',
        description: 'Name for the MCP server configuration',
      });
      expect(schema.required).toContain('name');
    });

    it('should create management tools with correct schemas', async () => {
      const tools = capabilitiesProvider.getAvailableTools();

      const enableTool = tools.find((tool) => tool.name === 'mcp_enable');
      expect(enableTool?.description).toBe('Enable an MCP server');
      expect((enableTool?.inputSchema.properties?.name as any)?.type).toBe('string');
      expect(enableTool?.inputSchema.required).toContain('name');

      const disableTool = tools.find((tool) => tool.name === 'mcp_disable');
      expect(disableTool?.description).toBe('Disable an MCP server');
      expect((disableTool?.inputSchema.properties?.name as any)?.type).toBe('string');
      expect(disableTool?.inputSchema.required).toContain('name');
    });
  });

  describe('cleanup', () => {
    it('should cleanup without errors', () => {
      expect(() => capabilitiesProvider.cleanup()).not.toThrow();
    });

    it('should remove all event listeners', () => {
      const listenerSpy = vi.spyOn(capabilitiesProvider, 'removeAllListeners');
      capabilitiesProvider.cleanup();
      expect(listenerSpy).toHaveBeenCalled();
    });
  });

  describe('singleton behavior', () => {
    it('should return the same instance', () => {
      const instance1 = InternalCapabilitiesProvider.getInstance();
      const instance2 = InternalCapabilitiesProvider.getInstance();
      expect(instance1).toBe(instance2);
    });
  });
});
