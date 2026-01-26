import { ServerResponse } from 'node:http';

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { logJsonRpc } from '@src/transport/http/utils/unifiedLogger.js';

/**
 * SSE transport wrapper that logs JSON-RPC error responses.
 * JSON-RPC errors are sent via SSE with HTTP 200 status, so we need
 * to intercept the send() method to log error details.
 */
export class LoggingSSEServerTransport extends SSEServerTransport {
  constructor(endpoint: string, res: ServerResponse) {
    super(endpoint, res);
  }

  override async send(message: JSONRPCMessage): Promise<void> {
    // Check if message is a JSON-RPC error response
    if ('error' in message && message.error?.code !== undefined) {
      const isErrorLoggingEnabled = process.env.ONE_MCP_LOG_JSONRPC_ERRORS !== 'false';

      if (isErrorLoggingEnabled) {
        logJsonRpc('warn', 'JSON-RPC error response', {
          jsonrpcVersion: message.jsonrpc,
          requestId: message.id,
          errorCode: message.error.code,
          errorMessage: message.error.message,
          errorData: message.error.data,
          sessionId: this.sessionId,
        });
      }
    }

    // Call parent's send method to actually send the message
    return super.send(message);
  }
}
