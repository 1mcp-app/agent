/**
 * Advanced tag query parser supporting boolean expressions
 * Supports multiple syntax variants: compact, natural language, and symbols
 */

import { TagQuery } from './presetTypes.js';

export interface TagExpression {
  type: 'and' | 'or' | 'not' | 'tag' | 'group';
  value?: string;
  children?: TagExpression[];
}

export interface ParseOptions {
  allowAdvanced: boolean;
  defaultOperator: 'OR' | 'AND';
}

interface Token {
  type: 'tag' | 'and' | 'or' | 'not' | 'lparen' | 'rparen';
  value: string;
  position: number;
}

/**
 * Advanced tag query parser with support for boolean expressions
 */
export class TagQueryParser {
  /**
   * Parse simple comma-separated tags (backward compatible)
   * Always uses OR logic for compatibility
   */
  static parseSimple(tags: string): string[] {
    if (!tags || typeof tags !== 'string') {
      return [];
    }

    const rawTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (rawTags.length === 0) {
      return [];
    }

    // For now, return basic parsing to avoid circular dependencies
    // Advanced validation will be handled at the middleware level
    return rawTags;
  }

  /**
   * Parse advanced query expressions
   * Supports multiple syntax variants:
   * - Compact: web+api-test, (web,api)+prod
   * - Natural: web and api and not test
   * - Symbols: web && api && !test
   */
  static parseAdvanced(query: string): TagExpression {
    if (typeof query !== 'string') {
      throw new Error('Query string is required');
    }

    const normalized = query.trim();
    if (normalized.length === 0) {
      throw new Error('Query string cannot be empty');
    }

    try {
      const tokens = this.tokenize(normalized);
      if (tokens.length === 0) {
        throw new Error('No valid tokens found in query');
      }

      const result = this.parseExpression(tokens, 0);
      if (result.nextIndex < tokens.length) {
        const remaining = tokens.slice(result.nextIndex);
        throw new Error(`Unexpected tokens: ${remaining.map((t) => t.value).join(' ')}`);
      }

      return result.expression;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Parse error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Evaluate expression against tag array
   */
  static evaluate(expr: TagExpression, serverTags: string[]): boolean {
    if (!serverTags) {
      serverTags = [];
    }

    // Simple normalization without external dependencies
    const normalizeTag = (tag: string): string => {
      if (!tag || typeof tag !== 'string') {
        return '';
      }
      try {
        // Decode URL encoding if present
        let normalized = tag.includes('%') ? decodeURIComponent(tag) : tag;
        return normalized.trim().toLowerCase();
      } catch (_e) {
        // If decode fails, just normalize without decoding
        return tag.trim().toLowerCase();
      }
    };

    switch (expr.type) {
      case 'tag': {
        // Normalize both the expression tag and server tags for comparison
        const normalizedExprTag = normalizeTag(expr.value!);
        const normalizedServerTags = serverTags.map((tag) => normalizeTag(tag));
        return normalizedServerTags.includes(normalizedExprTag);
      }
      case 'not':
        if (!expr.children || expr.children.length !== 1) {
          throw new Error('NOT expression must have exactly one child');
        }
        return !this.evaluate(expr.children[0], serverTags);

      case 'and':
        if (!expr.children || expr.children.length === 0) {
          return true; // Empty AND is true
        }
        return expr.children.every((c) => this.evaluate(c, serverTags));

      case 'or':
        if (!expr.children || expr.children.length === 0) {
          return false; // Empty OR is false
        }
        return expr.children.some((c) => this.evaluate(c, serverTags));

      case 'group':
        if (!expr.children || expr.children.length !== 1) {
          throw new Error('Group expression must have exactly one child');
        }
        return this.evaluate(expr.children[0], serverTags);

      default:
        throw new Error(`Unknown expression type: ${(expr as any).type}`);
    }
  }

  /**
   * Tokenize query string into tokens
   */
  private static tokenize(query: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < query.length) {
      const char = query[i];

      // Skip whitespace
      if (/\s/.test(char)) {
        i++;
        continue;
      }

      // Parentheses
      if (char === '(') {
        tokens.push({ type: 'lparen', value: '(', position: i });
        i++;
        continue;
      }

      if (char === ')') {
        tokens.push({ type: 'rparen', value: ')', position: i });
        i++;
        continue;
      }

      // NOT operators: ! or - (when used as prefix)
      if (char === '!' || (char === '-' && this.isNotOperator(query, i))) {
        tokens.push({ type: 'not', value: char, position: i });
        i++;
        continue;
      }

      // AND operators: + or &&
      if (char === '+') {
        tokens.push({ type: 'and', value: '+', position: i });
        i++;
        continue;
      }

      if (char === '&' && query[i + 1] === '&') {
        tokens.push({ type: 'and', value: '&&', position: i });
        i += 2;
        continue;
      }

      // OR operators: , or ||
      if (char === ',') {
        tokens.push({ type: 'or', value: ',', position: i });
        i++;
        continue;
      }

      if (char === '|' && query[i + 1] === '|') {
        tokens.push({ type: 'or', value: '||', position: i });
        i += 2;
        continue;
      }

      // Check for natural language keywords
      const remaining = query.slice(i);

      if (remaining.toLowerCase().startsWith('and') && this.isWordBoundary(query, i + 3)) {
        tokens.push({ type: 'and', value: 'and', position: i });
        i += 3;
        continue;
      }

      if (remaining.toLowerCase().startsWith('or') && this.isWordBoundary(query, i + 2)) {
        tokens.push({ type: 'or', value: 'or', position: i });
        i += 2;
        continue;
      }

      if (remaining.toLowerCase().startsWith('not') && this.isWordBoundary(query, i + 3)) {
        tokens.push({ type: 'not', value: 'not', position: i });
        i += 3;
        continue;
      }

      // Tag name - handle alphanumeric, hyphens, underscores, dots
      const tagMatch = remaining.match(/^[a-zA-Z0-9_.-]+/);
      if (tagMatch) {
        const tagName = tagMatch[0];

        // Simple normalization - just lowercase and trim
        const normalizedTag = tagName.trim().toLowerCase();

        tokens.push({ type: 'tag', value: normalizedTag, position: i });
        i += tagName.length;
        continue;
      }

      throw new Error(`Unexpected character '${char}' at position ${i}`);
    }

    return tokens;
  }

  /**
   * Check if dash is a NOT operator (not part of tag name)
   * A dash is a NOT operator if:
   * - It's at the start of input
   * - It's preceded by whitespace, operators, or opening parenthesis
   * - It's not in the middle of what appears to be a tag name
   */
  private static isNotOperator(query: string, position: number): boolean {
    // If at start, it's a NOT operator
    if (position === 0) return true;

    const prevChar = query[position - 1];

    // If preceded by whitespace, operators, or opening parenthesis, it's a NOT operator
    if (/[\s(+,|&]/.test(prevChar)) return true;

    // If preceded by 'and', 'or', 'not' keywords, it's a NOT operator
    const beforeDash = query.slice(0, position).toLowerCase();
    if (/(^|\s)(and|or|not)\s*$/.test(beforeDash)) return true;

    return false;
  }

  /**
   * Check if position is at word boundary
   */
  private static isWordBoundary(query: string, position: number): boolean {
    return position >= query.length || /[\s()&|+,-]/.test(query[position]);
  }

  /**
   * Parse expression using recursive descent parser
   */
  private static parseExpression(
    tokens: Token[],
    startIndex: number,
  ): { expression: TagExpression; nextIndex: number } {
    return this.parseOrExpression(tokens, startIndex);
  }

  /**
   * Parse OR expressions (lowest precedence)
   */
  private static parseOrExpression(
    tokens: Token[],
    startIndex: number,
  ): { expression: TagExpression; nextIndex: number } {
    let result = this.parseAndExpression(tokens, startIndex);
    const children: TagExpression[] = [result.expression];
    let index = result.nextIndex;

    while (index < tokens.length && tokens[index].type === 'or') {
      index++; // consume 'or'
      result = this.parseAndExpression(tokens, index);
      children.push(result.expression);
      index = result.nextIndex;
    }

    if (children.length === 1) {
      return { expression: children[0], nextIndex: index };
    }

    return {
      expression: { type: 'or', children },
      nextIndex: index,
    };
  }

  /**
   * Parse AND expressions (higher precedence than OR)
   */
  private static parseAndExpression(
    tokens: Token[],
    startIndex: number,
  ): { expression: TagExpression; nextIndex: number } {
    let result = this.parseNotExpression(tokens, startIndex);
    const children: TagExpression[] = [result.expression];
    let index = result.nextIndex;

    while (index < tokens.length && tokens[index].type === 'and') {
      index++; // consume 'and'
      result = this.parseNotExpression(tokens, index);
      children.push(result.expression);
      index = result.nextIndex;
    }

    if (children.length === 1) {
      return { expression: children[0], nextIndex: index };
    }

    return {
      expression: { type: 'and', children },
      nextIndex: index,
    };
  }

  /**
   * Parse NOT expressions (highest precedence)
   */
  private static parseNotExpression(
    tokens: Token[],
    startIndex: number,
  ): { expression: TagExpression; nextIndex: number } {
    if (startIndex >= tokens.length) {
      throw new Error('Unexpected end of input');
    }

    const token = tokens[startIndex];

    if (token.type === 'not') {
      const result = this.parseAtomicExpression(tokens, startIndex + 1);
      return {
        expression: { type: 'not', children: [result.expression] },
        nextIndex: result.nextIndex,
      };
    }

    return this.parseAtomicExpression(tokens, startIndex);
  }

  /**
   * Parse atomic expressions (tags and groups)
   */
  private static parseAtomicExpression(
    tokens: Token[],
    startIndex: number,
  ): { expression: TagExpression; nextIndex: number } {
    if (startIndex >= tokens.length) {
      throw new Error('Unexpected end of input');
    }

    const token = tokens[startIndex];

    if (token.type === 'tag') {
      return {
        expression: { type: 'tag', value: token.value },
        nextIndex: startIndex + 1,
      };
    }

    if (token.type === 'lparen') {
      const result = this.parseExpression(tokens, startIndex + 1);

      if (result.nextIndex >= tokens.length || tokens[result.nextIndex].type !== 'rparen') {
        throw new Error('Missing closing parenthesis');
      }

      return {
        expression: { type: 'group', children: [result.expression] },
        nextIndex: result.nextIndex + 1,
      };
    }

    throw new Error(`Unexpected token '${token.value}' at position ${token.position}`);
  }

  /**
   * Utility method to convert expression back to string (for debugging/logging)
   */
  static expressionToString(expr: TagExpression): string {
    switch (expr.type) {
      case 'tag':
        return expr.value!;

      case 'not':
        return `not ${this.expressionToString(expr.children![0])}`;

      case 'and':
        return expr.children!.map((c) => this.expressionToString(c)).join(' and ');

      case 'or':
        return expr.children!.map((c) => this.expressionToString(c)).join(' or ');

      case 'group':
        return `(${this.expressionToString(expr.children![0])})`;

      default:
        return 'unknown';
    }
  }

  /**
   * Convert TagExpression to JSON TagQuery format
   * This enables unifying the dual query system by converting parser expressions to JSON queries
   */
  static expressionToJSON(expr: TagExpression): TagQuery {
    switch (expr.type) {
      case 'tag':
        return { tag: expr.value! };

      case 'not':
        if (!expr.children || expr.children.length !== 1) {
          throw new Error('NOT expression must have exactly one child');
        }
        return { $not: this.expressionToJSON(expr.children[0]) };

      case 'and':
        if (!expr.children || expr.children.length === 0) {
          return { tag: '' }; // Empty AND matches nothing
        }
        if (expr.children.length === 1) {
          return this.expressionToJSON(expr.children[0]);
        }
        return { $and: expr.children.map((c) => this.expressionToJSON(c)) };

      case 'or':
        if (!expr.children || expr.children.length === 0) {
          return { tag: '' }; // Empty OR matches nothing
        }
        if (expr.children.length === 1) {
          return this.expressionToJSON(expr.children[0]);
        }
        return { $or: expr.children.map((c) => this.expressionToJSON(c)) };

      case 'group':
        if (!expr.children || expr.children.length !== 1) {
          throw new Error('Group expression must have exactly one child');
        }
        return this.expressionToJSON(expr.children[0]);

      default:
        throw new Error(`Unknown expression type: ${(expr as any).type}`);
    }
  }

  /**
   * Convert advanced string query directly to JSON TagQuery
   * This provides a unified entry point for converting string queries to JSON format
   */
  static advancedQueryToJSON(query: string): TagQuery {
    const expression = this.parseAdvanced(query);
    return this.expressionToJSON(expression);
  }
}
