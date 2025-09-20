import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import Handlebars from 'handlebars';
import { LRUCache } from 'lru-cache';
import logger from '../../logger/logger.js';
import { FilteringService } from '../filtering/filteringService.js';
import { OutboundConnections, InboundConnectionConfig } from '../types/index.js';
import {
  TemplateVariables,
  ServerData,
  DEFAULT_TEMPLATE_CONFIG,
  DEFAULT_INSTRUCTION_TEMPLATE,
} from './templateTypes.js';

/**
 * Events emitted by InstructionAggregator
 */
export interface InstructionAggregatorEvents {
  'instructions-changed': () => void;
}

/**
 * Aggregates instructions from multiple MCP servers into a single instruction string.
 * Provides both simple concatenation and filtered instructions with educational templates.
 * The aggregator acts as an educational prompt to help LLMs understand 1MCP better.
 *
 * @example
 * ```typescript
 * const aggregator = new InstructionAggregator();
 * aggregator.on('instructions-changed', () => {
 *   // Server instructions have changed
 * });
 *
 * // When server comes online
 * aggregator.setInstructions('server1', 'Server 1 instructions');
 *
 * // Get filtered instructions for a client
 * const filtered = aggregator.getFilteredInstructions(config, connections);
 * ```
 */
export class InstructionAggregator extends EventEmitter {
  private serverInstructions = new Map<string, string>();
  private isInitialized: boolean = false;
  private templateCache: LRUCache<string, Handlebars.TemplateDelegate>;

  constructor() {
    super();
    this.setMaxListeners(50);

    // Initialize LRU cache with reasonable limits
    this.templateCache = new LRUCache({
      max: 100, // Maximum 100 compiled templates
      maxSize: 10 * 1024 * 1024, // 10MB total size limit
      sizeCalculation: (template: Handlebars.TemplateDelegate, key: string) => {
        // Estimate size based on template string length (key) plus overhead
        return key.length + 1024; // Template overhead estimate
      },
      ttl: 1000 * 60 * 60, // 1 hour TTL to prevent indefinite growth
    });

    // Set up cache invalidation on instruction changes
    this.on('instructions-changed', () => {
      this.invalidateTemplateCache('instructions-changed');
    });
  }

  /**
   * Set or update instructions for a specific server
   * @param serverName The name of the server
   * @param instructions The instruction string from the server, or undefined to remove
   */
  public setInstructions(serverName: string, instructions: string | undefined): void {
    const previousInstructions = this.serverInstructions.get(serverName);
    const hasChanges = previousInstructions !== instructions;

    if (instructions?.trim()) {
      this.serverInstructions.set(serverName, instructions.trim());
      logger.debug(`Updated instructions for server: ${serverName}`);
    } else {
      this.serverInstructions.delete(serverName);
      logger.debug(`Removed instructions for server: ${serverName}`);
    }

    if (!this.isInitialized) {
      this.isInitialized = true;
      logger.debug('InstructionAggregator initialized');
    }

    if (hasChanges) {
      logger.info(`Instructions changed. Total servers with instructions: ${this.serverInstructions.size}`);
      this.emit('instructions-changed');
    }
  }

  /**
   * Remove instructions for a specific server
   * @param serverName The name of the server to remove
   */
  public removeServer(serverName: string): void {
    const hadInstructions = this.serverInstructions.has(serverName);
    this.serverInstructions.delete(serverName);

    if (hadInstructions) {
      logger.info(`Removed server instructions: ${serverName}. Remaining servers: ${this.serverInstructions.size}`);
      this.emit('instructions-changed');
    }
  }

  /**
   * Get filtered instructions for a specific client based on their configuration
   * This is the main method that should be used by server connections
   *
   * @param config Client's inbound connection configuration
   * @param connections All available outbound connections
   * @returns Formatted instruction string with educational template or custom template
   */
  public getFilteredInstructions(config: InboundConnectionConfig, connections: OutboundConnections): string {
    logger.debug('InstructionAggregator: Getting filtered instructions', {
      filterMode: config.tagFilterMode,
      totalConnections: connections.size,
      totalInstructions: this.serverInstructions.size,
      hasCustomTemplate: !!config.customTemplate,
    });

    // Filter connections based on client configuration
    const filteredConnections = FilteringService.getFilteredConnections(connections, config);

    // Get filtering summary for logging
    const filteringSummary = FilteringService.getFilteringSummary(connections, filteredConnections, config);
    logger.info('InstructionAggregator: Filtering applied', filteringSummary);

    // Try custom template first, fall back to default if it fails
    if (config.customTemplate) {
      try {
        return this.renderTemplate(config.customTemplate, filteredConnections, config);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Print error to console for immediate visibility
        console.error('Custom template parsing failed:', errorMessage);

        // Log detailed error for debugging
        logger.error('InstructionAggregator: Custom template failed, falling back to default template', {
          error: errorMessage,
          templateLength: config.customTemplate.length,
        });

        // Fall back to default template
        return this.renderTemplate(DEFAULT_INSTRUCTION_TEMPLATE, filteredConnections, config);
      }
    } else {
      // Use default template directly
      return this.renderTemplate(DEFAULT_INSTRUCTION_TEMPLATE, filteredConnections, config);
    }
  }

