import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { OutboundConnections, OutboundConnection, InboundConnectionConfig } from '../types/index.js';
import { ClientStatus } from '../types/client.js';
import { TagQueryParser, TagExpression } from '../../utils/tagQueryParser.js';
import { TagQueryEvaluator } from '../../utils/tagQueryEvaluator.js';
import { TagQuery } from '../../utils/presetTypes.js';
import { normalizeTag } from '../../utils/sanitization.js';
import logger from '../../logger/logger.js';

/**
 * Type definition for client filter functions
 */
export type ClientFilter = (clients: OutboundConnections) => OutboundConnections;

/**
 * Unified filtering service that consolidates all filtering logic across the application.
 * This service provides a single source of truth for filtering MCP server connections
 * based on various criteria including tags, capabilities, and advanced expressions.
 */
export class FilteringService {
  /**
   * Get filtered connections based on inbound connection configuration
   * This is the main entry point for filtering and should be used by most components
   *
   * @param connections Map of outbound connections to filter
   * @param config Inbound connection configuration containing filter criteria
   * @returns Filtered map of connections
   */
  public static getFilteredConnections(
    connections: OutboundConnections,
    config: InboundConnectionConfig,
  ): OutboundConnections {
    logger.debug('FilteringService: Filtering connections', {
      totalConnections: connections.size,
      filterMode: config.tagFilterMode,
      tags: config.tags,
      hasTagExpression: !!config.tagExpression,
      hasTagQuery: !!config.tagQuery,
    });

    // Only include connected clients in filtering
    const connectedClients = new Map<string, OutboundConnection>();
    for (const [name, connection] of connections) {
      if (connection.status === ClientStatus.Connected) {
        connectedClients.set(name, connection);
      }
    }

    logger.debug('FilteringService: Connected clients', {
      connectedCount: connectedClients.size,
      connectedNames: Array.from(connectedClients.keys()),
    });

    if (!config.tagFilterMode || config.tagFilterMode === 'none') {
      logger.debug('FilteringService: No filtering specified, returning all connected clients');
      return connectedClients;
    }

    const filter = this.createFilter(config);
    const filteredConnections = filter(connectedClients);

    logger.debug('FilteringService: Filtering completed', {
      filteredCount: filteredConnections.size,
      filteredNames: Array.from(filteredConnections.keys()),
    });

    return filteredConnections;
  }

  /**
   * Create a filter function based on inbound connection configuration
   *
   * @param config Inbound connection configuration
   * @returns Filter function that can be applied to connections
   */
  public static createFilter(config: InboundConnectionConfig): ClientFilter {
    if (config.tagFilterMode === 'preset' && config.tagQuery) {
      return this.byTagQuery(config.tagQuery);
    } else if (config.tagFilterMode === 'advanced' && config.tagExpression) {
      return this.byTagExpression(config.tagExpression);
    } else if (config.tagFilterMode === 'simple-or' || config.tags) {
      return this.byTags(config.tags);
    } else {
      // No filtering - return function that passes all clients through
      return this.byTags(undefined);
    }
  }

  /**
   * Filter connections by tags using OR logic
   * If no tags are provided, all connections are returned
   *
   * @param tags Array of tags to filter by
   * @returns Filter function
   */
  public static byTags(tags?: string[]): ClientFilter {
    return (connections: OutboundConnections) => {
      logger.debug(`FilteringService.byTags: Filtering for tags: ${tags ? tags.join(', ') : 'none'}`);

      if (!tags || tags.length === 0) {
        logger.debug('FilteringService.byTags: No tags specified, returning all connections');
        return connections;
      }

      // Normalize the filter tags for consistent comparison
      const normalizedFilterTags = tags.map((tag) => normalizeTag(tag));

      return Array.from(connections.entries()).reduce((filtered, [name, connection]) => {
        const clientTags = connection.transport.tags || [];
        // Normalize client tags for comparison
        const normalizedClientTags = clientTags.map((tag) => normalizeTag(tag));
        const hasMatchingTags = normalizedClientTags.some((clientTag) => normalizedFilterTags.includes(clientTag));

        logger.debug(`FilteringService.byTags: Connection ${name}`, {
          clientTags,
          normalizedClientTags,
          requiredTags: tags,
          normalizedRequiredTags: normalizedFilterTags,
          hasMatchingTags,
        });

        if (hasMatchingTags) {
          filtered.set(name, connection);
        }
        return filtered;
      }, new Map<string, OutboundConnection>());
    };
  }

  /**
   * Filter connections by advanced tag expression
   *
   * @param expression Parsed tag expression to evaluate
   * @returns Filter function
   */
  public static byTagExpression(expression: TagExpression): ClientFilter {
    return (connections: OutboundConnections) => {
      logger.debug(
        `FilteringService.byTagExpression: Filtering with expression: ${TagQueryParser.expressionToString(expression)}`,
      );

      return Array.from(connections.entries()).reduce((filtered, [name, connection]) => {
        const clientTags = connection.transport.tags || [];
        const matches = TagQueryParser.evaluate(expression, clientTags);

        logger.debug(`FilteringService.byTagExpression: Connection ${name}`, {
          clientTags,
          expression: TagQueryParser.expressionToString(expression),
          matches,
        });

        if (matches) {
          filtered.set(name, connection);
        }
        return filtered;
      }, new Map<string, OutboundConnection>());
    };
  }

