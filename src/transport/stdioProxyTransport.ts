import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import type { ProjectConfig } from '@src/config/projectConfigTypes.js';
import { MCP_SERVER_VERSION } from '@src/constants.js';
import logger from '@src/logger/logger.js';
import type { ContextData } from '@src/types/context.js';

/**
 * STDIO Proxy Transport Options
 */
export interface StdioProxyTransportOptions {
  serverUrl: string;
  preset?: string;
  filter?: string;
  tags?: string[];
  timeout?: number;
  projectConfig?: ProjectConfig; // For context enrichment
}

/**
 * Enrich context with project configuration
 */
function enrichContextWithProjectConfig(context: ContextData, projectConfig?: ProjectConfig): ContextData {
  if (!projectConfig?.context) {
    return context;
  }

  const enrichedContext = { ...context };

  // Enrich project context
  if (projectConfig.context) {
    enrichedContext.project = {
      ...context.project,
      environment: projectConfig.context.environment || context.project.environment,
      custom: {
        ...context.project.custom,
        projectId: projectConfig.context.projectId,
        team: projectConfig.context.team,
        ...projectConfig.context.custom,
      },
    };

    // Handle environment variable prefixes
    if (projectConfig.context.envPrefixes && projectConfig.context.envPrefixes.length > 0) {
      const envVars: Record<string, string> = {};

      for (const prefix of projectConfig.context.envPrefixes) {
        for (const [key, value] of Object.entries(process.env)) {
          if (key.startsWith(prefix) && value) {
            envVars[key] = value;
          }
        }
      }

      enrichedContext.environment = {
        ...context.environment,
        variables: {
          ...context.environment.variables,
          ...envVars,
        },
      };
    }
  }

  return enrichedContext;
}

/**
 * Auto-detects context from the proxy's environment
 */
