import { RegistryServer } from '../core/registry/types.js';

/**
 * Search and filtering utilities for MCP servers
 */
export class SearchEngine {
  /**
   * Perform fuzzy search on server name and description
   */
  fuzzySearch(query: string, servers: RegistryServer[]): RegistryServer[] {
    if (!query.trim()) {
      return servers;
    }

    const normalizedQuery = query.toLowerCase().trim();
    const queryWords = normalizedQuery.split(/\s+/);

    return servers
      .map((server) => ({
        server,
        score: this.calculateRelevanceScore(server, normalizedQuery, queryWords),
      }))
      .filter(({ score }) => score > 10) // Higher threshold for matches
      .sort((a, b) => b.score - a.score)
      .map(({ server }) => server);
  }

  /**
   * Filter servers by status
   */
  filterByStatus(servers: RegistryServer[], status: string): RegistryServer[] {
    if (!status || status === 'all') {
      return servers;
    }
    return servers.filter((server) => server.status === status);
  }

  /**
   * Filter servers by registry type
   */
  filterByRegistryType(servers: RegistryServer[], type: string): RegistryServer[] {
    if (!type) {
      return servers;
    }
    // Since new schema doesn't have registry_type, return all servers
    return servers;
  }

  /**
   * Filter servers by transport method
   */
  filterByTransport(servers: RegistryServer[], transport: string): RegistryServer[] {
    if (!transport) {
      return servers;
    }
    return servers.filter(
      (server) =>
        (server.remotes && server.remotes.some((remote) => remote.type === transport)) ||
        (server.packages && server.packages.some((pkg) => pkg.transport === transport)),
    );
  }

  /**
   * Rank search results by relevance and recency
   */
  rankResults(servers: RegistryServer[], query?: string): RegistryServer[] {
    if (!query) {
      // Sort by update recency if no query
      return servers.sort(
        (a, b) =>
          new Date(b._meta['io.modelcontextprotocol.registry/official'].updated_at).getTime() -
          new Date(a._meta['io.modelcontextprotocol.registry/official'].updated_at).getTime(),
      );
    }

    // Use fuzzy search which already includes ranking
    return this.fuzzySearch(query, servers);
  }

  /**
   * Calculate relevance score for a server against a search query
   */
  private calculateRelevanceScore(server: RegistryServer, normalizedQuery: string, queryWords: string[]): number {
    let score = 0;
    const name = server.name.toLowerCase();
    const description = server.description.toLowerCase();

    // Exact name match gets highest score
    if (name === normalizedQuery) {
      score += 100;
    } else if (name.includes(normalizedQuery)) {
      // Name contains full query
      score += 50;
    } else if (description.includes(normalizedQuery)) {
      // Description contains full query
      score += 30;
    } else {
      // Score for individual word matches (only if no full match found)
      let nameWordMatches = 0;
      let descWordMatches = 0;

      queryWords.forEach((word) => {
        if (name.includes(word)) {
          score += 20;
          nameWordMatches++;
        }
        if (description.includes(word)) {
          score += 10;
          descWordMatches++;
        }
      });

      // Bonus for matching multiple words - prioritize better matches
      if (nameWordMatches > 1) {
        score += nameWordMatches * 10; // Bonus for multiple name word matches
      }
      if (descWordMatches > 1) {
        score += descWordMatches * 5; // Bonus for multiple description word matches
      }

      // Only give fuzzy points if there are some exact word matches
      if (nameWordMatches > 0 || descWordMatches > 0) {
        score += this.calculateFuzzyScore(name, normalizedQuery) * 2;
        score += this.calculateFuzzyScore(description, normalizedQuery) * 1;
      }
    }

    // Only apply multipliers if we have a base score
    if (score > 0) {
      // Boost active servers, penalize deprecated ones
      if (server.status === 'active') {
        score *= 1.3;
      } else if (server.status === 'deprecated') {
        score *= 0.5; // Heavy penalty for deprecated servers
      }

      // Boost recently updated servers (within last 6 months)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      if (new Date(server._meta['io.modelcontextprotocol.registry/official'].updated_at) > sixMonthsAgo) {
        score *= 1.2;
      }

      // Boost latest versions
      if (server._meta['io.modelcontextprotocol.registry/official'].is_latest) {
        score *= 1.1;
      }
    }

    return Math.round(score);
  }

  /**
   * Calculate fuzzy matching score using simplified Levenshtein approach
   */
  private calculateFuzzyScore(text: string, query: string): number {
    if (text === query) return 10;
    if (text.includes(query)) return 8;

    let matches = 0;
    const queryChars = query.split('');
    const textChars = text.split('');

    queryChars.forEach((char) => {
      if (textChars.includes(char)) {
        matches++;
      }
    });

    return (matches / query.length) * 5;
  }

  /**
   * Apply all filters and search to a server list
   */
  applyFilters(
    servers: RegistryServer[],
    options: {
      query?: string;
      status?: string;
      registry_type?: string;
      transport?: string;
    },
  ): RegistryServer[] {
    let filtered = servers;

    // Apply filters
    if (options.status) {
      filtered = this.filterByStatus(filtered, options.status);
    }

    if (options.registry_type) {
      filtered = this.filterByRegistryType(filtered, options.registry_type);
    }

    if (options.transport) {
      filtered = this.filterByTransport(filtered, options.transport);
    }

    // Apply search and ranking
    if (options.query) {
      filtered = this.fuzzySearch(options.query, filtered);
    } else {
      filtered = this.rankResults(filtered);
    }

    return filtered;
  }
}

/**
 * Create a search engine instance
 */
export function createSearchEngine(): SearchEngine {
  return new SearchEngine();
}
