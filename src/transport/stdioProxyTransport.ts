import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import logger, { debugIf } from '../logger/logger.js';
import { MCP_CLIENT_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '../constants.js';

/**
 * STDIO Proxy Transport Options
 */
export interface StdioProxyTransportOptions {
  serverUrl: string;
  tags?: string[];
  timeout?: number;
}

/**
 * STDIO Proxy Transport
 *
 * Provides a STDIO interface that proxies all requests to a running 1MCP HTTP server.
 * Acts as a bridge between STDIO-only MCP clients and the centralized HTTP server.
 */
export class StdioProxyTransport {
  private stdioTransport: StdioServerTransport;
  private httpClient: Client;
  private streambleHTTPTransport: StreamableHTTPClientTransport;
  private isConnected = false;

  constructor(private options: StdioProxyTransportOptions) {
    // Create STDIO server transport (for client communication)
    this.stdioTransport = new StdioServerTransport();

    // Create SSE client transport (for HTTP server communication)
    const url = new URL(this.options.serverUrl);

    // Add tags to URL if provided
    if (this.options.tags && this.options.tags.length > 0) {
      url.searchParams.set('tags', this.options.tags.join(','));
    }

    this.streambleHTTPTransport = new StreamableHTTPClientTransport(url);
    this.httpClient = new Client(
      {
        name: `${MCP_SERVER_NAME}-proxy`,
        version: MCP_SERVER_VERSION,
      },
      {
        capabilities: MCP_CLIENT_CAPABILITIES,
      },
    );
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

      // Connect HTTP client to server
      await this.httpClient.connect(this.streambleHTTPTransport, {
        timeout: this.options.timeout,
      });
      this.isConnected = true;

      logger.info('Connected to 1MCP HTTP server');

      // Set up bidirectional message forwarding
      this.setupMessageForwarding();

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
          meta: { method: (message as any).method, id: (message as any).id },
        }));

        // Forward to HTTP server through client
        await this.streambleHTTPTransport.send(message);
      } catch (error) {
        logger.error(`Error forwarding STDIO message to HTTP: ${error}`);
      }
    };

    // Forward messages from HTTP server to STDIO client
    this.streambleHTTPTransport.onmessage = async (message: JSONRPCMessage) => {
      try {
        debugIf(() => ({
          message: 'Forwarding message from HTTP to STDIO',
          meta: { method: (message as any).method, id: (message as any).id },
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

    // Handle errors from SSE transport
    this.streambleHTTPTransport.onerror = (error: Error) => {
      logger.error(`SSE transport error: ${error.message}`);
    };

    // Handle STDIO transport close
    this.stdioTransport.onclose = async () => {
      logger.info('STDIO transport closed');
      await this.close();
    };

    // Handle SSE transport close
    this.streambleHTTPTransport.onclose = async () => {
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

    try {
      debugIf('Closing STDIO proxy transport');

      // Close HTTP client connection
      await this.httpClient.close();

      // Close STDIO transport
      await this.stdioTransport.close();

      this.isConnected = false;
      logger.info('STDIO proxy closed');
    } catch (error) {
      logger.error(`Error closing STDIO proxy: ${error}`);
    }
  }
}
