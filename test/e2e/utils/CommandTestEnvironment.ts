import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigBuilder } from './ConfigBuilder.js';

export interface TestEnvironmentConfig {
  name: string;
  createConfigFile?: boolean;
  mockApps?: MockApp[];
  mockMcpServers?: MockMcpServer[];
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
  private cleanupHandlers: Array<() => Promise<void>> = [];

  constructor(private config: TestEnvironmentConfig) {}

  /**
   * Initialize the test environment with temporary directories and mock data
   */
  async setup(): Promise<void> {
    // Create temporary directory
    this.tempDir = await mkdtemp(join(tmpdir(), `1mcp-test-${this.config.name}-`));

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
  }

  /**
   * Get environment variables that should be set for command execution
   */
  getEnvironmentVariables(): Record<string, string> {
    const baseEnv = {
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

    return baseEnv;
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
}
