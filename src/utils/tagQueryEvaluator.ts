/**
 * JSON-based tag query evaluator for MongoDB-like queries
 */

import { TagQuery } from './presetTypes.js';

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
        if (value.$in && Array.isArray(value.$in)) {
          return value.$in.some((tag: string) => serverTags.includes(tag));
        }

        if (value.$not) {
          const fieldMatch = key === 'tag' ? serverTags.includes(value.$not) : false; // For now, only support 'tag' field
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
      return query.$advanced;
    }

    // Handle complex nested queries
    const parts: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith('$') || key === 'tag') {
        continue;
      }

      if (typeof value === 'object' && value !== null) {
        if (value.$in && Array.isArray(value.$in)) {
          parts.push(`${key}:(${value.$in.join(', ')})`);
        } else if (value.$not) {
          parts.push(`NOT ${key}:${value.$not}`);
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
}
