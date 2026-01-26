import { Tool } from '@modelcontextprotocol/sdk/types.js';

import logger, { debugIf, errorIf } from '@src/logger/logger.js';

/**
 * Lightweight tool metadata (name + description only, no inputSchema)
 */
export interface ToolMetadata {
  name: string;
  server: string;
  description: string;
  tags?: string[];
}

/**
 * Options for listing tools from registry
 */
export interface ListToolsOptions {
  server?: string;
  pattern?: string;
  tag?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Result of listing tools from registry
 */
export interface ListToolsResult {
  tools: ToolMetadata[];
  totalCount: number;
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Decoded cursor for pagination
 */
interface PaginationCursor {
  offset: number;
  server?: string;
  pattern?: string;
  tag?: string;
}

/**
 * ToolRegistry maintains a lightweight registry of tool metadata without input schemas.
 *
 * This registry is used in meta-tool mode to provide fast tool discovery without
 * loading complex input schemas. Tools are identified by separate server and toolName
 * parameters for explicit routing.
 *
 * @example
 * ```typescript
 * const registry = ToolRegistry.build(connections);
 *
 * // List all tools
 * const result = registry.listTools({});
 *
 * // Filter by server
 * const filesystemTools = registry.listTools({ server: 'filesystem' });
 *
 * // Filter by pattern
 * const readTools = registry.listTools({ pattern: '*read*' });
 * ```
 */
export class ToolRegistry {
  private tools: ToolMetadata[] = [];

  private constructor(tools: ToolMetadata[]) {
    this.tools = tools;
  }

  /**
   * Build a ToolRegistry from a map of server names to their tools
   *
   * @param toolsByServer - Map of server name to array of tools from that server
   * @param serverTags - Optional map of server name to tags
   * @returns A new ToolRegistry instance
   */
  public static fromToolsMap(toolsByServer: Map<string, Tool[]>, serverTags?: Map<string, string[]>): ToolRegistry {
    const tools: ToolMetadata[] = [];

    for (const [serverName, serverTools] of toolsByServer.entries()) {
      const tags = serverTags?.get(serverName) || [];

      for (const tool of serverTools) {
        tools.push({
          name: tool.name,
          server: serverName,
          description: tool.description || '',
          tags,
        });
      }

      debugIf(() => ({
        message: `Registered ${serverTools.length} tools from server: ${serverName}`,
      }));
    }

    logger.info(`Built tool registry with ${tools.length} tools from ${toolsByServer.size} servers`);
    return new ToolRegistry(tools);
  }

  /**
   * Build a ToolRegistry from tools already loaded from servers
   * This is used when tools are fetched externally (e.g., from CapabilityAggregator)
   *
   * @param toolsWithServer - Array of tools with their server names
   * @returns A new ToolRegistry instance
   */
  public static fromToolsWithServer(
    toolsWithServer: Array<{ tool: Tool; server: string; tags?: string[] }>,
  ): ToolRegistry {
    const tools: ToolMetadata[] = toolsWithServer.map(({ tool, server, tags }) => ({
      name: tool.name,
      server,
      description: tool.description || '',
      tags: tags || [],
    }));

    logger.info(`Built tool registry with ${tools.length} tools`);
    return new ToolRegistry(tools);
  }

  /**
   * Create an empty ToolRegistry
   */
  public static empty(): ToolRegistry {
    return new ToolRegistry([]);
  }

  /**
   * List tools with optional filtering and pagination
   *
   * @param options - Filtering and pagination options
   * @returns Filtered and paginated tool list
   */
  public listTools(options: ListToolsOptions = {}): ListToolsResult {
    let filtered = [...this.tools];

    // Apply filters
    if (options.server) {
      filtered = filtered.filter((t) => t.server === options.server);
    }

    if (options.pattern) {
      filtered = filtered.filter((t) => {
        try {
          // Escape special regex characters except * and ?
          const escaped = options
            .pattern!.replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
            .replace(/\*/g, '.*') // * becomes .*
            .replace(/\?/g, '.'); // ? becomes .
          const patternRegex = new RegExp(`^${escaped}$`);
          return patternRegex.test(t.name);
        } catch (error) {
          // Invalid regex pattern - log and exclude this tool
          errorIf(() => ({
            message: 'Invalid pattern regex in tool filter',
            meta: { pattern: options.pattern, error },
          }));
          return false;
        }
      });
    }

    if (options.tag) {
      filtered = filtered.filter((t) => t.tags?.includes(options.tag!));
    }

    const totalCount = filtered.length;

    // Apply pagination
    let offset = 0;
    if (options.cursor) {
      const decoded = ToolRegistry.decodeCursor(options.cursor);
      offset = decoded.offset;
    }

    const limit = options.limit ? Math.min(options.limit, 5000) : filtered.length;
    const paginated = filtered.slice(offset, offset + limit);
    const hasMore = offset + limit < filtered.length;

    // Encode next cursor
    let nextCursor: string | undefined;
    if (hasMore) {
      nextCursor = ToolRegistry.encodeCursor({
        offset: offset + limit,
        server: options.server,
        pattern: options.pattern,
        tag: options.tag,
      });
    }

    return {
      tools: paginated,
      totalCount,
      hasMore,
      nextCursor,
    };
  }

