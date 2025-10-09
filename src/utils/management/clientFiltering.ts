import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { OutboundConnections, OutboundConnection } from '@src/core/types/index.js';
import { TagQueryParser, TagExpression } from '@src/utils/parsing/tagQueryParser.js';
import { normalizeTag } from '@src/utils/validation/sanitization.js';
import logger, { debugIf } from '@src/logger/logger.js';

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

  // Normalize the filter tags for consistent comparison
  const normalizedFilterTags = tags.map((tag) => normalizeTag(tag));

  for (const [name, clientInfo] of clients.entries()) {
    const clientTags = clientInfo.transport.tags || [];
    // Normalize client tags for comparison
    const normalizedClientTags = clientTags.map((tag) => normalizeTag(tag));
    const hasMatchingTags = normalizedClientTags.some((clientTag) => normalizedFilterTags.includes(clientTag));

    if (hasMatchingTags) {
      filteredClients.set(name, clientInfo);
      matchedClients++;
    }
  }

  if (matchedClients === 0) {
    logger.warn(`No clients found matching tags: ${tags.join(', ')}`);
  } else {
    debugIf(() => ({
      message: `Found ${matchedClients} clients matching tags: ${tags.join(', ')}`,
      meta: { matchedClients, tags },
    }));
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
    debugIf(() => ({
      message: `Found ${matchedClients} clients matching capabilities: ${JSON.stringify(capabilities)}`,
      meta: { matchedClients, capabilities },
    }));
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
    debugIf(() => ({
      message: `filterClients: Starting with ${clients.size} clients`,
      meta: {
        clientNames: Array.from(clients.keys()),
        filterCount: filters.length,
      },
    }));

    const result = filters.reduce((filteredClients, filter, index) => {
      const beforeCount = filteredClients.size;
      const afterFiltering = filter(filteredClients);
      const afterCount = afterFiltering.size;

      debugIf(() => ({
        message: `filterClients: Filter ${index} reduced clients from ${beforeCount} to ${afterCount}`,
        meta: {
          beforeNames: Array.from(filteredClients.keys()),
          afterNames: Array.from(afterFiltering.keys()),
        },
      }));

      return afterFiltering;
    }, clients);

    debugIf(() => ({
      message: `filterClients: Final result has ${result.size} clients`,
      meta: { finalNames: Array.from(result.keys()) },
    }));

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
    debugIf(() => ({
      message: `byCapabilities: Filtering for capabilities: ${requiredCaps.join(', ')}`,
      meta: { requiredCaps },
    }));

    return Array.from(clients.entries()).reduce((filtered, [name, clientInfo]) => {
      const clientCaps = clientInfo.capabilities ? Object.keys(clientInfo.capabilities) : [];
      const hasCapabilities = requiredCaps.every((cap) => clientInfo.capabilities && cap in clientInfo.capabilities);

      debugIf(() => ({
        message: `byCapabilities: Client ${name}`,
        meta: {
          clientCapabilities: clientCaps,
          requiredCapabilities: requiredCaps,
          hasCapabilities,
          clientCapabilitiesObject: clientInfo.capabilities,
        },
      }));

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
    debugIf(() => ({ message: `byTags: Filtering for tags: ${tags ? tags.join(', ') : 'none'}`, meta: { tags } }));

    if (!tags || tags.length === 0) {
      debugIf('byTags: No tags specified, returning all clients');
      return clients;
    }

    // Normalize the filter tags for consistent comparison
    const normalizedFilterTags = tags.map((tag) => normalizeTag(tag));

    return Array.from(clients.entries()).reduce((filtered, [name, clientInfo]) => {
      const clientTags = clientInfo.transport.tags || [];
      // Normalize client tags for comparison
      const normalizedClientTags = clientTags.map((tag) => normalizeTag(tag));
      const hasMatchingTags = normalizedClientTags.some((clientTag) => normalizedFilterTags.includes(clientTag));

      debugIf(() => ({
        message: `byTags: Client ${name}`,
        meta: {
          clientTags,
          normalizedClientTags,
          requiredTags: tags,
          normalizedRequiredTags: normalizedFilterTags,
          hasMatchingTags,
        },
      }));

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
    debugIf(() => ({
      message: `byTagExpression: Filtering with expression: ${TagQueryParser.expressionToString(expression)}`,
      meta: { expression },
    }));

    return Array.from(clients.entries()).reduce((filtered, [name, clientInfo]) => {
      const clientTags = clientInfo.transport.tags || [];
      const matches = TagQueryParser.evaluate(expression, clientTags);

      debugIf(() => ({
        message: `byTagExpression: Client ${name}`,
        meta: {
          clientTags,
          expression: TagQueryParser.expressionToString(expression),
          matches,
        },
      }));

      if (matches) {
        filtered.set(name, clientInfo);
      }
      return filtered;
    }, new Map<string, OutboundConnection>());
  };
}
