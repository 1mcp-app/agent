import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';

import { ConfigBuilder } from './ConfigBuilder.js';

export interface TestEnvironmentConfig {
  name: string;
  createConfigFile?: boolean;
  mockApps?: MockApp[];
  mockMcpServers?: MockMcpServer[];
  mockMcpTemplates?: MockMcpServer[];
  mockRegistry?: boolean;
  envOverrides?: Record<string, string>;
}

export interface MockApp {
  name: string;
  path: string;
  type: 'vs-code' | 'cursor' | 'claude-desktop' | 'generic';
  settings?: Record<string, any>;
}

export interface MockMcpServer {
  name: string;
  command: string;
  args?: string[];
  tags?: string[];
  disabled?: boolean;
  type?: 'stdio' | 'http' | 'sse';
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

/**
 * Provides isolated test environments for CLI command testing.
 * Each environment gets its own temporary directory structure with
 * mock configs, apps, and MCP servers to prevent interference with real app.
 */
export class CommandTestEnvironment {
  private tempDir: string | null = null;
  private configPath: string | null = null;
  private registryUrl: string | null = null;
  private cleanupHandlers: Array<() => Promise<void>> = [];

  constructor(private config: TestEnvironmentConfig) {}

  /**
   * Initialize the test environment with temporary directories and mock data
   */
  async setup(): Promise<void> {
    // Create temporary directories under build/.tmp to avoid touching user-global state or worktree symlinks.
    const sandboxRoot = join(process.cwd(), 'build', '.tmp', 'e2e');
    await mkdir(sandboxRoot, { recursive: true });
    this.tempDir = await mkdtemp(join(sandboxRoot, `${this.config.name}-`));

    // Create subdirectories
    await mkdir(join(this.tempDir, 'config'), { recursive: true });
    await mkdir(join(this.tempDir, 'apps'), { recursive: true });
    await mkdir(join(this.tempDir, 'backups'), { recursive: true });
    await mkdir(join(this.tempDir, 'logs'), { recursive: true });

    // Remove any existing preset file to ensure clean test state
    const presetFile = join(this.getConfigDir(), 'presets.json');
    try {
      await rm(presetFile, { force: true });
    } catch {
      // Ignore errors if file doesn't exist
    }

    // Create mock config file if requested
    if (this.config.createConfigFile) {
      await this.createMockConfigFile();
    }

    // Create mock applications
    if (this.config.mockApps) {
      await this.createMockApps();
    }

    if (this.config.mockRegistry) {
      await this.startMockRegistry();
    }
  }

  /**
   * Get environment variables that should be set for command execution
   */
  getEnvironmentVariables(): Record<string, string> {
    const baseEnv: Record<string, string> = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error', // Minimize logging during tests
      ONE_MCP_LOG_LEVEL: 'error', // Force error-level logging for 1MCP
      ONE_MCP_CONFIG_DIR: this.getConfigDir(),
      // Use different prefixes to avoid conflicts with yargs .env('ONE_MCP')
      TEST_BACKUP_DIR: this.getBackupDir(),
      TEST_LOG_DIR: this.getLogDir(),
      TEST_MODE: 'true',
      // Prevent real app discovery
      TEST_DISABLE_AUTO_DISCOVERY: 'true',
      ...this.config.envOverrides,
    };

    if (this.configPath) {
      baseEnv.ONE_MCP_CONFIG = this.configPath;
    }

    if (this.registryUrl) {
      baseEnv.ONE_MCP_REGISTRY_URL = this.registryUrl;
    }

    return baseEnv;
  }

  /**
   * Get mock registry URL when the test scenario enables one.
   */
  getRegistryUrl(): string | undefined {
    return this.registryUrl || undefined;
  }

  /**
   * Get the path to the test config file
   */
  getConfigPath(): string {
    if (!this.configPath) {
      throw new Error('Config file not created. Call setup() first or enable createConfigFile.');
    }
    return this.configPath;
  }

  /**
   * Get the temporary directory path
   */
  getTempDir(): string {
    if (!this.tempDir) {
      throw new Error('Environment not set up. Call setup() first.');
    }
    return this.tempDir;
  }

  /**
   * Get config directory path
   */
  getConfigDir(): string {
    return join(this.getTempDir(), 'config');
  }

  /**
   * Get backup directory path
   */
  getBackupDir(): string {
    return join(this.getTempDir(), 'backups');
  }

  /**
   * Get log directory path
   */
  getLogDir(): string {
    return join(this.getTempDir(), 'logs');
  }

  /**
   * Get apps directory path
   */
  getAppsDir(): string {
    return join(this.getTempDir(), 'apps');
  }

