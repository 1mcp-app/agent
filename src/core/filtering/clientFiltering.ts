import { OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import { TagExpression, TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import logger, { debugIf } from '@src/logger/logger.js';
import type { ServerCapabilities } from '@src/sdk/contracts/index.js';
import { normalizeTag } from '@src/utils/validation/sanitization.js';

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
    const clientTags = clientInfo.tags;
    // Normalize client tags for comparison
    const normalizedClientTags = clientTags.map((tag) => normalizeTag(tag));
    const hasMatchingTags = normalizedClientTags.some((clientTag) => normalizedFilterTags.includes(clientTag));

    if (hasMatchingTags) {
      filteredClients.set(name, clientInfo);
      matchedClients++;
    }
  }

  if (matchedClients === 0) {
    logger.warn('clientFiltering.no.clients.found.matching.tags.efabd164');
  } else {
    debugIf(() => ({ message: 'clientFiltering.found.clients.matching.tags.8f0d8fc9' }));
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
    logger.warn('clientFiltering.no.clients.found.matching.capabilities.75ce4ab3');
  } else {
    debugIf(() => ({ message: 'clientFiltering.found.clients.matching.capabilities.1a19e976' }));
  }

  return filteredClients;
}

export type ClientFilter = (clients: OutboundConnections) => OutboundConnections;

/**
 * Filters clients by multiple criteria
 * @param filters Array of client filters
 * @returns Filtered record of client instances
 */
export function filterClients(...filters: ClientFilter[]): ClientFilter {
  return (clients: OutboundConnections) => {
    debugIf(() => ({
      message: 'clientFiltering.filterclients.starting.with.clients.217d7452',
      meta: { filterCount: filters.length },
    }));

    const result = filters.reduce((filteredClients, filter, _index) => {
      const afterFiltering = filter(filteredClients);

      debugIf(() => ({ message: 'clientFiltering.filterclients.filter.reduced.clients.from.to.0ecf1f7d' }));

      return afterFiltering;
    }, clients);

    debugIf(() => ({ message: 'clientFiltering.filterclients.final.result.has.clients.48240deb' }));

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
    debugIf(() => ({ message: 'clientFiltering.bycapabilities.filtering.for.capabilities.5aa9f27d' }));

    return Array.from(clients.entries()).reduce((filtered, [name, clientInfo]) => {
      const hasCapabilities = requiredCaps.every((cap) => clientInfo.capabilities && cap in clientInfo.capabilities);

      debugIf(() => ({ message: 'clientFiltering.bycapabilities.client.4b06a55f' }));

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
    debugIf(() => ({ message: 'clientFiltering.bytags.filtering.for.tags.6b4e9940' }));

    if (!tags || tags.length === 0) {
      debugIf('clientFiltering.bytags.no.tags.specified.returning.all.clients.4dba46f9');
      return clients;
    }

    // Normalize the filter tags for consistent comparison
    const normalizedFilterTags = tags.map((tag) => normalizeTag(tag));

    return Array.from(clients.entries()).reduce((filtered, [name, clientInfo]) => {
      const clientTags = clientInfo.tags;
      // Normalize client tags for comparison
      const normalizedClientTags = clientTags.map((tag) => normalizeTag(tag));
      const hasMatchingTags = normalizedClientTags.some((clientTag) => normalizedFilterTags.includes(clientTag));

      debugIf(() => ({ message: 'clientFiltering.bytags.client.5d287ddb' }));

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
    debugIf(() => ({ message: 'clientFiltering.bytagexpression.filtering.with.expression.dfc5da28' }));

    return Array.from(clients.entries()).reduce((filtered, [name, clientInfo]) => {
      const clientTags = clientInfo.tags;
      const matches = TagQueryParser.evaluate(expression, clientTags);

      debugIf(() => ({ message: 'clientFiltering.bytagexpression.client.9d7a0de8' }));

      if (matches) {
        filtered.set(name, clientInfo);
      }
      return filtered;
    }, new Map<string, OutboundConnection>());
  };
}
