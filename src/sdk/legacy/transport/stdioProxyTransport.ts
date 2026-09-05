import { PROTOCOL_VERSION_META_KEY, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { buildCliContext, generateStreamableSessionId } from '@src/commands/shared/cliContext.js';
import { MCP_SERVER_VERSION } from '@src/constants/mcp.js';
import type { TemplateContextProof } from '@src/core/context/templateContextTrust.js';
import {
  classifyProtocolEra,
  createGatewayFailure,
  type GatewayFailure,
  type ProtocolEraPin,
} from '@src/gateway/contracts/index.js';
import logger from '@src/logger/logger.js';
import { toProtocolJSONRPCMessage } from '@src/sdk/contracts/index.js';
import { StdioServerTransport } from '@src/sdk/legacy/server/stdio.js';
import { JSONRPCMessage } from '@src/sdk/legacy/types.js';
import type { ClientInfo, ContextData } from '@src/types/context.js';
import { ClientInfoExtractor } from '@src/utils/client/clientInfoExtractor.js';

/**
 * STDIO Proxy Transport Options
 */
export interface StdioProxyTransportOptions {
  serverUrl: string;
  bearerToken?: string;
  preset?: string;
  filter?: string;
  tags?: string[];
  timeout?: number;
  context?: ContextData;
  contextProof?: TemplateContextProof;
  createContextProof?: (context: ContextData) => Promise<TemplateContextProof | undefined>;
}

/**
 * Generate a secure mcp-session-id for the proxy with the correct prefix
 */
function generateMcpSessionId(): string {
  return generateStreamableSessionId();
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
  private httpStarted = false;
  private stdioStarted = false;
  private closePromise?: Promise<void>;
  private context: ContextData;
  private clientInfo: ClientInfo | null = null;
  private initializeIntercepted = false;
  private serverUrl: URL;
  private downstreamPin?: ProtocolEraPin;
  private legacyInitializeRequestId?: string | number;

  constructor(private options: StdioProxyTransportOptions) {
    // Reset any previous state
    ClientInfoExtractor.reset();

    this.context =
      this.options.context ||
      buildCliContext({
        cwd: process.cwd(),
        projectRoot: process.cwd(),
        transportType: 'stdio-proxy',
        version: MCP_SERVER_VERSION,
        sessionId: generateMcpSessionId(),
      });

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

    // Create HTTP transport with custom fetch that dynamically injects User-Agent
    // Note: sessionId is passed as a parameter, SDK will handle adding it to headers
    this.httpTransport = new StreamableHTTPClientTransport(this.serverUrl, {
      fetch: this.createDynamicHeaderFetch(),
      sessionId: this.context.sessionId,
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
      this.httpStarted = true;
      await this.httpTransport.start();

      logger.info('Connected to 1MCP HTTP server');

      // Start STDIO transport
      this.stdioStarted = true;
      await this.stdioTransport.start();
      this.isConnected = true;

      logger.info('STDIO proxy started successfully');
    } catch (error) {
      logger.error(`Failed to start STDIO proxy: ${error}`);
      await this.close();
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
        this.observeUpstreamFrame(message);
        // Forward to STDIO client
        await this.stdioTransport.send(message as never);
      } catch (error) {
        logger.error(`Error forwarding HTTP message to STDIO: ${error}`);
        if (this.isProtocolFailure(error)) await this.failProtocolFrame(message, error);
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
        this.classifyDownstreamFrame(message);
        // Check for initialize request to extract client info
        if (!this.initializeIntercepted) {
          const clientInfo = ClientInfoExtractor.extractFromInitializeRequest(toProtocolJSONRPCMessage(message));
          if (clientInfo) {
            this.clientInfo = clientInfo;
            this.initializeIntercepted = true;

            logger.info('🔍 Extracted client info from initialize request', {
              clientName: clientInfo.name,
              clientVersion: clientInfo.version,
              clientTitle: clientInfo.title,
            });

            // Client info is now available - custom fetch will dynamically inject
            // the updated User-Agent header for all subsequent HTTP requests
            logger.info('✅ Client info extracted - User-Agent will be updated for all requests', {
              userAgent: this.buildUserAgent(),
            });
          }
        }

        // Add context metadata to message _meta field
        const enhancedMessage = await this.addContextMeta(message);

        // Forward to HTTP server
        await this.httpTransport.send(enhancedMessage as never);
      } catch (error) {
        logger.error(`Error forwarding STDIO message to HTTP: ${error}`);
        if (this.isProtocolFailure(error)) await this.failProtocolFrame(message, error);
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

  private classifyDownstreamFrame(message: JSONRPCMessage): void {
    if (!('method' in message)) return;
    const params = message.params;
    const record = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : undefined;
    const meta =
      record && typeof record._meta === 'object' && record._meta !== null
        ? (record._meta as Record<string, unknown>)
        : undefined;
    const modernRevision = meta?.[PROTOCOL_VERSION_META_KEY];

    let evidence: { syntax: 'legacy' | 'modern'; revision: unknown };
    if (message.method === 'initialize') {
      evidence = { syntax: 'legacy', revision: record?.protocolVersion };
      this.legacyInitializeRequestId = 'id' in message ? message.id : undefined;
    } else if (modernRevision !== undefined) {
      evidence = { syntax: 'modern', revision: modernRevision };
    } else if (this.downstreamPin?.era === 'legacy') {
      return;
    } else {
      throw createGatewayFailure({
        kind: 'protocol',
        code: 'proxy_protocol_evidence_missing',
        message: 'The proxy request does not contain valid protocol era evidence',
      });
    }

    const classified = classifyProtocolEra(evidence);
    if (!classified.ok) throw classified.failure;
    if (
      this.downstreamPin &&
      (this.downstreamPin.era !== classified.value.era || this.downstreamPin.revision !== classified.value.revision)
    ) {
      throw createGatewayFailure({
        kind: 'protocol',
        code: 'proxy_protocol_era_conflict',
        message: 'The proxy downstream protocol era is already pinned',
      });
    }
    this.downstreamPin ??= classified.value;
  }

  private observeUpstreamFrame(message: JSONRPCMessage): void {
    if (this.downstreamPin?.era !== 'legacy' || !('id' in message) || message.id !== this.legacyInitializeRequestId) {
      return;
    }
    if (!('result' in message)) return;
    const result = message.result;
    const revision =
      typeof result === 'object' && result !== null ? (result as Record<string, unknown>).protocolVersion : undefined;
    const classified = classifyProtocolEra({ syntax: 'legacy', revision });
    if (!classified.ok) {
      throw createGatewayFailure({
        kind: 'protocol',
        code: 'proxy_legacy_revision_mismatch',
        message: 'The proxy upstream selected an unsupported legacy protocol revision',
      });
    }
    this.downstreamPin = classified.value;
    this.httpTransport.setProtocolVersion(classified.value.revision);
  }

  private isProtocolFailure(error: unknown): error is GatewayFailure {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as Partial<GatewayFailure>;
    return candidate.kind === 'protocol' && typeof candidate.code === 'string';
  }

  private async failProtocolFrame(message: JSONRPCMessage, failure: GatewayFailure): Promise<void> {
    const id =
      'id' in message && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null;
    try {
      await this.stdioTransport.send({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32_600,
          message: 'Proxy protocol negotiation failed',
          data: { code: failure.code },
        },
      } as never);
    } finally {
      await this.close();
    }
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
   * Create a custom fetch function that dynamically injects User-Agent header
   *
   * This ensures the HTTP server sees updated client info for all requests after
   * the initialize message is processed. The custom fetch wraps the global fetch
   * and merges the current User-Agent (which includes client info if available)
   * with the request headers.
   *
   * Why custom fetch instead of requestInit?
   * - The SDK's StreamableHTTPClientTransport uses _fetch directly for all requests
   * - Updating requestInit after transport creation doesn't affect existing connections
   * - Custom fetch allows dynamic header injection without recreating the transport
   * - Avoids "Transport closed" errors from mid-session transport recreation
   *
   * @returns A fetch function that injects the current User-Agent header
   */
  private createDynamicHeaderFetch(): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      // Build current User-Agent (includes client info if available)
      const currentUserAgent = this.buildUserAgent();

      // Merge headers: preserve existing headers, add/update User-Agent
      const headers = new Headers(init?.headers);
      headers.set('User-Agent', currentUserAgent);
      if (this.options.bearerToken) {
        headers.set('Authorization', `Bearer ${this.options.bearerToken}`);
      }

      // Create new init with updated headers
      const updatedInit: RequestInit = {
        ...init,
        headers,
        redirect: 'error',
      };

      // Call global fetch with updated headers
      return fetch(input, updatedInit);
    };
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
  private async addContextMeta(message: JSONRPCMessage): Promise<JSONRPCMessage> {
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
    const contextProof = this.options.createContextProof
      ? await this.options.createContextProof(contextWithClient)
      : this.options.contextProof;

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
            ...(contextProof ? { contextProof } : {}),
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
    if (this.closePromise) return this.closePromise;
    if (!this.httpStarted && !this.stdioStarted && !this.isConnected) return;

    this.isConnected = false;
    this.closePromise = (async () => {
      this.httpTransport.onmessage = undefined;
      this.httpTransport.onerror = undefined;
      this.httpTransport.onclose = undefined;
      this.stdioTransport.onmessage = undefined;
      this.stdioTransport.onerror = undefined;
      this.stdioTransport.onclose = undefined;

      const closers: Array<Promise<void>> = [];
      if (this.httpStarted) closers.push(this.httpTransport.close());
      if (this.stdioStarted) closers.push(this.stdioTransport.close());
      this.httpStarted = false;
      this.stdioStarted = false;
      const outcomes = await Promise.allSettled(closers);
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') logger.error(`Error closing STDIO proxy: ${outcome.reason}`);
      }
      logger.info('STDIO proxy closed');
    })();
    return this.closePromise;
  }
}