  /**
   * Get the number of servers that have provided instructions
   * @returns The count of servers with instructions
   */
  public getServerCount(): number {
    return this.serverInstructions.size;
  }

  /**
   * Get a list of server names that have provided instructions
   * @returns Array of server names
   */
  public getServerNames(): string[] {
    return Array.from(this.serverInstructions.keys()).sort();
  }

  /**
   * Check if a specific server has instructions
   * @param serverName The server name to check
   * @returns True if the server has instructions
   */
  public hasInstructions(serverName: string): boolean {
    return this.serverInstructions.has(serverName);
  }

  /**
   * Get instructions for a specific server
   * @param serverName The server name
   * @returns The instructions for the server, or undefined if not found
   */
  public getServerInstructions(serverName: string): string | undefined {
    return this.serverInstructions.get(serverName);
  }

  /**
   * Clear all instructions (useful for testing)
   */
  public clear(): void {
    const hadInstructions = this.serverInstructions.size > 0;
    this.serverInstructions.clear();

    if (hadInstructions) {
      logger.debug('Cleared all server instructions');
      this.emit('instructions-changed');
    }
  }

  /**
   * Get filter context description for the template
   */
  private getFilterContext(config: InboundConnectionConfig): string {
    if (!config.tagFilterMode || config.tagFilterMode === 'none') {
      return '';
    }

    if (config.tagFilterMode === 'simple-or' && config.tags?.length) {
      return ` (filtered by tags: ${config.tags.join(', ')})`;
    }

    if (config.tagFilterMode === 'advanced' && config.tagExpression) {
      return ' (filtered by advanced expression)';
    }

    if (config.tagFilterMode === 'preset') {
      return ' (filtered by preset)';
    }

    return ' (filtered)';
  }

  /**
   * Get a summary of current instruction state for logging
   */
  public getSummary(): string {
    const serverCount = this.serverInstructions.size;
    const serverNames = this.getServerNames();
    return `${serverCount} servers with instructions: ${serverNames.join(', ')}`;
  }

  /**
   * Render a Handlebars template with template variables
   * @param template Template string (custom or default)
   * @param filteredConnections Filtered server connections
   * @param config Client configuration
   * @returns Rendered template string
   */
  private renderTemplate(
    template: string,
    filteredConnections: OutboundConnections,
    config: InboundConnectionConfig,
  ): string {
    // Get or compile template
    const compiledTemplate = this.getCompiledTemplate(template);

    // Generate template variables
    const variables = this.generateTemplateVariables(filteredConnections, config);

    // Render template
    const rendered = compiledTemplate(variables);

    logger.debug('InstructionAggregator: Template rendered successfully', {
      templateLength: template.length,
      variableCount: Object.keys(variables).length,
      renderedLength: rendered.length,
    });

    return rendered;
  }

  /**
   * Get or compile a Handlebars template with caching
   * @param template Template string
   * @returns Compiled template function
   */
  private getCompiledTemplate(template: string): Handlebars.TemplateDelegate {
    // Validate template size before processing
    if (template.length > 1024 * 1024) {
      // 1MB limit per template
      const sizeMB = (template.length / 1024 / 1024).toFixed(1);
      throw new Error(
        `Template too large: ${sizeMB}MB (max 1.0MB). ` +
          'Consider splitting into smaller files or removing unnecessary content. ' +
          'Large templates can cause memory issues and slow performance.',
      );
    }

    // Use template string as cache key (first 500 chars + hash for uniqueness)
    const cacheKey =
      template.length > 500
        ? template.substring(0, 500) + '_' + template.length + '_' + this.hashString(template)
        : template;

    // Check cache first
    let compiledTemplate = this.templateCache.get(cacheKey);

    if (!compiledTemplate) {
      // Compile and cache template
      compiledTemplate = Handlebars.compile(template, { noEscape: true });
      this.templateCache.set(cacheKey, compiledTemplate);

      logger.debug('InstructionAggregator: Compiled and cached new template', {
        templateLength: template.length,
        cacheSize: this.templateCache.size,
        cacheKeyLength: cacheKey.length,
      });
    }

    return compiledTemplate;
  }

