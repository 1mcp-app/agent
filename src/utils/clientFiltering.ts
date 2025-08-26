import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { OutboundConnections, OutboundConnection } from '../core/types/index.js';
import { TagQueryParser, TagExpression } from './tagQueryParser.js';
import logger from '../logger/logger.js';

/**
 * Filters clients by tags
 * @param clients Record of client instances
 * @param tags Array of tags to filter by
 * @returns Filtered record of client instances
 */
export function filterClientsByTags(clients: OutboundConnections, tags?: string[]): OutboundConnections {
  if (!tags || tags.length === 0) {
    return clients;
  }

  const filteredClients = new Map<string, OutboundConnection>();
  let matchedClients = 0;

  for (const [name, clientInfo] of clients.entries()) {
    const clientTags = clientInfo.transport.tags || [];
    const hasMatchingTags = clientTags.some((clientTag) => tags.includes(clientTag));

    if (hasMatchingTags) {
      filteredClients.set(name, clientInfo);
      matchedClients++;
    }
  }

  if (matchedClients === 0) {
    logger.warn(`No clients found matching tags: ${tags.join(', ')}`);
  } else {
    logger.debug(`Found ${matchedClients} clients matching tags: ${tags.join(', ')}`);
  }

  return filteredClients;
}

/**
 * Filters clients by capabilities
 * @param clients Record of client instances
 * @param capabilities Object containing capabilities to filter by
 * @returns Filtered record of client instances
 */
export function filterClientsByCapabilities(
  clients: OutboundConnections,
  capabilities: ServerCapabilities,
): OutboundConnections {
  const filteredClients = new Map<string, OutboundConnection>();
  let matchedClients = 0;

  for (const [name, clientInfo] of clients.entries()) {
    const clientCapabilities = clientInfo.capabilities || {};
    const hasMatchingCapabilities = Object.keys(capabilities).every((capability) => {
      const clientCapability = clientCapabilities[capability as keyof ServerCapabilities];
      return clientCapability !== undefined;
    });

    if (hasMatchingCapabilities) {
      filteredClients.set(name, clientInfo);
      matchedClients++;
    }
  }

  if (matchedClients === 0) {
    logger.warn(`No clients found matching capabilities: ${JSON.stringify(capabilities)}`);
  } else {
    logger.debug(`Found ${matchedClients} clients matching capabilities: ${JSON.stringify(capabilities)}`);
  }

  return filteredClients;
}

type ClientFilter = (clients: OutboundConnections) => OutboundConnections;

/**
 * Filters clients by multiple criteria
 * @param filters Array of client filters
 * @returns Filtered record of client instances
 */
export function filterClients(...filters: ClientFilter[]): ClientFilter {
  return (clients: OutboundConnections) => {
    logger.debug(`filterClients: Starting with ${clients.size} clients`, {
      clientNames: Array.from(clients.keys()),
      filterCount: filters.length,
    });

    const result = filters.reduce((filteredClients, filter, index) => {
      const beforeCount = filteredClients.size;
      const afterFiltering = filter(filteredClients);
      const afterCount = afterFiltering.size;

      logger.debug(`filterClients: Filter ${index} reduced clients from ${beforeCount} to ${afterCount}`, {
        beforeNames: Array.from(filteredClients.keys()),
        afterNames: Array.from(afterFiltering.keys()),
      });

      return afterFiltering;
    }, clients);

    logger.debug(`filterClients: Final result has ${result.size} clients`, {
      finalNames: Array.from(result.keys()),
    });

    return result;
  };
}

/**
 * Filters clients by capabilities
 * @param requiredCapabilities Object containing capabilities to filter by
 * @returns Filtered record of client instances
 */
export function byCapabilities(requiredCapabilities: ServerCapabilities): ClientFilter {
  return (clients: OutboundConnections) => {
    const requiredCaps = Object.keys(requiredCapabilities);
    logger.debug(`byCapabilities: Filtering for capabilities: ${requiredCaps.join(', ')}`);

    return Array.from(clients.entries()).reduce((filtered, [name, clientInfo]) => {
      const clientCaps = clientInfo.capabilities ? Object.keys(clientInfo.capabilities) : [];
      const hasCapabilities = requiredCaps.every((cap) => clientInfo.capabilities && cap in clientInfo.capabilities);

      logger.debug(`byCapabilities: Client ${name}`, {
        clientCapabilities: clientCaps,
        requiredCapabilities: requiredCaps,
        hasCapabilities,
        clientCapabilitiesObject: clientInfo.capabilities,
      });

      if (hasCapabilities) {
        filtered.set(name, clientInfo);
      }
      return filtered;
    }, new Map<string, OutboundConnection>());
  };
}

/**
 * Filters clients by tags using OR logic (backward compatible)
 * @param tags Array of tags to filter by
 * @returns Filtered record of client instances
 */
export function byTags(tags?: string[]): ClientFilter {
  return (clients: OutboundConnections) => {
    logger.debug(`byTags: Filtering for tags: ${tags ? tags.join(', ') : 'none'}`);

    if (!tags || tags.length === 0) {
      logger.debug('byTags: No tags specified, returning all clients');
      return clients;
    }

    return Array.from(clients.entries()).reduce((filtered, [name, clientInfo]) => {
      const clientTags = clientInfo.transport.tags || [];
      const hasMatchingTags = clientTags.some((clientTag) => tags.includes(clientTag));

      logger.debug(`byTags: Client ${name}`, {
        clientTags,
        requiredTags: tags,
        hasMatchingTags,
      });

      if (hasMatchingTags) {
        filtered.set(name, clientInfo);
      }
      return filtered;
    }, new Map<string, OutboundConnection>());
  };
}

/**
 * Filters clients by advanced tag expression (new)
 * @param expression Parsed tag expression to evaluate
 * @returns Filtered record of client instances
 */
export function byTagExpression(expression: TagExpression): ClientFilter {
  return (clients: OutboundConnections) => {
    logger.debug(`byTagExpression: Filtering with expression: ${TagQueryParser.expressionToString(expression)}`);

    return Array.from(clients.entries()).reduce((filtered, [name, clientInfo]) => {
      const clientTags = clientInfo.transport.tags || [];
      const matches = TagQueryParser.evaluate(expression, clientTags);

      logger.debug(`byTagExpression: Client ${name}`, {
        clientTags,
        expression: TagQueryParser.expressionToString(expression),
        matches,
      });

      if (matches) {
        filtered.set(name, clientInfo);
      }
      return filtered;
    }, new Map<string, OutboundConnection>());
  };
}
