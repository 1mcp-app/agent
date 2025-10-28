import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

import {
  setupClientToServerNotifications,
  setupServerToClientNotifications,
} from '@src/core/protocol/notificationHandlers.js';
import { registerRequestHandlers } from '@src/core/protocol/requestHandlers.js';
import { InboundConnection, OutboundConnections } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

/**
 * Collects capabilities from all clients and registers them with the server
 * @param clients Record of client instances
 * @param server The MCP server instance
 * @param tags Array of tags to filter clients by
 * @returns The combined server capabilities
 */
export async function setupCapabilities(clients: OutboundConnections, serverInfo: InboundConnection) {
  // Collect capabilities from all clients
  const capabilities = collectCapabilities(clients);

  // Set up notification handlers
  setupClientToServerNotifications(clients, serverInfo);
  setupServerToClientNotifications(clients, serverInfo);

  // Register request handlers based on capabilities
  registerRequestHandlers(clients, serverInfo);

  return capabilities;
}

/**
 * Collects capabilities from all clients
 * @param clients Record of client instances
 * @returns The combined server capabilities
 */
function collectCapabilities(clients: OutboundConnections): ServerCapabilities {
  const capabilities: ServerCapabilities = {};

  for (const [name, clientInfo] of clients.entries()) {
    try {
      const serverCapabilities = clientInfo.client.getServerCapabilities() || {};
      logger.debug(`Capabilities from ${name}: ${JSON.stringify(serverCapabilities)}`);

      // Store capabilities per client
      clientInfo.capabilities = serverCapabilities;

      // Aggregate capabilities with conflict handling
      capabilities.resources = mergeCapabilities(
        capabilities.resources,
        serverCapabilities.resources,
        'resources',
        name,
      );
      capabilities.tools = mergeCapabilities(capabilities.tools, serverCapabilities.tools, 'tools', name);
      capabilities.prompts = mergeCapabilities(capabilities.prompts, serverCapabilities.prompts, 'prompts', name);
      capabilities.experimental = mergeCapabilities(
        capabilities.experimental,
        serverCapabilities.experimental,
        'experimental',
        name,
      );
      capabilities.logging = mergeCapabilities(capabilities.logging, serverCapabilities.logging, 'logging', name);
    } catch (error) {
      logger.error(`Failed to get capabilities from ${name}: ${error}`);
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
 * @returns The merged capability object
 */
function mergeCapabilities<T extends Record<string, unknown>>(
  existing: T | undefined,
  incoming: T | undefined,
  capabilityType: string,
  clientName: string,
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
        // Use OR logic for boolean notification capabilities
        if (typeof value === 'boolean' && typeof (existing as Record<string, unknown>)[key] === 'boolean') {
          (merged as Record<string, unknown>)[key] = (existing as Record<string, unknown>)[key] || value;
        } else {
          (merged as Record<string, unknown>)[key] = value; // Non-boolean, use last value
        }
        continue; // Skip conflict logging
      }

      // Check if values are different (potential conflict)
      if (JSON.stringify((existing as Record<string, unknown>)[key]) !== JSON.stringify(value)) {
        conflicts.push(key);
        logger.warn(`Capability conflict in ${capabilityType}.${key}: client ${clientName} overriding existing value`);
        logger.debug(
          `Existing: ${JSON.stringify((existing as Record<string, unknown>)[key])}, New: ${JSON.stringify(value)}`,
        );
      }
    }
    (merged as Record<string, unknown>)[key] = value;
  }

  if (conflicts.length > 0) {
    logger.info(
      `Client ${clientName} has ${conflicts.length} ${capabilityType} capability conflicts: ${conflicts.join(', ')}`,
    );
  }

  return merged;
}