  /**
   * Generate template variables for rendering
   * @param filteredConnections Filtered server connections
   * @param config Client configuration
   * @returns Template variables object
   */
  private generateTemplateVariables(
    filteredConnections: OutboundConnections,
    config: InboundConnectionConfig,
  ): TemplateVariables {
    // Get server data for both arrays and individual server objects
    const availableServers: string[] = [];
    const serverInstructionSections: string[] = [];
    const servers: ServerData[] = [];

    // Sort filtered connections by name for consistent output
    const sortedConnections = Array.from(filteredConnections.entries()).sort(([a], [b]) => a.localeCompare(b));

    for (const [serverName, _connection] of sortedConnections) {
      const serverInstructions = this.serverInstructions.get(serverName);
      if (serverInstructions?.trim()) {
        availableServers.push(serverName);
        serverInstructionSections.push(`<${serverName}>\n${serverInstructions.trim()}\n</${serverName}>`);

        // Add individual server data for iteration
        servers.push({
          name: serverName,
          instructions: serverInstructions.trim(),
          hasInstructions: true,
        });
      }
    }

    const serverCount = availableServers.length;
    const hasServers = serverCount > 0;

    // Merge configuration with defaults
    const templateConfig = {
      ...DEFAULT_TEMPLATE_CONFIG,
      title: config.title || DEFAULT_TEMPLATE_CONFIG.title,
      toolPattern: config.toolPattern || DEFAULT_TEMPLATE_CONFIG.toolPattern,
      examples: config.examples || DEFAULT_TEMPLATE_CONFIG.examples,
    };

    return {
      // Server state
      serverCount,
      hasServers,
      serverList: availableServers.join('\n'),
      serverNames: availableServers,
      servers,
      pluralServers: serverCount === 1 ? 'server' : 'servers',
      isAre: serverCount === 1 ? 'is' : 'are',

      // Content
      instructions: serverInstructionSections.join('\n\n'),
      filterContext: this.getFilterContext(config),

      // Configuration
      toolPattern: templateConfig.toolPattern,
      title: templateConfig.title,
      examples: templateConfig.examples,
    };
  }

  /**
   * Clear template cache (useful for testing)
   */
  public clearTemplateCache(): void {
    this.templateCache.clear();
    logger.debug('InstructionAggregator: Template cache cleared');
  }

  /**
   * Get template cache statistics for monitoring
   */
  public getTemplateCacheStats(): {
    size: number;
    maxSize: number;
    calculatedSize: number;
  } {
    return {
      size: this.templateCache.size,
      maxSize: this.templateCache.max,
      calculatedSize: this.templateCache.calculatedSize || 0,
    };
  }

  /**
   * Invalidate template cache with reason logging
   * @param reason Reason for cache invalidation
   */
  private invalidateTemplateCache(reason: string): void {
    const sizeBefore = this.templateCache.size;
    this.templateCache.clear();
    logger.debug(`InstructionAggregator: Template cache invalidated due to ${reason}`, {
      clearedTemplates: sizeBefore,
    });
  }

  /**
   * Force template cache invalidation (for external triggers)
   * @param reason Reason for forced invalidation
   */
  public forceTemplateCacheInvalidation(reason: string = 'external-trigger'): void {
    this.invalidateTemplateCache(reason);
  }

  /**
   * Cryptographically secure hash function for template cache keys
   * Uses SHA-256 to prevent collision attacks
   */
  private hashString(str: string): string {
    return createHash('sha256').update(str, 'utf8').digest('hex').substring(0, 16);
  }

  /**
   * Cleanup method to remove all event listeners and clear caches
   * Should be called when the aggregator is no longer needed
   */
  public cleanup(): void {
    logger.debug('InstructionAggregator: Starting cleanup');

    // Clear all event listeners
    this.removeAllListeners();

    // Clear template cache
    this.templateCache.clear();

    // Clear server instructions
    this.serverInstructions.clear();

    // Reset initialization state
    this.isInitialized = false;

    logger.info('InstructionAggregator: Cleanup completed - all listeners and caches cleared');
  }
}
