import { EventEmitter } from 'events';
import Handlebars from 'handlebars';
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
  private templateCache = new Map<string, Handlebars.TemplateDelegate>();

  constructor() {
    super();
    this.setMaxListeners(50);
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

    // Use custom template if provided, otherwise use default template
    const template = config.customTemplate || DEFAULT_INSTRUCTION_TEMPLATE;
    return this.renderCustomTemplate(template, filteredConnections, config);
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
   * Render a custom Handlebars template with template variables
   * @param template Custom template string
   * @param filteredConnections Filtered server connections
   * @param config Client configuration
   * @returns Rendered template string
   */
  private renderCustomTemplate(
    template: string,
    filteredConnections: OutboundConnections,
    config: InboundConnectionConfig,
  ): string {
    try {
      // Get or compile template
      const compiledTemplate = this.getCompiledTemplate(template);

      // Generate template variables
      const variables = this.generateTemplateVariables(filteredConnections, config);

      // Render template
      const rendered = compiledTemplate(variables);

      logger.debug('InstructionAggregator: Custom template rendered successfully', {
        templateLength: template.length,
        variableCount: Object.keys(variables).length,
        renderedLength: rendered.length,
      });

      return rendered;
    } catch (error) {
      logger.error('InstructionAggregator: Failed to render custom template', {
        error: error instanceof Error ? error.message : 'Unknown error',
        templateLength: template.length,
      });

      // Fallback to minimal error message on template error
      logger.warn('InstructionAggregator: Template rendering failed, returning minimal instructions');
      const serverCount = Array.from(filteredConnections.keys()).filter((name) =>
        this.serverInstructions.has(name),
      ).length;
      return `# 1MCP - Template Error\\n\\nTemplate rendering failed. ${serverCount} server(s) available but instructions cannot be displayed.`;
    }
  }

  /**
   * Get or compile a Handlebars template with caching
   * @param template Template string
   * @returns Compiled template function
   */
  private getCompiledTemplate(template: string): Handlebars.TemplateDelegate {
    // Use template string as cache key
    const cacheKey = template;

    // Check cache first
    let compiledTemplate = this.templateCache.get(cacheKey);

    if (!compiledTemplate) {
      // Compile and cache template
      compiledTemplate = Handlebars.compile(template);
      this.templateCache.set(cacheKey, compiledTemplate);

      logger.debug('InstructionAggregator: Compiled and cached new template', {
        templateLength: template.length,
        cacheSize: this.templateCache.size,
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
}
