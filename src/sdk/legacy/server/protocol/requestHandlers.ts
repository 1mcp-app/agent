import { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import {
  createCapabilityCatalogFromConnections,
  filterConnectionsForSession,
  getRequestSession,
  resolveOutboundConnection,
} from '@src/core/protocol/requestHandlerUtils.js';
import { ClientStatus, InboundConnection } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import {
  type LegacyOutboundConnections,
  requestLegacyOutbound,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import { PingRequestSchema, SetLevelRequestSchema } from '@src/sdk/legacy/types.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';

import { registerCompletionHandlers, registerPromptHandlers } from './promptRequestHandlers.js';
import { sessionLogLevels } from './requestInteractionScope.js';
import { registerResourceHandlers } from './resourceRequestHandlers.js';
import { registerToolHandlers } from './toolRequestHandlers.js';

export {
  createCapabilityCatalogFromConnections,
  filterConnectionsForSession,
  getRequestSession,
  resolveOutboundConnection,
};

/**
 * Registers all request handlers based on available capabilities
 * @param clients Record of client instances
 * @param server The MCP server instance
 * @param capabilities The server capabilities
 * @param tags Array of tags to filter clients by
 */

export function registerRequestHandlers(
  outboundConns: LegacyOutboundConnections,
  inboundConn: InboundConnection,
  lazyLoadingOrchestrator?: LazyLoadingOrchestrator,
): void {
  // Register logging level handler
  getLegacyInboundServer(inboundConn).setRequestHandler(SetLevelRequestSchema, async (request) => {
    sessionLogLevels.set(inboundConn, request.params.level);
    return {};
  });

  // Register ping handler
  getLegacyInboundServer(inboundConn).setRequestHandler(
    PingRequestSchema,
    withErrorHandling(async () => {
      // Health check all connected upstream clients
      const healthCheckPromises = Array.from(outboundConns.entries()).map(async ([clientName, outboundConn]) => {
        if (outboundConn.status === ClientStatus.Connected) {
          try {
            await requestLegacyOutbound(outboundConn, 'ping');
            logger.info(`Health check successful for client: ${clientName}`);
          } catch (error) {
            logger.warn(`Health check failed for client ${clientName}: ${error}`);
          }
        }
      });

      // Wait for all health checks to complete (but don't fail if some fail)
      await Promise.allSettled(healthCheckPromises);

      // Always return successful pong response
      return {};
    }, 'Error handling ping'),
  );

  // Register resource-related handlers
  registerResourceHandlers(outboundConns, inboundConn);

  // Register tool-related handlers
  registerToolHandlers(outboundConns, inboundConn, lazyLoadingOrchestrator);

  // Register prompt-related handlers
  registerPromptHandlers(outboundConns, inboundConn);

  // Register completion-related handlers
  registerCompletionHandlers(outboundConns, inboundConn);
}
