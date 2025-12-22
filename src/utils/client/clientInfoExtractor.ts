import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import type { ClientInfo } from '@src/types/context.js';

/**
 * Extract client information from MCP initialize request
 */
export class ClientInfoExtractor {
  private static extractedClientInfo: ClientInfo | null = null;
  private static initializeReceived = false;

  /**
   * Extract client information from initialize request
   */
  static extractFromInitializeRequest(message: JSONRPCMessage): ClientInfo | null {
    // Return null if we've already processed an initialize request
    if (this.initializeReceived) {
      return null;
    }

    // Check if this is an initialize request
    if (
      message &&
      typeof message === 'object' &&
      'method' in message &&
      message.method === 'initialize' &&
      'params' in message &&
      typeof message.params === 'object' &&
      message.params !== null &&
      'clientInfo' in message.params
    ) {
      const params = message.params as { clientInfo?: unknown };
      const clientInfo = params.clientInfo;

      // Validate required fields
      if (
        clientInfo &&
        typeof clientInfo === 'object' &&
        'name' in clientInfo &&
        typeof (clientInfo as { name: unknown }).name === 'string' &&
        'version' in clientInfo &&
        typeof (clientInfo as { version: unknown }).version === 'string'
      ) {
        const typedClientInfo = clientInfo as {
          name: string;
          version: string;
          title?: unknown;
        };

        this.extractedClientInfo = {
          name: typedClientInfo.name,
          version: typedClientInfo.version,
          title: typedClientInfo.title && typeof typedClientInfo.title === 'string' ? typedClientInfo.title : undefined,
        };

        this.initializeReceived = true;

        return this.extractedClientInfo;
      }
    }

    return null;
  }

  /**
   * Get the extracted client information (if available)
   */
  static getExtractedClientInfo(): ClientInfo | null {
    return this.extractedClientInfo;
  }

  /**
   * Check if initialize request has been received
   */
  static hasReceivedInitialize(): boolean {
    return this.initializeReceived;
  }

  /**
   * Reset the extractor state (for new connections)
   */
  static reset(): void {
    this.extractedClientInfo = null;
    this.initializeReceived = false;
  }
}
