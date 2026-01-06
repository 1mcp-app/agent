import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import type { ProjectConfig } from '@src/config/projectConfigTypes.js';
import { AUTH_CONFIG } from '@src/constants/auth.js';
import { MCP_SERVER_VERSION } from '@src/constants/mcp.js';
import logger from '@src/logger/logger.js';
import type { ClientInfo, ContextData } from '@src/types/context.js';
import { ClientInfoExtractor } from '@src/utils/client/clientInfoExtractor.js';

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
 * Generate a secure mcp-session-id for the proxy with the correct prefix
 */
function generateMcpSessionId(): string {
  return `${AUTH_CONFIG.SERVER.STREAMABLE_SESSION.ID_PREFIX}${crypto.randomUUID()}`;
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
    sessionId: generateMcpSessionId(),
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
  private clientInfo: ClientInfo | null = null;
  private initializeIntercepted = false;
  private serverUrl: URL;
  private requestInit: RequestInit;

  constructor(private options: StdioProxyTransportOptions) {
    // Reset any previous state
    ClientInfoExtractor.reset();

    // Auto-detect context from proxy's environment and enrich with project config
    this.context = detectProxyContext(this.options.projectConfig);

    logger.info('🔍 Detected proxy context', {
      projectPath: this.context.project.path,
      projectName: this.context.project.name,
      sessionId: this.context.sessionId,
    });

    // Create STDIO server transport (for client communication)
    this.stdioTransport = new StdioServerTransport();

    // Prepare the server URL (no query parameters needed - using context headers)
    this.serverUrl = new URL(this.options.serverUrl);

    // Apply priority: preset > filter > tags (only one will be added)
    if (this.options.preset) {
      this.serverUrl.searchParams.set('preset', this.options.preset);
    } else if (this.options.filter) {
      this.serverUrl.searchParams.set('filter', this.options.filter);
    } else if (this.options.tags && this.options.tags.length > 0) {
      this.serverUrl.searchParams.set('tags', this.options.tags.join(','));
    }

    logger.info('📡 Proxy connecting with _meta field approach', {
      url: this.serverUrl.toString(),
      contextProvided: true,
    });

    // Prepare minimal request headers (no large context data)
    this.requestInit = {
      headers: {
        'User-Agent': this.buildUserAgent(),
        'mcp-session-id': this.context.sessionId!, // Non-null assertion - always set by detectProxyContext
      },
    };

    // Create initial HTTP transport with minimal headers
    this.httpTransport = new StreamableHTTPClientTransport(this.serverUrl, {
      requestInit: this.requestInit,
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
   * Set up HTTP transport message handlers
   * Extracted to allow re-setup after transport recreation
   */
  private setupHttpTransportMessageHandlers(): void {
    // Forward messages from HTTP server to STDIO client
    this.httpTransport.onmessage = async (message: JSONRPCMessage) => {
      try {
        // Forward to STDIO client
        await this.stdioTransport.send(message);
      } catch (error) {
        logger.error(`Error forwarding HTTP message to STDIO: ${error}`);
      }
    };

    // Handle errors from HTTP transport
    this.httpTransport.onerror = (error: Error) => {
      logger.error(`HTTP transport error: ${error.message}`);
    };

    // Handle HTTP transport close
    this.httpTransport.onclose = async () => {
      logger.warn('HTTP server connection closed');
      await this.close();
    };
  }

  /**
   * Set up bidirectional message forwarding between STDIO and HTTP
   */
  private setupMessageForwarding(): void {
    // Forward messages from STDIO client to HTTP server
    this.stdioTransport.onmessage = async (message: JSONRPCMessage) => {
      try {
        // Check for initialize request to extract client info
        if (!this.initializeIntercepted) {
          const clientInfo = ClientInfoExtractor.extractFromInitializeRequest(message);
          if (clientInfo) {
            this.clientInfo = clientInfo;
            this.initializeIntercepted = true;

            logger.info('🔍 Extracted client info from initialize request', {
              clientName: clientInfo.name,
              clientVersion: clientInfo.version,
              clientTitle: clientInfo.title,
            });

            // Recreate transport with enhanced User-Agent
            this.recreateHttpTransport();
            logger.info('✅ Updated User-Agent with client info', {
              userAgent: this.buildUserAgent(),
            });
          }
        }

        // Add context metadata to message _meta field
        const enhancedMessage = this.addContextMeta(message);

        // Forward to HTTP server
        await this.httpTransport.send(enhancedMessage);
      } catch (error) {
        logger.error(`Error forwarding STDIO message to HTTP: ${error}`);
      }
    };

    // Set up HTTP transport message handlers
    this.setupHttpTransportMessageHandlers();

    // Handle errors from STDIO transport
    this.stdioTransport.onerror = (error: Error) => {
      logger.error(`STDIO transport error: ${error.message}`);
    };

    // Handle STDIO transport close
    this.stdioTransport.onclose = async () => {
      logger.info('STDIO transport closed');
      await this.close();
    };
  }

  /**
   * Build User-Agent string with optional client info
   */
  private buildUserAgent(): string {
    const base = `1MCP-Proxy/${MCP_SERVER_VERSION}`;
    if (this.clientInfo) {
      const { name, version, title } = this.clientInfo;
      const clientString = title ? `${name}/${version} (${title})` : `${name}/${version}`;
      return `${base} ${clientString}`;
    }
    return base;
  }

  /**
   * Recreate HTTP transport with updated User-Agent header
   * Called after client info extraction to include client details in User-Agent
   */
  private recreateHttpTransport(): void {
    const oldTransport = this.httpTransport;

    // Update requestInit with new User-Agent
    this.requestInit = {
      headers: {
        'User-Agent': this.buildUserAgent(),
        'mcp-session-id': this.context.sessionId!,
      },
    };

    // Create new transport
    this.httpTransport = new StreamableHTTPClientTransport(this.serverUrl, {
      requestInit: this.requestInit,
    });

    // Re-setup message forwarding for new transport
    this.setupHttpTransportMessageHandlers();

    // Close old transport gracefully
    oldTransport.close().catch((error) => {
      logger.warn(`Error closing old HTTP transport: ${error}`);
    });

    logger.info('HTTP transport recreated with updated User-Agent');
  }

  /**
   * Type guard to check if a JSON-RPC message is a request
   */
  private isRequest(message: JSONRPCMessage): message is JSONRPCMessage & {
    method: string;
    params?: Record<string, unknown>;
  } {
    return 'method' in message;
  }

  /**
   * Add context metadata to message using _meta field
   */
  private addContextMeta(message: JSONRPCMessage): JSONRPCMessage {
    // Create context with client info if available
    const contextWithClient = {
      ...this.context,
      ...(this.clientInfo && {
        transport: {
          type: 'stdio-proxy',
          connectionTimestamp: new Date().toISOString(),
          client: this.clientInfo,
        },
      }),
    };

    // Only add _meta to messages that are requests (have params)
    if (this.isRequest(message) && message.params !== undefined) {
      const params = message.params as Record<string, unknown>;
      // Return a new message object with _meta field
      return {
        ...message,
        params: {
          ...params,
          _meta: {
            ...((params._meta as Record<string, unknown>) || {}), // Preserve existing _meta
            context: contextWithClient, // Add our context data
          },
        },
      };
    }

    // Return original message for responses or requests without params
    return message;
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
