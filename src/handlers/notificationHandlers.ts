import {
  CancelledNotificationSchema,
  ProgressNotificationSchema,
  LoggingMessageNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  InitializedNotificationSchema,
  RootsListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import logger from '@src/logger/logger.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';
import { OutboundConnections, InboundConnection, ClientStatus, ServerStatus } from '@src/core/types/index.js';
/**
 * Sets up client-to-server notification handlers
 * @param clients Record of client instances
 * @param serverInfo The MCP server instance
 */
export function setupClientToServerNotifications(
  outboundConns: OutboundConnections,
  inboundConn: InboundConnection,
): void {
  const clientNotificationSchemas = [
    CancelledNotificationSchema,
    ProgressNotificationSchema,
    LoggingMessageNotificationSchema,
    ResourceUpdatedNotificationSchema,
    ResourceListChangedNotificationSchema,
    ToolListChangedNotificationSchema,
    PromptListChangedNotificationSchema,
  ];

  for (const [name, outboundConn] of outboundConns.entries()) {
    clientNotificationSchemas.forEach((schema) => {
      outboundConn.client.setNotificationHandler(
        schema,
        withErrorHandling(async (notification) => {
          logger.info(`Received notification in client: ${name} ${JSON.stringify(notification)}`);

          // Check if client is connected before attempting to send
          if (inboundConn.status !== ServerStatus.Connected || !inboundConn.server.transport) {
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
            inboundConn.server.notification(forwardedNotification);
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
  outboundConns: OutboundConnections,
  inboundConn: InboundConnection,
): void {
  const serverNotificationSchemas = [
    CancelledNotificationSchema,
    ProgressNotificationSchema,
    InitializedNotificationSchema,
    RootsListChangedNotificationSchema,
  ];

  for (const [name, outboundConn] of outboundConns.entries()) {
    serverNotificationSchemas.forEach((schema) => {
      inboundConn.server.setNotificationHandler(
        schema,
        withErrorHandling(async (notification) => {
          logger.info(`Received notification in server: ${name} ${JSON.stringify(notification)}`);
          if (outboundConn.status !== ClientStatus.Connected || !outboundConn.client.transport) {
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
            outboundConn.client.notification(forwardedNotification);
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
