import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createManagementAdapter, type ManagementAdapter } from './index.js';

vi.mock('@src/commands/mcp/utils/mcpServerConfig.js', () => ({
  getAllServers: vi.fn(),
  getServer: vi.fn(),
  setServer: vi.fn(),
  removeServer: vi.fn(),
  reloadMcpConfig: vi.fn(),
  getInstallationMetadata: vi.fn(),
}));

vi.mock('@src/utils/validation/urlDetection.js', () => ({
  getServer1mcpUrl: vi.fn(() => 'http://localhost:3051/mcp'),
  validateServer1mcpUrl: vi.fn(() => ({ isValid: true, error: null })),
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

describe('Management Adapter', () => {
  let adapter: ManagementAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = createManagementAdapter();
  });

  describe('listServers', () => {
    it('should list servers successfully', async () => {
      const mockServers = {
        'test-server': {
          name: 'test-server',
          command: 'node',
          args: ['server.js'],
          disabled: false,
          tags: ['test'],
        },
        'disabled-server': {
          name: 'disabled-server',
          command: 'node',
          args: ['server.js'],
          disabled: true,
          tags: ['test'],
        },
      };

      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getAllServers as any).mockReturnValue(mockServers);

      const result = await adapter.listServers({ status: 'enabled' });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test-server');
      expect(result[0].status).toBe('enabled');
      expect(result[0].transport).toBe('stdio');
    });

    it('should filter by transport type', async () => {
      const mockServers = {
        'http-server': {
          name: 'http-server',
          url: 'http://localhost:3000/mcp',
          disabled: false,
        },
        'sse-server': {
          name: 'sse-server',
          url: 'http://localhost:3001/sse',
          disabled: false,
        },
        'stdio-server': {
          name: 'stdio-server',
          command: 'node',
          args: ['server.js'],
          disabled: false,
        },
      };

      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getAllServers as any).mockReturnValue(mockServers);

      const result = await adapter.listServers({ transport: 'sse' });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('sse-server');
      expect(result[0].transport).toBe('sse');
    });

    it('should handle list errors', async () => {
      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getAllServers as any).mockImplementation(() => {
        throw new Error('List failed');
      });

      await expect(adapter.listServers()).rejects.toThrow('Server listing failed: List failed');
    });
  });

  describe('getServerStatus', () => {
    it('should get server status successfully', async () => {
      const mockServers = {
        'test-server': {
          name: 'test-server',
          command: 'node',
          args: ['server.js'],
          disabled: false,
        },
      };

      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getAllServers as any).mockReturnValue(mockServers);

      const result = await adapter.getServerStatus('test-server');

      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].name).toBe('test-server');
      expect(result.servers[0].status).toBe('enabled');
      expect(result.totalServers).toBe(1);
      expect(result.enabledServers).toBe(1);
      expect(result.disabledServers).toBe(0);
    });

    it('should get all servers status when no name provided', async () => {
      const mockServers = {
        server1: { name: 'server1', disabled: false },
        server2: { name: 'server2', disabled: true },
      };

      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getAllServers as any).mockReturnValue(mockServers);

      const result = await adapter.getServerStatus();

      expect(result.servers).toHaveLength(2);
      expect(result.totalServers).toBe(2);
      expect(result.enabledServers).toBe(1);
      expect(result.disabledServers).toBe(1);
    });

    it('should handle status errors', async () => {
      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getAllServers as any).mockImplementation(() => {
        throw new Error('Status check failed');
      });

      await expect(adapter.getServerStatus()).rejects.toThrow('Server status check failed: Status check failed');
    });
  });

  describe('enableServer', () => {
    it('should enable server successfully', async () => {
      const mockConfig = { name: 'test-server', disabled: true };

      const { getServer, setServer } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getServer as any).mockReturnValue(mockConfig);
      (setServer as any).mockReturnValue(undefined);

      const result = await adapter.enableServer('test-server', { restart: true });

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(result.enabled).toBe(true);
      expect(result.restarted).toBe(true);
      expect(setServer).toHaveBeenCalledWith('test-server', { ...mockConfig, disabled: false });
    });

    it('should handle server not found', async () => {
      const { getServer } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getServer as any).mockReturnValue(null);

      await expect(adapter.enableServer('nonexistent')).rejects.toThrow(
        "Server enable failed: Server 'nonexistent' not found",
      );
    });

    it('should handle already enabled server', async () => {
      const mockConfig = { name: 'test-server', disabled: false };

      const { getServer } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getServer as any).mockReturnValue(mockConfig);

      const result = await adapter.enableServer('test-server');

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('Server was already enabled');
    });

    it('should handle enable errors', async () => {
      const { getServer } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getServer as any).mockImplementation(() => {
        throw new Error('Enable failed');
      });

      await expect(adapter.enableServer('test-server')).rejects.toThrow('Server enable failed: Enable failed');
    });
  });

  describe('disableServer', () => {
    it('should disable server successfully', async () => {
      const mockConfig = { name: 'test-server', disabled: false };

      const { getServer, setServer } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getServer as any).mockReturnValue(mockConfig);
      (setServer as any).mockReturnValue(undefined);

      const result = await adapter.disableServer('test-server', { graceful: true });

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(result.disabled).toBe(true);
      expect(result.gracefulShutdown).toBe(true);
      expect(setServer).toHaveBeenCalledWith('test-server', { ...mockConfig, disabled: true });
    });

    it('should handle server not found', async () => {
      const { getServer } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getServer as any).mockReturnValue(null);

      await expect(adapter.disableServer('nonexistent')).rejects.toThrow(
        "Server disable failed: Server 'nonexistent' not found",
      );
    });

    it('should handle already disabled server', async () => {
      const mockConfig = { name: 'test-server', disabled: true };

      const { getServer } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getServer as any).mockReturnValue(mockConfig);

      const result = await adapter.disableServer('test-server');

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('Server was already disabled');
    });
  });

  describe('reloadConfiguration', () => {
    it('should reload configuration successfully', async () => {
      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getAllServers as any).mockReturnValue({
        server1: { name: 'server1' },
        server2: { name: 'server2' },
      });

      const result = await adapter.reloadConfiguration();

      expect(result.success).toBe(true);
      expect(result.target).toBe('all-servers');
      expect(result.success).toBe(true);
      expect(result.target).toBe('all-servers');
      expect(result.action).toBe('full-reload');
      expect(result.reloadedServers).toEqual(['server1', 'server2']);

      const { reloadMcpConfig } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      expect(reloadMcpConfig).toHaveBeenCalled();
    });

    it('should reload specific server', async () => {
      const result = await adapter.reloadConfiguration({ server: 'test-server' });

      expect(result.success).toBe(true);
      expect(result.target).toBe('test-server');
      expect(result.action).toBe('full-reload');
      expect(result.reloadedServers).toEqual(['test-server']);

      const { reloadMcpConfig } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      expect(reloadMcpConfig).toHaveBeenCalled();
    });

    it('should handle config-only reload', async () => {
      const result = await adapter.reloadConfiguration({ configOnly: true });

      expect(result.action).toBe('config-reload');

      const { reloadMcpConfig } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      expect(reloadMcpConfig).toHaveBeenCalled();
    });

    it('should handle reload errors', async () => {
      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');

      vi.mocked(getAllServers).mockImplementation(() => {
        throw new Error('Reload failed');
      });

      await expect(adapter.reloadConfiguration()).rejects.toThrow('Configuration reload failed: Reload failed');
    });
  });

  describe('updateServerConfig', () => {
    it('should update server config successfully', async () => {
      const mockConfig = { name: 'test-server', command: 'node', args: ['old.js'] };
      const configUpdate = { args: ['new.js'] };

      const { getServer, setServer } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getServer as any).mockReturnValue(mockConfig);
      (setServer as any).mockReturnValue(undefined);

      const result = await adapter.updateServerConfig('test-server', configUpdate);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(result.previousConfig).toEqual(mockConfig);
      expect(result.newConfig).toEqual({ ...mockConfig, ...configUpdate });
      expect(result.updated).toBe(true);
      expect(setServer).toHaveBeenCalledWith('test-server', { ...mockConfig, ...configUpdate });
    });

    it('should handle server not found', async () => {
      const { getServer } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getServer as any).mockReturnValue(null);

      await expect(adapter.updateServerConfig('nonexistent', {})).rejects.toThrow(
        "Server config update failed: Server 'nonexistent' not found",
      );
    });

    it('should handle config update errors', async () => {
      const { getServer } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      (getServer as any).mockImplementation(() => {
        throw new Error('Update failed');
      });

      await expect(adapter.updateServerConfig('test-server', {})).rejects.toThrow(
        'Server config update failed: Update failed',
      );
    });
  });

  describe('validateServerConfig', () => {
    it('should validate server config successfully', async () => {
      // Ensure getAllServers returns a valid object
      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      vi.mocked(getAllServers).mockReturnValue({});

      const config = { command: 'node', args: ['server.js'] };

      const { validateServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (validateServer1mcpUrl as any).mockReturnValue({ isValid: true, error: null });

      const result = await adapter.validateServerConfig('test-server', config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing command and URL', async () => {
      const config = {};

      // Ensure getAllServers returns a valid object
      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      vi.mocked(getAllServers).mockReturnValue({});

      const result = await adapter.validateServerConfig('test-server', config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Server must have either a command or URL');
    });

    it('should validate URLs', async () => {
      // Ensure getAllServers returns a valid object
      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      vi.mocked(getAllServers).mockReturnValue({});

      const config = { url: 'https://invalid-url.com' };

      const { validateServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (validateServer1mcpUrl as any).mockReturnValue({ isValid: false, error: 'Invalid URL format' });

      const result = await adapter.validateServerConfig('test-server', config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid URL: Invalid URL format');
    });

    it('should validate tags', async () => {
      // Ensure getAllServers returns a valid object
      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      vi.mocked(getAllServers).mockReturnValue({});

      const config = { command: 'node', tags: ['invalid-tag!'] };

      const { validateServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (validateServer1mcpUrl as any).mockReturnValue({ isValid: true, error: null });

      const result = await adapter.validateServerConfig('test-server', config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('Invalid tags'))).toBe(true);
    });

    it('should provide warnings for both command and URL', async () => {
      // Ensure getAllServers returns a valid object
      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      vi.mocked(getAllServers).mockReturnValue({});

      const config = { command: 'node', url: 'http://localhost:3000/mcp' };

      const { validateServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (validateServer1mcpUrl as any).mockReturnValue({ isValid: true, error: null });

      const result = await adapter.validateServerConfig('test-server', config);

      expect(result.warnings).toContain('Both command and URL specified - URL will take precedence');
    });

    it('should provide suggestions for stdio transport', async () => {
      // Ensure getAllServers returns a valid object
      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      vi.mocked(getAllServers).mockReturnValue({});

      const config = { command: 'node', args: ['server.js'] };

      const { validateServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (validateServer1mcpUrl as any).mockReturnValue({ isValid: true, error: null });

      const result = await adapter.validateServerConfig('test-server', config);

      expect(result.suggestions).toContain('Consider using URL-based transport for better compatibility');
    });

    it('should handle validation errors', async () => {
      // Ensure getAllServers returns a valid object
      const { getAllServers } = await import('@src/commands/mcp/utils/mcpServerConfig.js');
      vi.mocked(getAllServers).mockReturnValue({});

      const { validateServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');

      // Mock to throw an error - this gets caught and adds "Invalid URL format"
      vi.mocked(validateServer1mcpUrl).mockImplementation(() => {
        throw new Error('Validation error');
      });

      // Provide a config with a valid URL format to trigger URL validation
      const result = await adapter.validateServerConfig('test-server', {
        command: 'node',
        url: 'https://example.com',
      });

      expect(result.valid).toBe(false);
      // The error from validateServer1mcpUrl gets caught and results in "Invalid URL format"
      expect(result.errors).toContain('Invalid URL format');
    });
  });

  describe('getServerUrl', () => {
    it('should get server URL successfully', async () => {
      const { getServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (getServer1mcpUrl as any).mockReturnValue('http://localhost:3051/mcp');

      const result = await adapter.getServerUrl();

      expect(result).toBe('http://localhost:3051/mcp');
    });

    it('should handle URL errors', async () => {
      const { getServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (getServer1mcpUrl as any).mockImplementation(() => {
        throw new Error('URL error');
      });

      await expect(adapter.getServerUrl()).rejects.toThrow('Failed to get server URL: URL error');
    });
  });
});
