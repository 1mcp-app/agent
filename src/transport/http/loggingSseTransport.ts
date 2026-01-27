import { ServerResponse } from 'node:http';

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { AgentConfigManager } from '@src/core/server/agentConfig.js';
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
      const agentConfig = AgentConfigManager.getInstance();
      const isErrorLoggingEnabled = agentConfig.isJsonRpcErrorLoggingEnabled();

      if (isErrorLoggingEnabled) {
        try {
          // Sanitize errorData - only include safe primitive types
          const rawErrorData = message.error.data;
          const safeErrorData =
            rawErrorData === null || ['string', 'number', 'boolean'].includes(typeof rawErrorData)
              ? rawErrorData
              : undefined;

          logJsonRpc('warn', 'JSON-RPC error response', {
            jsonrpcVersion: message.jsonrpc,
            requestId: message.id,
            errorCode: message.error.code,
            errorMessage: message.error.message,
            errorData: safeErrorData,
            sessionId: this.sessionId,
          });
        } catch (_logError) {
          // Best-effort logging only; never block the response
        }
      }
    }

    // Always send the message, even if logging fails
    return super.send(message);
  }
}
