import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { MCP_SERVER_VERSION } from '@src/constants.js';
import logger, { debugIf } from '@src/logger/logger.js';
import type { ContextData, ContextHeaders } from '@src/types/context.js';

/**
 * STDIO Proxy Transport Options
 */
export interface StdioProxyTransportOptions {
  serverUrl: string;
  preset?: string;
  filter?: string;
  tags?: string[];
  timeout?: number;
  context?: ContextData;
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

  constructor(private options: StdioProxyTransportOptions) {
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

    // Prepare request headers including context if provided
    const requestInit: RequestInit = {
      headers: {
        'User-Agent': `1MCP-Proxy/${MCP_SERVER_VERSION}`,
      },
    };

    // Add context headers if context data is available
    if (this.options.context) {
      const contextHeaders = this.createContextHeaders(this.options.context);
      Object.assign(requestInit.headers as Record<string, string>, contextHeaders);

      debugIf(() => ({
        message: 'Context headers added to HTTP transport',
        meta: {
          sessionId: this.options.context?.sessionId,
          hasProject: !!this.options.context?.project.path,
          hasUser: !!this.options.context?.user.username,
          version: this.options.context?.version,
        },
      }));
    }

    this.httpTransport = new StreamableHTTPClientTransport(url, {
      requestInit,
    });
  }

  /**
   * Start the proxy transport
   */
  async start(): Promise<void> {
    try {
      debugIf(() => ({
        message: 'Starting STDIO proxy transport',
        meta: {
          serverUrl: this.options.serverUrl,
          tags: this.options.tags,
        },
      }));

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
        debugIf(() => ({
          message: 'Forwarding message from STDIO to HTTP',
          meta: {
            method: 'method' in message ? message.method : 'unknown',
            id: 'id' in message ? message.id : 'unknown',
          },
        }));

        // Forward to HTTP server
        await this.httpTransport.send(message);
      } catch (error) {
        logger.error(`Error forwarding STDIO message to HTTP: ${error}`);
      }
    };

    // Forward messages from HTTP server to STDIO client
    this.httpTransport.onmessage = async (message: JSONRPCMessage) => {
      try {
        debugIf(() => ({
          message: 'Forwarding message from HTTP to STDIO',
          meta: {
            method: 'method' in message ? message.method : 'unknown',
            id: 'id' in message ? message.id : 'unknown',
          },
        }));

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
   * Create context headers for HTTP transmission
   */
  private createContextHeaders(context: ContextData): ContextHeaders {
    // Encode context data as base64 for safe transmission
    const contextJson = JSON.stringify(context);
    const contextBase64 = Buffer.from(contextJson, 'utf8').toString('base64');

    const headers: ContextHeaders = {
      'X-1MCP-Context': contextBase64,
      'X-1MCP-Context-Version': context.version || 'v1',
    };

    // Add optional headers for debugging and tracking
    if (context.sessionId) {
      headers['X-1MCP-Context-Session'] = context.sessionId;
    }

    if (context.timestamp) {
      headers['X-1MCP-Context-Timestamp'] = context.timestamp;
    }

    return headers;
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
      debugIf('Closing STDIO proxy transport');

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