  /**
   * Get all unique server names in the registry
   */
  public getServers(): string[] {
    const servers = new Set(this.tools.map((t) => t.server));
    return Array.from(servers).sort();
  }

  /**
   * Get all unique tags in the registry
   */
  public getTags(): string[] {
    const tags = new Set<string>();
    for (const tool of this.tools) {
      if (tool.tags) {
        for (const tag of tool.tags) {
          tags.add(tag);
        }
      }
    }
    return Array.from(tags).sort();
  }

  /**
   * Get tool count by server
   */
  public getToolCountByServer(): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const tool of this.tools) {
      counts[tool.server] = (counts[tool.server] || 0) + 1;
    }

    return counts;
  }

  /**
   * Check if a tool exists in the registry
   */
  public hasTool(server: string, toolName: string): boolean {
    return this.tools.some((t) => t.server === server && t.name === toolName);
  }

  /**
   * Get tool metadata without inputSchema
   */
  public getTool(server: string, toolName: string): ToolMetadata | undefined {
    return this.tools.find((t) => t.server === server && t.name === toolName);
  }

  /**
   * Get total number of tools in registry
   */
  public size(): number {
    return this.tools.length;
  }

  /**
   * Get all tools in the registry
   */
  public getAllTools(): ToolMetadata[] {
    return [...this.tools];
  }

  /**
   * Group tools by server
   */
  public groupByServer(): Record<string, ToolMetadata[]> {
    const grouped: Record<string, ToolMetadata[]> = {};

    for (const tool of this.tools) {
      if (!grouped[tool.server]) {
        grouped[tool.server] = [];
      }
      grouped[tool.server].push(tool);
    }

    return grouped;
  }

  /**
   * Filter the registry to only include tools from specific servers
   *
   * @param serverNames - Set of server names to include
   * @returns A new ToolRegistry instance with filtered tools
   */
  public filterByServers(serverNames: Set<string>): ToolRegistry {
    const filteredTools = this.tools.filter((tool) => serverNames.has(tool.server));
    return new ToolRegistry(filteredTools);
  }

  /**
   * Encode pagination cursor to base64 string
   */
  private static encodeCursor(cursor: PaginationCursor): string {
    const json = JSON.stringify(cursor);
    return Buffer.from(json).toString('base64');
  }

  /**
   * Decode pagination cursor from base64 string
   */
  private static decodeCursor(cursor: string): PaginationCursor {
    try {
      const json = Buffer.from(cursor, 'base64').toString('utf-8');
      return JSON.parse(json) as PaginationCursor;
    } catch (error) {
      logger.warn(`Failed to decode cursor: ${error}`);
      return { offset: 0 };
    }
  }

  /**
   * Get tools grouped by category (based on server tags)
   */
  public categorizeByTags(): Record<string, { name: string; tools: ToolMetadata[] }> {
    const categorized: Record<string, { name: string; tools: ToolMetadata[] }> = {};

    for (const tool of this.tools) {
      if (!tool.tags || tool.tags.length === 0) {
        // Tools without tags go to "uncategorized"
        if (!categorized['uncategorized']) {
          categorized['uncategorized'] = {
            name: 'Uncategorized',
            tools: [],
          };
        }
        categorized['uncategorized'].tools.push(tool);
      } else {
        // Use first tag as category
        const category = tool.tags[0];
        if (!categorized[category]) {
          categorized[category] = {
            name: category,
            tools: [],
          };
        }
        categorized[category].tools.push(tool);
      }
    }

    return categorized;
  }
}
