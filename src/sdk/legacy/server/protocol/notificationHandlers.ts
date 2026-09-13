import { registerCapabilityPaginationNotifications } from '@src/core/capabilities/capabilityPagination.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { getRequestSession, resolveCapabilityVisibility } from '@src/core/protocol/requestHandlerUtils.js';
import { ClientStatus, InboundConnection, ServerStatus } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { toJsonValue } from '@src/sdk/contracts/index.js';
import {
  type LegacyOutboundConnections,
  setOutboundNotificationHandler,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import { projectResourceUri } from '@src/sdk/legacy/shared/resourceTemplateRouting.js';
import {
  CancelledNotificationSchema,
  LoggingMessageNotificationSchema,
  ProgressNotificationSchema,
  ResourceUpdatedNotificationSchema,
  RootsListChangedNotificationSchema,
} from '@src/sdk/legacy/types.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';

import {
  forwardScopedNotification,
  ownsActiveInteraction,
  registerLegacyNotificationOwner,
} from './requestInteractionScope.js';

function formatNotificationError(error: unknown): string {
  return error instanceof Error ? `Error: ${error.message}` : String(error);
}

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
    registerLegacyNotificationOwner(outboundConn, inboundConn);
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
            logger.error(`Failed to send notification from ${name}: ${formatNotificationError(error)}`);
          }
        }
      }, `Error handling client notification from ${name}`),
    );

    clientNotificationSchemas.forEach((schema) => {
      setOutboundNotificationHandler(
        outboundConn,
        schema,
        withErrorHandling(async (notification) => {
          if (
            notification.method === 'notifications/message' ||
            notification.method === 'notifications/progress' ||
            notification.method === 'notifications/cancelled'
          ) {
            await forwardScopedNotification(outboundConn, notification);
            return;
          }

          // Check if client is connected before attempting to send
          if (inboundConn.status !== ServerStatus.Connected || !getLegacyInboundServer(inboundConn).transport) {
            logger.warn(`Server transport not connected. Dropping notification from ${name}`);
            return;
          }

          // Try to send notification, catch connection errors gracefully
          try {
            let params = notification.params;
            if (notification.method === 'notifications/resources/updated') {
              const visibility = resolveCapabilityVisibility(
                outboundConns,
                inboundConn,
                getRequestSession(inboundConn),
                'resources',
              );
              if (!visibility.serverCandidates.has(name) || typeof params?.uri !== 'string') return;
              const snapshot = await acquireRuntimeCapabilityCatalog(outboundConns, visibility);
              if (snapshot.connections.get(name) !== outboundConn) return;
              params = { ...params, uri: projectResourceUri(snapshot, name, params.uri) };
            }
            // Preserve original message structure and only modify params
            const forwardedNotification = {
              method: notification.method,
              params: {
                ...params,
                server: name,
              },
            };
            await getLegacyInboundServer(inboundConn).notification(forwardedNotification);
          } catch (error) {
            if (error instanceof Error && error.message.includes('Not connected')) {
              logger.warn(`Server transport not connected. Dropping notification from ${name}`);
            } else {
              logger.error(`Failed to send notification from ${name}: ${formatNotificationError(error)}`);
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
  getLegacyInboundServer(inboundConn).setNotificationHandler(
    RootsListChangedNotificationSchema,
    async (notification) => {
      for (const connection of outboundConns.values()) {
        if (!ownsActiveInteraction(connection, inboundConn) || connection.status !== ClientStatus.Connected) continue;
        await connection.adapter.notify({
          method: notification.method,
          ...(notification.params === undefined ? {} : { params: toJsonValue(notification.params) }),
        });
      }
    },
  );
}
