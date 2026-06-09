import {
  CreateMessageRequest,
  CreateMessageRequestSchema,
  ElicitRequest,
  ElicitRequestSchema,
  ListRootsRequest,
  ListRootsRequestSchema,
  PingRequestSchema,
  SetLevelRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus, InboundConnection, OutboundConnections } from '@src/core/types/index.js';
import logger, { setLogLevel } from '@src/logger/logger.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';
import { getRequestTimeout } from '@src/utils/core/timeoutUtils.js';

import { registerCompletionHandlers, registerPromptHandlers } from './promptRequestHandlers.js';
import {
  createCapabilityCatalogFromConnections,
  filterConnectionsForSession,
  getRequestSession,
  resolveOutboundConnection,
} from './requestHandlerUtils.js';
import { registerResourceHandlers } from './resourceRequestHandlers.js';
import { registerToolHandlers } from './toolRequestHandlers.js';

export {
  createCapabilityCatalogFromConnections,
  filterConnectionsForSession,
  getRequestSession,
  resolveOutboundConnection,
};

/**
 * Type for extended server capabilities that include experimental features
 */
type ExtendedServerCapabilities = Record<string, unknown>;

/**
 * Registers server-specific request handlers
 * @param outboundConns Record of client instances
 * @param serverInfo The MCP server instance
 */
function registerServerRequestHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
  Array.from(outboundConns.entries()).forEach(([_, outboundConn]) => {
    const capabilities = outboundConn.capabilities as ExtendedServerCapabilities | undefined;

    // Ping is always supported
    outboundConn.client.setRequestHandler(
      PingRequestSchema,
      withErrorHandling(async () => {
        return ServerManager.current.executeServerOperation(inboundConn, (inboundConn: InboundConnection) =>
          inboundConn.server.ping(),
        );
      }, 'Error pinging'),
    );

    // Only register CreateMessage handler if server supports sampling capability
    if (capabilities?.sampling) {
      outboundConn.client.setRequestHandler(
        CreateMessageRequestSchema,
        withErrorHandling(async (request: CreateMessageRequest) => {
          return ServerManager.current.executeServerOperation(inboundConn, (inboundConn: InboundConnection) =>
            inboundConn.server.createMessage(request.params, {
              timeout: getRequestTimeout(outboundConn.transport),
            }),
          );
        }, 'Error creating message'),
      );
    }

    // Only register ElicitRequest handler if server supports elicitation capability
    if (capabilities?.elicitation) {
      outboundConn.client.setRequestHandler(
        ElicitRequestSchema,
        withErrorHandling(async (request: ElicitRequest) => {
          return ServerManager.current.executeServerOperation(inboundConn, (inboundConn: InboundConnection) =>
            inboundConn.server.elicitInput(request.params, {
              timeout: getRequestTimeout(outboundConn.transport),
            }),
          );
        }, 'Error eliciting input'),
      );
    }

    // Only register ListRoots handler if server supports roots capability
    if (capabilities?.roots) {
      outboundConn.client.setRequestHandler(
        ListRootsRequestSchema,
        withErrorHandling(async (request: ListRootsRequest) => {
          return ServerManager.current.executeServerOperation(inboundConn, (inboundConn: InboundConnection) =>
            inboundConn.server.listRoots(request.params, {
              timeout: getRequestTimeout(outboundConn.transport),
            }),
          );
        }, 'Error listing roots'),
      );
    }
  });
}

/**
 * Registers all request handlers based on available capabilities
 * @param clients Record of client instances
 * @param server The MCP server instance
 * @param capabilities The server capabilities
 * @param tags Array of tags to filter clients by
 */

export function registerRequestHandlers(
  outboundConns: OutboundConnections,
  inboundConn: InboundConnection,
  lazyLoadingOrchestrator?: LazyLoadingOrchestrator,
): void {
  // Register logging level handler
  inboundConn.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
    setLogLevel(request.params.level);
    return {};
  });

  // Register ping handler
  inboundConn.server.setRequestHandler(
    PingRequestSchema,
    withErrorHandling(async () => {
      // Health check all connected upstream clients
      const healthCheckPromises = Array.from(outboundConns.entries()).map(async ([clientName, outboundConn]) => {
        if (outboundConn.status === ClientStatus.Connected && outboundConn.client.transport) {
          try {
            await outboundConn.client.ping();
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

  // Register server-specific request handlers
  registerServerRequestHandlers(outboundConns, inboundConn);
}