function detectProxyContext(projectConfig?: ProjectConfig): ContextData {
  const cwd = process.cwd();
  const projectName = cwd.split('/').pop() || 'unknown';

  const baseContext: ContextData = {
    project: {
      path: cwd,
      name: projectName,
      environment: process.env.NODE_ENV || 'development',
    },
    user: {
      username: process.env.USER || process.env.USERNAME || 'unknown',
      home: process.env.HOME || process.env.USERPROFILE || '',
    },
    environment: {
      variables: {
        NODE_VERSION: process.version,
        PLATFORM: process.platform,
        ARCH: process.arch,
        PWD: cwd,
      },
    },
    timestamp: new Date().toISOString(),
    version: MCP_SERVER_VERSION,
    sessionId: `proxy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  };

  return enrichContextWithProjectConfig(baseContext, projectConfig);
}

/**
 * STDIO Proxy Transport
 *
 * Provides a STDIO interface that proxies all requests to a running 1MCP HTTP server.
 * Acts as a bridge between STDIO-only MCP clients and the centralized HTTP server.
 *
 * This implementation uses pure transport-to-transport forwarding without the Client layer,
 * to avoid conflicts with MCP protocol message handling.
 */
export class StdioProxyTransport {
  private stdioTransport: StdioServerTransport;
  private httpTransport: StreamableHTTPClientTransport;
  private isConnected = false;
  private context: ContextData;

  constructor(private options: StdioProxyTransportOptions) {
    // Auto-detect context from proxy's environment and enrich with project config
    this.context = detectProxyContext(this.options.projectConfig);

    logger.info('🔍 Detected proxy context', {
      projectPath: this.context.project.path,
      projectName: this.context.project.name,
      sessionId: this.context.sessionId,
    });

    // Create STDIO server transport (for client communication)
    this.stdioTransport = new StdioServerTransport();

    // Create Streamable HTTP client transport (for HTTP server communication)
    const url = new URL(this.options.serverUrl);

    // Apply priority: preset > filter > tags (only one will be added)
    if (this.options.preset) {
      url.searchParams.set('preset', this.options.preset);
    } else if (this.options.filter) {
      url.searchParams.set('filter', this.options.filter);
    } else if (this.options.tags && this.options.tags.length > 0) {
      url.searchParams.set('tags', this.options.tags.join(','));
    }

    // Add context as query parameters for template processing
    if (this.context.project.path) url.searchParams.set('project_path', this.context.project.path);
    if (this.context.project.name) url.searchParams.set('project_name', this.context.project.name);
    if (this.context.project.environment) url.searchParams.set('project_env', this.context.project.environment);
    if (this.context.user.username) url.searchParams.set('user_username', this.context.user.username);
    if (this.context.environment.variables?.NODE_VERSION)
      url.searchParams.set('env_node_version', this.context.environment.variables.NODE_VERSION);
    if (this.context.environment.variables?.PLATFORM)
      url.searchParams.set('env_platform', this.context.environment.variables.PLATFORM);
    if (this.context.timestamp) url.searchParams.set('context_timestamp', this.context.timestamp);
    if (this.context.version) url.searchParams.set('context_version', this.context.version);
    if (this.context.sessionId) url.searchParams.set('context_session_id', this.context.sessionId);

    logger.info('📡 Proxy connecting with context query parameters', {
      url: url.toString(),
      contextProvided: true,
    });

    // Prepare request headers
    const requestInit: RequestInit = {
      headers: {
        'User-Agent': `1MCP-Proxy/${MCP_SERVER_VERSION}`,
      },
    };

    this.httpTransport = new StreamableHTTPClientTransport(url, {
      requestInit,
    });
  }

  /**
   * Start the proxy transport
   */
  async start(): Promise<void> {
    try {
      // CRITICAL: Set up message forwarding BEFORE starting transports
      // This ensures handlers are ready when messages start flowing
      this.setupMessageForwarding();

      // Start HTTP transport connection
      await this.httpTransport.start();
      this.isConnected = true;

      logger.info('Connected to 1MCP HTTP server');

      // Start STDIO transport
      await this.stdioTransport.start();

      logger.info('STDIO proxy started successfully');
    } catch (error) {
      logger.error(`Failed to start STDIO proxy: ${error}`);
      throw error;
    }
  }

  /**
   * Set up bidirectional message forwarding between STDIO and HTTP
   */
  private setupMessageForwarding(): void {
    // Forward messages from STDIO client to HTTP server
    this.stdioTransport.onmessage = async (message: JSONRPCMessage) => {
      try {
        // Forward to HTTP server
        await this.httpTransport.send(message);
      } catch (error) {
        logger.error(`Error forwarding STDIO message to HTTP: ${error}`);
      }
    };

    // Forward messages from HTTP server to STDIO client
    this.httpTransport.onmessage = async (message: JSONRPCMessage) => {
      try {
        // Forward to STDIO client
        await this.stdioTransport.send(message);
      } catch (error) {
        logger.error(`Error forwarding HTTP message to STDIO: ${error}`);
      }
    };

    // Handle errors from STDIO transport
    this.stdioTransport.onerror = (error: Error) => {
      logger.error(`STDIO transport error: ${error.message}`);
    };

    // Handle errors from HTTP transport
    this.httpTransport.onerror = (error: Error) => {
      logger.error(`HTTP transport error: ${error.message}`);
    };

    // Handle STDIO transport close
    this.stdioTransport.onclose = async () => {
      logger.info('STDIO transport closed');
      await this.close();
    };

    // Handle HTTP transport close
    this.httpTransport.onclose = async () => {
      logger.warn('HTTP server connection closed');
      await this.close();
    };
  }

  /**
   * Close the proxy transport
   */
  async close(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    // Set isConnected to false immediately to prevent re-entry
    // when transport close handlers trigger onclose events
    this.isConnected = false;

    try {
      // Close HTTP transport
      await this.httpTransport.close();

      // Close STDIO transport
      await this.stdioTransport.close();

      logger.info('STDIO proxy closed');
    } catch (error) {
      logger.error(`Error closing STDIO proxy: ${error}`);
    }
  }
}