  /**
   * Update the mock config file with new servers or settings
   */
  async updateConfig(updates: {
    servers?: MockMcpServer[];
    addServers?: boolean; // If true, add to existing servers instead of replacing
  }): Promise<void> {
    if (!this.configPath) {
      throw new Error('Config file not created. Call setup() first.');
    }

    let currentServers = this.config.mockMcpServers || [];

    if (updates.servers) {
      if (updates.addServers) {
        currentServers = [...currentServers, ...updates.servers];
      } else {
        currentServers = updates.servers;
      }
    }

    // Rebuild config with updated servers
    const configBuilder = new ConfigBuilder();
    configBuilder.enableStdioTransport();

    currentServers.forEach((server) => {
      if (server.disabled) {
        configBuilder.disableServer(server.name);
      }

      if (server.type === 'http' && server.url) {
        configBuilder.addHttpServer(server.name, server.url, server.tags);
      } else {
        configBuilder.addStdioServer(server.name, server.command, server.args, server.tags);
      }
    });

    const config = configBuilder.build();
    await writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Add a cleanup handler to be called during teardown
   */
  addCleanupHandler(handler: () => Promise<void>): void {
    this.cleanupHandlers.push(handler);
  }

  /**
   * Clean up all test resources
   */
  async cleanup(): Promise<void> {
    // Run custom cleanup handlers first
    await Promise.allSettled(this.cleanupHandlers.map((handler) => handler()));
    this.cleanupHandlers = [];

    // Remove temporary directory
    if (this.tempDir) {
      try {
        await rm(this.tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Failed to clean up temp directory ${this.tempDir}:`, error);
      }
      this.tempDir = null;
    }

    this.configPath = null;
    this.registryUrl = null;
  }

  /**
   * Create a mock MCP configuration file
   */
  private async createMockConfigFile(): Promise<void> {
    const configBuilder = new ConfigBuilder();
    configBuilder.enableStdioTransport();

    // Add mock MCP servers if provided
    if (this.config.mockMcpServers) {
      this.config.mockMcpServers.forEach((server) => {
        if (server.disabled) {
          configBuilder.disableServer(server.name);
        }

        if (server.type === 'http' && server.url) {
          configBuilder.addHttpServer(server.name, server.url, server.tags);
        } else {
          configBuilder.addStdioServer(server.name, server.command, server.args, server.tags);
        }
      });
    }

    const config = configBuilder.build();
    if (this.config.mockMcpTemplates?.length) {
      const mcpTemplates: Record<string, Record<string, unknown>> = {};
      this.config.mockMcpTemplates.forEach((server) => {
        const templateConfig: Record<string, unknown> = {
          type: server.type || 'stdio',
          command: server.command,
        };

        if (server.args) templateConfig.args = server.args;
        if (server.tags) templateConfig.tags = server.tags;
        if (server.disabled) templateConfig.disabled = server.disabled;
        if (server.env) templateConfig.env = server.env;
        if (server.headers) templateConfig.headers = server.headers;
        if (server.type === 'http' && server.url) templateConfig.url = server.url;

        mcpTemplates[server.name] = templateConfig;
      });
      config.mcpTemplates = mcpTemplates;
    }
    this.configPath = join(this.getConfigDir(), 'mcp.json');
    await writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Create mock application files and settings
   */
  private async createMockApps(): Promise<void> {
    if (!this.config.mockApps) return;

    for (const app of this.config.mockApps) {
      const appDir = join(this.getAppsDir(), app.name);
      await mkdir(appDir, { recursive: true });

      // Create app-specific mock files based on type
      switch (app.type) {
        case 'vs-code':
          await this.createVSCodeMockFiles(appDir, app);
          break;
        case 'cursor':
          await this.createCursorMockFiles(appDir, app);
          break;
        case 'claude-desktop':
          await this.createClaudeDesktopMockFiles(appDir, app);
          break;
        default:
          await this.createGenericMockFiles(appDir, app);
      }
    }
  }

  private async createVSCodeMockFiles(appDir: string, app: MockApp): Promise<void> {
    const settingsDir = join(appDir, 'User');
    await mkdir(settingsDir, { recursive: true });

    const settings = {
      'mcp.servers': {},
      ...app.settings,
    };

    await writeFile(join(settingsDir, 'settings.json'), JSON.stringify(settings, null, 2));
  }

  private async createCursorMockFiles(appDir: string, app: MockApp): Promise<void> {
    // Cursor uses similar structure to VS Code
    await this.createVSCodeMockFiles(appDir, app);
  }

  private async createClaudeDesktopMockFiles(appDir: string, app: MockApp): Promise<void> {
    const config = {
      mcpServers: {},
      ...app.settings,
    };

    await writeFile(join(appDir, 'claude_desktop_config.json'), JSON.stringify(config, null, 2));
  }

  private async createGenericMockFiles(appDir: string, app: MockApp): Promise<void> {
    if (app.settings) {
      await writeFile(join(appDir, 'config.json'), JSON.stringify(app.settings, null, 2));
    }
  }

  private async startMockRegistry(): Promise<void> {
    const server = createServer((req, res) => {
      this.handleMockRegistryRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start mock registry server');
    }

    this.registryUrl = `http://127.0.0.1:${address.port}`;
    this.addCleanupHandler(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
  }

  private handleMockRegistryRequest(req: IncomingMessage, res: ServerResponse): void {
    res.on('error', (err) => console.warn('Mock registry response error:', err));
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/v0.1/health') {
      this.writeJson(res, { status: 'ok', github_client_id: 'test-registry-client' });
      return;
    }

    if (url.pathname === '/v0.1/servers') {
      const servers = this.filterRegistryServers(url.searchParams);
      this.writeJson(res, {
        servers: servers.map((server) => ({
          server,
          _meta: server._meta,
        })),
        metadata: {
          count: servers.length,
        },
      });
      return;
    }

    const versionMatch = url.pathname.match(/^\/v0\.1\/servers\/(.+)\/versions$/);
    if (versionMatch) {
      const serverId = decodeURIComponent(versionMatch[1]);
      const versions = MOCK_REGISTRY_SERVERS.filter((server) => server.name === serverId);

      if (versions.length === 0) {
        this.writeJson(res, { error: 'Not Found' }, 404);
        return;
      }

      this.writeJson(res, {
        servers: versions.map((server) => ({
          server,
          _meta: server._meta,
        })),
        metadata: {
          count: versions.length,
        },
      });
      return;
    }

    this.writeJson(res, { error: 'Not Found' }, 404);
  }

  private filterRegistryServers(searchParams: URLSearchParams): MockRegistryServer[] {
    const query = searchParams.get('search')?.toLowerCase().trim();
    const limitParam = Number(searchParams.get('limit'));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : MOCK_REGISTRY_SERVERS.length;

    let servers = MOCK_REGISTRY_SERVERS;
    if (query) {
      servers = servers.filter(
        (server) => server.name.toLowerCase().includes(query) || server.description.toLowerCase().includes(query),
      );
    }

    return servers.slice(0, limit);
  }

  private writeJson(res: ServerResponse, body: unknown, statusCode = 200): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      Connection: 'close',
    });
    res.end(JSON.stringify(body));
  }
}

interface MockRegistryServer {
  name: string;
  description: string;
  status: 'active' | 'deprecated' | 'archived';
  version: string;
  repository: {
    source: string;
    url: string;
  };
  packages: Array<{
    identifier: string;
    registryType: string;
    runtimeHint?: string;
    transport: {
      type: string;
    };
    version: string;
  }>;
  remotes: Array<{
    type: string;
    url: string;
  }>;
  _meta: {
    'io.modelcontextprotocol.registry/official': {
      isLatest: boolean;
      publishedAt: string;
      status: 'active' | 'deprecated' | 'archived';
      updatedAt: string;
    };
  };
}

const MOCK_REGISTRY_SERVERS: MockRegistryServer[] = [
  createMockRegistryServer({
    name: 'filesystem',
    description: 'File system access for local project files',
    identifier: '@modelcontextprotocol/server-filesystem',
    transportType: 'stdio',
    registryType: 'npm',
  }),
  createMockRegistryServer({
    name: 'file-search',
    description: 'Search files and metadata across a workspace',
    identifier: '@modelcontextprotocol/server-file-search',
    transportType: 'stdio',
    registryType: 'npm',
  }),
  createMockRegistryServer({
    name: 'git',
    description: 'Git repository tools',
    identifier: '@modelcontextprotocol/server-git',
    transportType: 'stdio',
    registryType: 'npm',
  }),
  createMockRegistryServer({
    name: 'database',
    description: 'Database query tools',
    identifier: 'mcp-database',
    transportType: 'http',
    registryType: 'docker',
  }),
  createMockRegistryServer({
    name: 'deprecated-test',
    description: 'Deprecated test server',
    identifier: '@modelcontextprotocol/server-deprecated-test',
    status: 'deprecated',
    transportType: 'stdio',
    registryType: 'npm',
  }),
  createMockRegistryServer({
    name: 'test-registry',
    description: 'Registry fixture server for protocol tests',
    identifier: '@modelcontextprotocol/server-test-registry',
    transportType: 'stdio',
    registryType: 'npm',
  }),
];

function createMockRegistryServer(options: {
  name: string;
  description: string;
  identifier: string;
  status?: 'active' | 'deprecated' | 'archived';
  transportType: string;
  registryType: string;
}): MockRegistryServer {
  const status = options.status || 'active';
  return {
    name: options.name,
    description: options.description,
    status,
    version: '1.0.0',
    repository: {
      source: 'github',
      url: `https://github.com/example/${options.name}`,
    },
    packages: [
      {
        identifier: options.identifier,
        registryType: options.registryType,
        runtimeHint: 'node',
        transport: {
          type: options.transportType,
        },
        version: '1.0.0',
      },
    ],
    remotes: [
      {
        type: options.transportType,
        url: `https://example.test/${options.name}`,
      },
    ],
    _meta: {
      'io.modelcontextprotocol.registry/official': {
        isLatest: true,
        publishedAt: '2026-01-01T00:00:00.000Z',
        status,
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    },
  };
}
