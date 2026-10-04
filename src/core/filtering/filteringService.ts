import { ClientStatus } from '@src/core/types/client.js';
import { InboundConnectionConfig, OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { TagExpression, TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import { TagQuery } from '@src/domains/preset/types/presetTypes.js';
import logger, { debugIf } from '@src/logger/logger.js';
import type { ServerCapabilities } from '@src/sdk/contracts/index.js';
import { normalizeTag } from '@src/utils/validation/sanitization.js';

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
    debugIf(() => ({ message: 'filteringService.filteringservice.filtering.connections.0b15644d' }));

    // Only include connected clients in filtering
    const connectedClients = new Map<string, OutboundConnection>();
    for (const [name, connection] of connections) {
      if (connection.status === ClientStatus.Connected) {
        connectedClients.set(name, connection);
      }
    }

    debugIf(() => ({
      message: 'filteringService.filteringservice.connected.clients.4f0827db',
      meta: { connectedCount: connectedClients.size },
    }));

    if (!config.tagFilterMode || config.tagFilterMode === 'none') {
      debugIf('filteringService.filteringservice.no.filtering.specified.returning.all.connected.clients.c197a274');
      return connectedClients;
    }

    const filter = this.createFilter(config);
    const filteredConnections = filter(connectedClients);

    debugIf(() => ({
      message: 'filteringService.filteringservice.filtering.completed.e2b35696',
      meta: { filteredCount: filteredConnections.size },
    }));

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
      debugIf(() => ({ message: 'filteringService.filteringservice.bytags.filtering.for.tags.1d7c85c5' }));

      if (!tags || tags.length === 0) {
        debugIf('filteringService.filteringservice.bytags.no.tags.specified.returning.all.connections.718dca0c');
        return connections;
      }

      // Normalize the filter tags for consistent comparison
      const normalizedFilterTags = tags.map((tag) => normalizeTag(tag));

      return Array.from(connections.entries()).reduce((filtered, [name, connection]) => {
        const clientTags = connection.tags;
        // Normalize client tags for comparison
        const normalizedClientTags = clientTags.map((tag) => normalizeTag(tag));
        const hasMatchingTags = normalizedClientTags.some((clientTag) => normalizedFilterTags.includes(clientTag));

        debugIf(() => ({ message: 'filteringService.filteringservice.bytags.connection.87681228' }));

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
      debugIf(() => ({
        message: 'filteringService.filteringservice.bytagexpression.filtering.with.expression.edcca341',
      }));

      return Array.from(connections.entries()).reduce((filtered, [name, connection]) => {
        const clientTags = connection.tags;
        const matches = TagQueryParser.evaluate(expression, clientTags);

        debugIf(() => ({ message: 'filteringService.filteringservice.bytagexpression.connection.782bff76' }));

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
      debugIf(() => ({ message: 'filteringService.filteringservice.bytagquery.filtering.with.tag.query.c1767066' }));

      const filtered = new Map<string, OutboundConnection>();
      for (const [name, connection] of connections.entries()) {
        if (connection.status !== ClientStatus.Connected) {
          continue;
        }
        const clientTags = connection.tags;

        try {
          if (TagQueryEvaluator.evaluate(query, clientTags)) {
            filtered.set(name, connection);
            debugIf(() => ({
              message: 'filteringService.filteringservice.bytagquery.connection.matches.query.9a48d2c4',
            }));
          }
        } catch (error) {
          logger.warn('filteringService.filteringservice.bytagquery.failed.to.evaluate.query.for.connection.ec67443f', {
            error: error,
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
      debugIf(() => ({
        message: 'filteringService.filteringservice.bycapabilities.filtering.for.capabilities.3676f48d',
      }));

      return Array.from(connections.entries()).reduce((filtered, [name, connection]) => {
        const hasCapabilities = requiredCaps.every((cap) => connection.capabilities && cap in connection.capabilities);

        debugIf(() => ({ message: 'filteringService.filteringservice.bycapabilities.connection.e77084c0' }));

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
      debugIf(() => ({
        message: 'filteringService.filteringservice.combinefilters.starting.with.connections.bcec49f2',
        meta: { filterCount: filters.length },
      }));

      const result = filters.reduce((filteredConnections, filter, _index) => {
        const afterFiltering = filter(filteredConnections);

        debugIf(() => ({
          message: 'filteringService.filteringservice.combinefilters.filter.reduced.connections.from.to.d4ebcf5e',
        }));

        return afterFiltering;
      }, connections);

      debugIf(() => ({
        message: 'filteringService.filteringservice.combinefilters.final.result.has.connections.b44a70ab',
      }));

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
