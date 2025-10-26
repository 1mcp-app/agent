/**
 * JSON-based tag query evaluator for MongoDB-like queries
 * Supports three-state tag selection: empty, selected, not selected
 */
import { TagQuery } from '@src/domains/preset/types/presetTypes.js';

/**
 * Three-state tag selection states
 */
export type TagState = 'empty' | 'selected' | 'not-selected';

/**
 * Tag selection entry for three-state system
 */
export interface TagSelection {
  tag: string;
  state: TagState;
  servers: string[]; // Servers that have this tag
}

export class TagQueryEvaluator {
  /**
   * Evaluate a JSON tag query against a set of server tags
   */
  public static evaluate(query: TagQuery, serverTags: string[]): boolean {
    if (!query || typeof query !== 'object') {
      return false;
    }

    // Handle simple tag match
    if (query.tag) {
      return serverTags.includes(query.tag);
    }

    // Handle $or operator
    if (query.$or && Array.isArray(query.$or)) {
      return query.$or.some((subQuery) => this.evaluate(subQuery, serverTags));
    }

    // Handle $and operator
    if (query.$and && Array.isArray(query.$and)) {
      return query.$and.every((subQuery) => this.evaluate(subQuery, serverTags));
    }

    // Handle $not operator
    if (query.$not) {
      return !this.evaluate(query.$not, serverTags);
    }

    // Handle $in operator
    if (query.$in && Array.isArray(query.$in)) {
      return query.$in.some((tag) => serverTags.includes(tag));
    }

    // Handle complex nested queries
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith('$')) {
        // Skip already handled operators
        continue;
      }

      if (key === 'tag') {
        // Already handled above
        continue;
      }

