import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import logger from '@src/logger/logger.js';
import { setupServer } from '@src/server.js';

export class TestServerSetup {
  private serverManager: ServerManager | null = null;
  private configPath: string | null = null;

  async startServer(configPath: string): Promise<ServerManager> {
    // Reset any existing instance
    ServerManager.resetInstance();

    // Load the test configuration
    McpConfigManager.getInstance(configPath);

    // Set up and start the server
    const setupResult = await setupServer();
    this.serverManager = setupResult.serverManager;
    this.configPath = configPath;

    // Wait for MCP servers to load in background
    await setupResult.loadingPromise;

    // Give the server a moment to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return this.serverManager;
  }

  async stopServer(): Promise<void> {
    if (this.serverManager) {
      try {
        // Disconnect all transports
        // Note: ServerManager handles cleanup internally during reset

        // Reset the singleton
        ServerManager.resetInstance();
        this.serverManager = null;
      } catch (error) {
        logger.error('Error stopping server:', error);
        // Still reset to avoid state pollution
        ServerManager.resetInstance();
        this.serverManager = null;
      }
    }
  }

  getServerManager(): ServerManager | null {
    return this.serverManager;
  }

  async restartServer(): Promise<ServerManager> {
    await this.stopServer();
    if (!this.configPath) {
      throw new Error('Cannot restart server without config path');
    }
    return await this.startServer(this.configPath);
  }
}
