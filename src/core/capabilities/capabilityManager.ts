import {
  setupClientToServerNotifications,
  setupServerToClientNotifications,
} from '@src/core/protocol/notificationHandlers.js';
import { registerRequestHandlers } from '@src/core/protocol/requestHandlers.js';
import { InboundConnection, OutboundConnections } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { LazyLoadingOrchestrator } from './lazyLoadingOrchestrator.js';

interface ServerCapabilitiesSnapshot {
  resources?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  prompts?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
  logging?: Record<string, unknown>;
}

/**
 * Collects capabilities from all clients and registers them with the server
 * @param clients Record of client instances
 * @param serverInfo The MCP server instance
 * @param tags Array of tags to filter clients by
 * @returns The combined server capabilities
 */
export async function setupCapabilities(
  clients: OutboundConnections,
  serverInfo: InboundConnection,
  lazyLoadingOrchestrator?: LazyLoadingOrchestrator,
) {
  // Collect capabilities from all clients
  const capabilities = collectCapabilities(clients);

  // Set up notification handlers
  if (!serverInfo.requestOnly) {
    await setupClientToServerNotifications(clients, serverInfo);
    setupServerToClientNotifications(clients, serverInfo);
  }

  // Register request handlers based on capabilities
  registerRequestHandlers(clients, serverInfo, lazyLoadingOrchestrator);

  return capabilities;
}

/**
 * Collects capabilities from all clients
 * @param clients Record of client instances
 * @returns The combined server capabilities
 */
function collectCapabilities(clients: OutboundConnections): ServerCapabilitiesSnapshot {
  const capabilities: ServerCapabilitiesSnapshot = {};

  for (const [name, clientInfo] of clients.entries()) {
    try {
      const serverCapabilities = (clientInfo.capabilities as ServerCapabilitiesSnapshot | undefined) || {};
      logger.debug('capabilityManager.capabilities.from.8e853808');

      // Store capabilities per client
      // Aggregate capabilities with conflict handling
      capabilities.resources = mergeCapabilities(
        capabilities.resources,
        serverCapabilities.resources,
        'resources',
        name,
        true, // Enable notification conflict logging for resources (subscribe, listChanged)
      );
      capabilities.tools = mergeCapabilities(
        capabilities.tools,
        serverCapabilities.tools,
        'tools',
        name,
        true, // Enable notification conflict logging for tools (listChanged)
      );
      capabilities.prompts = mergeCapabilities(
        capabilities.prompts,
        serverCapabilities.prompts,
        'prompts',
        name,
        true, // Enable notification conflict logging for prompts (listChanged)
      );
      capabilities.experimental = mergeCapabilities(
        capabilities.experimental,
        serverCapabilities.experimental,
        'experimental',
        name,
      );

      // Handle logging capability - simple replacement without conflict detection
      if (serverCapabilities.logging) {
        capabilities.logging = serverCapabilities.logging;
      }
    } catch (_error) {
      logger.error('capabilityManager.failed.to.get.capabilities.from.93e25efc', { error: _error });
    }
  }

  return capabilities;
}

/**
 * Check if a capability key represents a notification capability
 * Notification capabilities can be independently supported by multiple servers
 * @param key The capability key to check
 * @returns True if the key represents a notification capability
 */
function isNotificationCapability(key: string): boolean {
  return key === 'listChanged' || key === 'subscribe';
}

/**
 * Merges capability objects with conflict detection and resolution
 * @param existing The existing capability object
 * @param incoming The incoming capability object
 * @param capabilityType The type of capability being merged
 * @param clientName The name of the client providing the incoming capability
 * @param logNotificationConflicts Whether to log conflicts for notification capabilities
 * @returns The merged capability object
 */
function mergeCapabilities<T extends Record<string, unknown>>(
  existing: T | undefined,
  incoming: T | undefined,
  capabilityType: string,
  clientName: string,
  logNotificationConflicts: boolean = false,
): T | undefined {
  if (!incoming) {
    return existing;
  }

  if (!existing) {
    return incoming;
  }

  const merged = { ...existing };
  const conflicts: string[] = [];

  for (const [key, value] of Object.entries(incoming)) {
    if (key in existing) {
      // Special handling for notification capabilities
      if (isNotificationCapability(key)) {
        // Check if we should log conflicts for notification capabilities
        if (
          logNotificationConflicts &&
          JSON.stringify((existing as Record<string, unknown>)[key]) !== JSON.stringify(value)
        ) {
          conflicts.push(key);
          logger.warn('capabilityManager.capability.conflict.in.client.overriding.existing.value.fadeac61');
          logger.debug('capabilityManager.existing.new.9c54d92e');
        }

        // Use OR logic for boolean notification capabilities
        if (typeof value === 'boolean' && typeof (existing as Record<string, unknown>)[key] === 'boolean') {
          (merged as Record<string, unknown>)[key] = (existing as Record<string, unknown>)[key] || value;
        } else {
          (merged as Record<string, unknown>)[key] = value; // Non-boolean, use last value
        }
        continue; // Skip regular conflict detection (already handled above if needed)
      }

      // Check if values are different (potential conflict)
      if (JSON.stringify((existing as Record<string, unknown>)[key]) !== JSON.stringify(value)) {
        conflicts.push(key);
        logger.warn('capabilityManager.capability.conflict.in.client.overriding.existing.value.fadeac61');
        logger.debug('capabilityManager.existing.new.9c54d92e');
      }
    }
    (merged as Record<string, unknown>)[key] = value;
  }

  if (conflicts.length > 0) {
    logger.info('capabilityManager.client.has.capability.conflicts.439d33df');
  }

  return merged;
}