      // Handle field-specific operators
      if (typeof value === 'object' && value !== null) {
        const fieldObj = value as Record<string, unknown>;
        if (fieldObj.$in && Array.isArray(fieldObj.$in)) {
          return fieldObj.$in.some((tag): tag is string => typeof tag === 'string' && serverTags.includes(tag));
        }

        if (fieldObj.$not && typeof fieldObj.$not === 'string') {
          const fieldMatch = key === 'tag' ? serverTags.includes(fieldObj.$not) : false; // For now, only support 'tag' field
          return !fieldMatch;
        }
      }
    }

    return false;
  }

  /**
   * Convert string-based tag expression to JSON query
   * For backward compatibility with existing presets
   */
  public static stringToQuery(tagExpression: string, strategy: 'or' | 'and' | 'advanced' = 'or'): TagQuery {
    if (!tagExpression || typeof tagExpression !== 'string') {
      return {};
    }

    // Handle advanced expressions (for now, return as-is in a custom field)
    if (strategy === 'advanced') {
      return { $advanced: tagExpression };
    }

    // Parse simple comma-separated tags
    const tags = tagExpression
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (tags.length === 0) {
      return {};
    }

    if (tags.length === 1) {
      return { tag: tags[0] };
    }

    // Multiple tags
    if (strategy === 'and') {
      return {
        $and: tags.map((tag) => ({ tag })),
      };
    } else {
      // Default to 'or' strategy
      return {
        $or: tags.map((tag) => ({ tag })),
      };
    }
  }

  /**
   * Convert JSON query to human-readable string
   */
  public static queryToString(query: TagQuery): string {
    if (!query || typeof query !== 'object') {
      return '';
    }

    if (query.tag) {
      return query.tag;
    }

    if (query.$or && Array.isArray(query.$or)) {
      const parts = query.$or.map((subQuery) => this.queryToString(subQuery));
      return parts.join(' OR ');
    }

    if (query.$and && Array.isArray(query.$and)) {
      const parts = query.$and.map((subQuery) => this.queryToString(subQuery));
      return parts.join(' AND ');
    }

    if (query.$not) {
      return `NOT (${this.queryToString(query.$not)})`;
    }

    if (query.$in && Array.isArray(query.$in)) {
      return query.$in.join(', ');
    }

    if (query.$advanced) {
      return typeof query.$advanced === 'string' ? query.$advanced : JSON.stringify(query.$advanced);
    }

    // Handle complex nested queries
    const parts: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith('$') || key === 'tag') {
        continue;
      }

      if (typeof value === 'object' && value !== null) {
        const fieldObj = value as Record<string, unknown>;
        if (fieldObj.$in && Array.isArray(fieldObj.$in)) {
          const inValues = fieldObj.$in.filter((item): item is string => typeof item === 'string');
          parts.push(`${key}:(${inValues.join(', ')})`);
        } else if (fieldObj.$not && typeof fieldObj.$not === 'string') {
          parts.push(`NOT ${key}:${fieldObj.$not}`);
        }
      }
    }

    return parts.join(' AND ');
  }

  /**
   * Validate JSON query structure
   */
  public static validateQuery(query: TagQuery): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!query || typeof query !== 'object') {
      errors.push('Query must be an object');
      return { isValid: false, errors };
    }

    // Check for circular references or overly deep nesting
    try {
      JSON.stringify(query);
    } catch (_error) {
      errors.push('Query contains circular references or is too deep');
      return { isValid: false, errors };
    }

    // Validate operators
    if (query.$or && !Array.isArray(query.$or)) {
      errors.push('$or operator must be an array');
    }

    if (query.$and && !Array.isArray(query.$and)) {
      errors.push('$and operator must be an array');
    }

    if (query.$in && !Array.isArray(query.$in)) {
      errors.push('$in operator must be an array');
    }

    if (query.$not && typeof query.$not !== 'object') {
      errors.push('$not operator must be an object');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Build tag-to-servers mapping from MCP configuration
   */
  public static buildTagServerMap(servers: Record<string, { tags?: string[] }>): Map<string, string[]> {
    const tagServerMap = new Map<string, string[]>();

    for (const [serverName, serverConfig] of Object.entries(servers)) {
      const serverTags = serverConfig.tags || [];
      for (const tag of serverTags) {
        if (!tagServerMap.has(tag)) {
          tagServerMap.set(tag, []);
        }
        tagServerMap.get(tag)!.push(serverName);
      }
    }

    return tagServerMap;
  }

  /**
   * Convert three-state tag selections to TagQuery
   */
  public static buildQueryFromSelections(
    selections: TagSelection[],
    strategy: 'or' | 'and' | 'advanced' = 'or',
  ): TagQuery {
    const selectedTags = selections.filter((s) => s.state === 'selected');
    const notSelectedTags = selections.filter((s) => s.state === 'not-selected');

    if (selectedTags.length === 0 && notSelectedTags.length === 0) {
      return {};
    }

    const queries: TagQuery[] = [];

    // Handle selected tags
    if (selectedTags.length > 0) {
      if (selectedTags.length === 1) {
        queries.push({ tag: selectedTags[0].tag });
      } else if (strategy === 'and' || strategy === 'advanced') {
        // For advanced strategy, default to AND behavior for selected tags
        queries.push({ $and: selectedTags.map((s) => ({ tag: s.tag })) });
      } else {
        queries.push({ $or: selectedTags.map((s) => ({ tag: s.tag })) });
      }
    }

    // Handle not-selected tags (always AND with exclusions)
    for (const notSelected of notSelectedTags) {
      queries.push({ $not: { tag: notSelected.tag } });
    }

    if (queries.length === 1) {
      return queries[0];
    } else if (queries.length > 1) {
      // Combine selected and not-selected with AND
      return { $and: queries };
    }

    return {};
  }

  /**
   * Get servers that match the current tag selections
   */
  public static getMatchingServers(
    selections: TagSelection[],
    servers: Record<string, { tags?: string[] }>,
    strategy: 'or' | 'and' | 'advanced' = 'or',
  ): string[] {
    const query = this.buildQueryFromSelections(selections, strategy);

    return Object.entries(servers)
      .filter(([, serverConfig]) => {
        const serverTags = serverConfig.tags || [];
        return this.evaluate(query, serverTags);
      })
      .map(([serverName]) => serverName);
  }

  /**
   * Format server list for display (e.g., "server1, server2 +3 more")
   */
  public static formatServerList(servers: string[], maxDisplay: number = 3): string {
    if (servers.length === 0) {
      return 'none';
    }

    if (servers.length <= maxDisplay) {
      return servers.join(', ');
    }

    const displayed = servers.slice(0, maxDisplay);
    const remaining = servers.length - maxDisplay;
    return `${displayed.join(', ')} +${remaining} more`;
  }

  /**
   * Cycle tag state: empty -> selected -> not-selected -> empty
   */
  public static cycleTagState(currentState: TagState): TagState {
    switch (currentState) {
      case 'empty':
        return 'selected';
      case 'selected':
        return 'not-selected';
      case 'not-selected':
        return 'empty';
      default:
        return 'empty';
    }
  }

  /**
   * Get display symbol for tag state
   */
  public static getTagStateSymbol(state: TagState): string {
    switch (state) {
      case 'empty':
        return '○';
      case 'selected':
        return '✓';
      case 'not-selected':
        return '✗';
      default:
        return '○';
    }
  }

  /**
   * Get display color for tag state (for terminals that support colors)
   */
  public static getTagStateColor(state: TagState): string {
    switch (state) {
      case 'empty':
        return '\x1b[37m'; // White
      case 'selected':
        return '\x1b[32m'; // Green
      case 'not-selected':
        return '\x1b[31m'; // Red
      default:
        return '\x1b[0m'; // Reset
    }
  }
}