  /**
   * Filter connections by MongoDB-style tag query
   *
   * @param query Tag query to evaluate
   * @returns Filter function
   */
  public static byTagQuery(query: TagQuery): ClientFilter {
    return (connections: OutboundConnections) => {
      logger.debug('FilteringService.byTagQuery: Filtering with tag query', { query });

      const filtered = new Map<string, OutboundConnection>();
      for (const [name, connection] of connections.entries()) {
        if (connection.status !== ClientStatus.Connected) {
          continue;
        }
        const clientTags = connection.transport.tags || [];

        try {
          if (TagQueryEvaluator.evaluate(query, clientTags)) {
            filtered.set(name, connection);
            logger.debug(`FilteringService.byTagQuery: Connection ${name} matches query`, {
              clientTags,
              query,
            });
          }
        } catch (error) {
          logger.warn(`FilteringService.byTagQuery: Failed to evaluate query for connection ${name}`, {
            error: error instanceof Error ? error.message : 'Unknown error',
            clientTags,
            query,
          });
        }
      }
      return filtered;
    };
  }

  /**
   * Filter connections by server capabilities
   *
   * @param requiredCapabilities Capabilities that must be present
   * @returns Filter function
   */
  public static byCapabilities(requiredCapabilities: ServerCapabilities): ClientFilter {
    return (connections: OutboundConnections) => {
      const requiredCaps = Object.keys(requiredCapabilities);
      logger.debug(`FilteringService.byCapabilities: Filtering for capabilities: ${requiredCaps.join(', ')}`);

      return Array.from(connections.entries()).reduce((filtered, [name, connection]) => {
        const clientCaps = connection.capabilities ? Object.keys(connection.capabilities) : [];
        const hasCapabilities = requiredCaps.every((cap) => connection.capabilities && cap in connection.capabilities);

        logger.debug(`FilteringService.byCapabilities: Connection ${name}`, {
          clientCapabilities: clientCaps,
          requiredCapabilities: requiredCaps,
          hasCapabilities,
          clientCapabilitiesObject: connection.capabilities,
        });

        if (hasCapabilities) {
          filtered.set(name, connection);
        }
        return filtered;
      }, new Map<string, OutboundConnection>());
    };
  }

  /**
   * Combine multiple filters using AND logic
   * All filters must pass for a connection to be included
   *
   * @param filters Array of filter functions to combine
   * @returns Combined filter function
   */
  public static combineFilters(...filters: ClientFilter[]): ClientFilter {
    return (connections: OutboundConnections) => {
      logger.debug(`FilteringService.combineFilters: Starting with ${connections.size} connections`, {
        connectionNames: Array.from(connections.keys()),
        filterCount: filters.length,
      });

      const result = filters.reduce((filteredConnections, filter, index) => {
        const beforeCount = filteredConnections.size;
        const afterFiltering = filter(filteredConnections);
        const afterCount = afterFiltering.size;

        logger.debug(
          `FilteringService.combineFilters: Filter ${index} reduced connections from ${beforeCount} to ${afterCount}`,
          {
            beforeNames: Array.from(filteredConnections.keys()),
            afterNames: Array.from(afterFiltering.keys()),
          },
        );

        return afterFiltering;
      }, connections);

      logger.debug(`FilteringService.combineFilters: Final result has ${result.size} connections`, {
        finalNames: Array.from(result.keys()),
      });

      return result;
    };
  }

  /**
   * Get a summary of filtering results for logging and debugging
   *
   * @param originalConnections Original connection map before filtering
   * @param filteredConnections Filtered connection map after filtering
   * @param config Filter configuration used
   * @returns Summary object with filtering statistics
   */
  public static getFilteringSummary(
    originalConnections: OutboundConnections,
    filteredConnections: OutboundConnections,
    config: InboundConnectionConfig,
  ): {
    original: number;
    filtered: number;
    removed: number;
    filterType: string;
    filteredNames: string[];
    removedNames: string[];
  } {
    const originalNames = Array.from(originalConnections.keys());
    const filteredNames = Array.from(filteredConnections.keys());
    const removedNames = originalNames.filter((name) => !filteredNames.includes(name));

    let filterType = 'none';
    if (config.tagFilterMode === 'preset') {
      filterType = 'preset';
    } else if (config.tagFilterMode === 'advanced') {
      filterType = 'advanced';
    } else if (config.tagFilterMode === 'simple-or' || config.tags) {
      filterType = 'simple-or';
    }

    return {
      original: originalConnections.size,
      filtered: filteredConnections.size,
      removed: removedNames.length,
      filterType,
      filteredNames: filteredNames.sort(),
      removedNames: removedNames.sort(),
    };
  }
}
