import { registerCapabilityPaginationNotifications } from '@src/core/capabilities/capabilityPagination.js';
import { ClientStatus, InboundConnection, ServerStatus } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { toJsonValue } from '@src/sdk/contracts/index.js';
import {
  type LegacyOutboundConnection,
  type LegacyOutboundConnections,
  setOutboundNotificationHandler,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import {
  applyModernCatalogCoverage,
  ensureModernSubscriptionCoverage,
  type ModernSubscriptionFilter,
} from '@src/sdk/legacy/client/runtime/modernSubscriptions.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import {
  CancelledNotificationSchema,
  LoggingMessageNotificationSchema,
  ProgressNotificationSchema,
  RootsListChangedNotificationSchema,
} from '@src/sdk/legacy/types.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';

import {
  forwardScopedNotification,
  ownsActiveInteraction,
  registerLegacyNotificationOwner,
} from './requestInteractionScope.js';
import {
  enqueueOwnedCatalogNotification,
  registerOwnedCatalogConnection,
  setupOwnedResourceNotifications,
} from './resourceSubscriptions.js';

function formatNotificationError(error: unknown): string {
  return error instanceof Error ? `Error: ${error.message}` : String(error);
}

/** Register only catalog coverage honored by the upstream, preserving other operations. */
async function setupCatalogCoverage(
  connections: LegacyOutboundConnections,
  inbound: InboundConnection,
  connection: LegacyOutboundConnection,
): Promise<void> {
  const kinds = ['tools', 'resources', 'prompts'] as const;
  if (connection.adapter.protocol?.era === 'modern') {
    const filter: ModernSubscriptionFilter = {};
    for (const kind of kinds) {
      if (inbound.subscriptionListKinds && !inbound.subscriptionListKinds.includes(kind)) continue;
      const capability = connection.capabilities?.[kind];
      if (!capability || typeof capability !== 'object' || Array.isArray(capability)) continue;
      if (capability.listChanged === true) filter[`${kind}ListChanged`] = true;
    }
    if (Object.keys(filter).length) {
      const adapter = connection.adapter;
      const accepted = await ensureModernSubscriptionCoverage(adapter, filter);
      applyModernCatalogCoverage(connection, adapter, filter, accepted);
    }
  }
  for (const kind of kinds) registerOwnedCatalogConnection(connections, inbound, connection, kind);
}

/**
 * Sets up client-to-server notification handlers
 * @param clients Record of client instances
 * @param serverInfo The MCP server instance
 */
export async function setupClientToServerNotifications(
  outboundConns: LegacyOutboundConnections,
  inboundConn: InboundConnection,
): Promise<void> {
  const coverage: Promise<void>[] = [];
  const clientNotificationSchemas = [
    CancelledNotificationSchema,
    ProgressNotificationSchema,
    LoggingMessageNotificationSchema,
  ];

  for (const [name, outboundConn] of outboundConns.entries()) {
    registerLegacyNotificationOwner(outboundConn, inboundConn);
    setupOwnedResourceNotifications(outboundConn);
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

        enqueueOwnedCatalogNotification(outboundConns, inboundConn, outboundConn, {
          method: notification.method,
          params: { ...notification.params, server: name },
        });
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
              logger.error(`Failed to send notification from ${name}: ${formatNotificationError(error)}`);
            }
          }
        }, `Error handling client notification from ${name}`),
      );
    });
    coverage.push(setupCatalogCoverage(outboundConns, inboundConn, outboundConn));
  }
  await Promise.all(coverage);
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
