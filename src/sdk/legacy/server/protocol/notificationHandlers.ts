import { registerCapabilityPaginationNotifications } from '@src/core/capabilities/capabilityPagination.js';
import { ClientStatus, InboundConnection, ServerStatus } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { toJsonValue } from '@src/sdk/contracts/index.js';
import {
  getLegacyTransport,
  type LegacyOutboundConnections,
  setOutboundNotificationHandler,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import {
  CancelledNotificationSchema,
  LoggingMessageNotificationSchema,
  ProgressNotificationSchema,
  ResourceUpdatedNotificationSchema,
  RootsListChangedNotificationSchema,
} from '@src/sdk/legacy/types.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';

/**
 * Sets up client-to-server notification handlers
 * @param clients Record of client instances
 * @param serverInfo The MCP server instance
 */
export function setupClientToServerNotifications(
  outboundConns: LegacyOutboundConnections,
  inboundConn: InboundConnection,
): void {
  const clientNotificationSchemas = [
    CancelledNotificationSchema,
    ProgressNotificationSchema,
    LoggingMessageNotificationSchema,
    ResourceUpdatedNotificationSchema,
  ];

  for (const [name, outboundConn] of outboundConns.entries()) {
    registerCapabilityPaginationNotifications(
      outboundConns,
      outboundConn,
      inboundConn,
      withErrorHandling(async (notification) => {
        logger.info(`Received notification in client: ${name} ${JSON.stringify(notification)}`);

        if (inboundConn.status !== ServerStatus.Connected || !getLegacyInboundServer(inboundConn).transport) {
          logger.warn(`Server transport not connected. Dropping notification from ${name}`);
          return;
        }

        try {
          await getLegacyInboundServer(inboundConn).notification({
            method: notification.method,
            params: {
              ...notification.params,
              server: name,
            },
          });
        } catch (error) {
          if (error instanceof Error && error.message.includes('Not connected')) {
            logger.warn(`Server transport not connected. Dropping notification from ${name}`);
          } else {
            logger.error(`Failed to send notification from ${name}: ${error}`);
          }
        }
      }, `Error handling client notification from ${name}`),
    );

    clientNotificationSchemas.forEach((schema) => {
      setOutboundNotificationHandler(
        outboundConn,
        schema,
        withErrorHandling(async (notification) => {
          logger.info(`Received notification in client: ${name} ${JSON.stringify(notification)}`);

          // Check if client is connected before attempting to send
          if (inboundConn.status !== ServerStatus.Connected || !getLegacyInboundServer(inboundConn).transport) {
            logger.warn(`Server transport not connected. Dropping notification from ${name}`);
            return;
          }

          // Try to send notification, catch connection errors gracefully
          try {
            // Preserve original message structure and only modify params
            const forwardedNotification = {
              method: notification.method,
              params: {
                ...notification.params,
                server: name,
              },
            };
            await getLegacyInboundServer(inboundConn).notification(forwardedNotification);
          } catch (error) {
            if (error instanceof Error && error.message.includes('Not connected')) {
              logger.warn(`Server transport not connected. Dropping notification from ${name}`);
            } else {
              logger.error(`Failed to send notification from ${name}: ${error}`);
            }
          }
        }, `Error handling client notification from ${name}`),
      );
    });
  }
}

/**
 * Sets up server-to-client notification handlers
 * @param clients Record of client instances
 * @param serverInfo The MCP server instance
 */
export function setupServerToClientNotifications(
  outboundConns: LegacyOutboundConnections,
  inboundConn: InboundConnection,
): void {
  // NOTE: InitializedNotificationSchema is intentionally excluded here.
  // The inbound client sends notifications/initialized to 1MCP as part of its
  // own session handshake. Forwarding it to already-connected downstream servers
  // causes them to re-enter initialization state, rejecting subsequent
  // tools/list and prompts/list with "method is invalid during session
  // initialization". See: https://github.com/1mcp-app/agent/issues/255
  const serverNotificationSchemas = [
    CancelledNotificationSchema,
    ProgressNotificationSchema,
    RootsListChangedNotificationSchema,
  ];

  for (const [name, outboundConn] of outboundConns.entries()) {
    serverNotificationSchemas.forEach((schema) => {
      getLegacyInboundServer(inboundConn).setNotificationHandler(
        schema,
        withErrorHandling(async (notification) => {
          logger.info(`Received notification in server: ${name} ${JSON.stringify(notification)}`);
          if (outboundConn.status !== ClientStatus.Connected || !getLegacyTransport(outboundConn)) {
            logger.warn(`Client ${name} is not connected. Notification not sent.`);
            return;
          }

          // Try to send notification, catch connection errors gracefully
          try {
            // Preserve original message structure and only modify params
            const forwardedNotification = {
              method: notification.method,
              params: {
                ...notification.params,
                client: name,
              },
            };
            await outboundConn.adapter.notify({
              method: forwardedNotification.method,
              params: toJsonValue(forwardedNotification.params),
            });
          } catch (error) {
            if (error instanceof Error && error.message.includes('Not connected')) {
              logger.warn(`Client ${name} transport not connected. Dropping notification.`);
            } else {
              logger.error(`Failed to send notification to ${name}: ${error}`);
            }
          }
        }, `Error handling server notification to ${name}`),
      );
    });
  }
}
