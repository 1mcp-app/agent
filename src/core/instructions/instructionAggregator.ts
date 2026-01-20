import { EventEmitter } from 'events';

import { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { InboundConnectionConfig, OutboundConnections } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import Handlebars from 'handlebars';

import { registerTemplateHelpers } from './templateHelpers.js';
import {
  DEFAULT_INSTRUCTION_TEMPLATE,
  DEFAULT_TEMPLATE_CONFIG,
  LazyLoadingState,
  ServerData,
  TemplateVariables,
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
  private lazyLoadingOrchestrator?: LazyLoadingOrchestrator;

  constructor() {
    super();
    this.setMaxListeners(50);

    // Register custom Handlebars helpers for template processing
    registerTemplateHelpers();
  }

  /**
   * Set the lazy loading orchestrator instance
   */
  public setLazyLoadingOrchestrator(orchestrator: LazyLoadingOrchestrator): void {
    this.lazyLoadingOrchestrator = orchestrator;
    debugIf('Lazy loading orchestrator set for InstructionAggregator');
  }

  /**
   * Get the lazy loading orchestrator instance
   */
  public getLazyLoadingOrchestrator(): LazyLoadingOrchestrator | undefined {
    return this.lazyLoadingOrchestrator;
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
      debugIf(() => ({ message: `Updated instructions for server: ${serverName}`, meta: { serverName } }));
    } else {
      this.serverInstructions.delete(serverName);
      debugIf(() => ({ message: `Removed instructions for server: ${serverName}`, meta: { serverName } }));
    }

    if (!this.isInitialized) {
      this.isInitialized = true;
      debugIf('InstructionAggregator initialized');
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
    debugIf(() => ({
      message: 'InstructionAggregator: Getting filtered instructions',
      meta: {
        filterMode: config.tagFilterMode,
        totalConnections: connections.size,
        totalInstructions: this.serverInstructions.size,
        hasCustomTemplate: !!config.customTemplate,
      },
    }));

    // Filter connections based on client configuration
    const filteredConnections = FilteringService.getFilteredConnections(connections, config);

    // Get filtering summary for logging
    const filteringSummary = FilteringService.getFilteringSummary(connections, filteredConnections, config);
    logger.info('InstructionAggregator: Filtering applied', filteringSummary);

    // Try custom template first, fall back to default if it fails
    if (config.customTemplate) {
      logger.info('InstructionAggregator: Trying custom template', { templateLength: config.customTemplate.length });
      try {
        return this.renderTemplate(config.customTemplate, filteredConnections, config);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

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
      debugIf('Cleared all server instructions');
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
    // Validate template size before processing
    // Priority: config > default
    const templateSizeLimit = config.templateSizeLimit || DEFAULT_TEMPLATE_CONFIG.templateSizeLimit;
    if (template.length > templateSizeLimit) {
      const sizeMB = (template.length / 1024 / 1024).toFixed(1);
      const limitMB = (templateSizeLimit / 1024 / 1024).toFixed(1);
      throw new Error(
        `Template too large: ${sizeMB}MB (max ${limitMB}MB). ` +
          'Consider splitting into smaller files or removing unnecessary content. ' +
          'Large templates can cause memory issues and slow performance.',
      );
    }

    // Compile template directly
    const compiledTemplate = Handlebars.compile(template, { noEscape: true });

    // Generate template variables
    const variables = this.generateTemplateVariables(filteredConnections, config);

    // Render template
    const rendered = compiledTemplate(variables);

    debugIf(() => ({
      message: 'InstructionAggregator: Compiled and cached new template',
      meta: {
        templateLength: template.length,
        variableCount: Object.keys(variables).length,
        renderedLength: rendered.length,
      },
    }));

    return rendered;
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
    const serverInstructionSections: string[] = [];
    const servers: ServerData[] = [];

    // Sort filtered connections by name for consistent output
    const sortedConnections = Array.from(filteredConnections.entries()).sort(([a], [b]) => a.localeCompare(b));

    for (const [serverName, _connection] of sortedConnections) {
      const serverInstructions = this.serverInstructions.get(serverName);
      const instructions = serverInstructions?.trim() || '';
      if (instructions) {
        // Wrap instructions in XML-like tags
        const wrappedInstructions = `<${serverName}>\n${instructions}\n</${serverName}>`;
        serverInstructionSections.push(wrappedInstructions);

        // Add individual server data for iteration
        servers.push({
          name: serverName,
          instructions: instructions,
          hasInstructions: true,
        });
      } else {
        servers.push({
          name: serverName,
          instructions: '',
          hasInstructions: false,
        });
      }
    }

    const connectedServerCount = filteredConnections.size;
    const hasInstructionalServers = serverInstructionSections.length > 0;
    const serverCount = serverInstructionSections.length;
    const hasServers = serverInstructionSections.length > 0;

    // Generate server lists (only servers with instructions)
    const serverNames = servers.filter((server) => server.hasInstructions).map((server) => server.name);
    const serverList = serverNames.join('\n');

    // Merge configuration with defaults
    const templateConfig = {
      ...DEFAULT_TEMPLATE_CONFIG,
      title: config.title || DEFAULT_TEMPLATE_CONFIG.title,
      toolPattern: config.toolPattern || DEFAULT_TEMPLATE_CONFIG.toolPattern,
      examples: config.examples || DEFAULT_TEMPLATE_CONFIG.examples,
    };

    return {
      // Server state
      connectedServerCount,
      hasInstructionalServers,
      serverCount,
      instructionalServerCount: serverCount, // Alias for clarity
      hasServers,
      serverList,
      serverNames,
      servers,
      pluralServers: serverCount === 1 ? 'server' : 'servers',
      isAre: serverCount === 1 ? 'is' : 'are',

      // Grammar helpers for connected servers
      connectedPluralServers: connectedServerCount === 1 ? 'server' : 'servers',
      connectedIsAre: connectedServerCount === 1 ? 'is' : 'are',

      // Content
      instructions: serverInstructionSections.join('\n\n'),
      filterContext: this.getFilterContext(config),

      // Configuration
      toolPattern: templateConfig.toolPattern,
      title: templateConfig.title,
      examples: templateConfig.examples,

      // Lazy loading state
      lazyLoading: this.generateLazyLoadingState(),
    };
  }

  /**
   * Generate lazy loading state for template variables
   * @returns Lazy loading state object or undefined
   */
  private generateLazyLoadingState(): LazyLoadingState | undefined {
    if (!this.lazyLoadingOrchestrator) {
      return undefined;
    }

    const isEnabled = this.lazyLoadingOrchestrator.isEnabled();
    const stats = this.lazyLoadingOrchestrator.getStatistics();

    // Calculate exposed tools based on enabled state
    let exposedToolsCount = stats.registeredToolCount;
    if (isEnabled) {
      // Meta-tool mode: only meta-tools exposed
      exposedToolsCount = 3; // tool_list, tool_schema, tool_invoke
    }

    // Get meta-tools list if enabled
    const metaTools = isEnabled ? ['tool_list', 'tool_schema', 'tool_invoke'] : undefined;

    return {
      enabled: isEnabled,
      mode: isEnabled ? 'metatool' : 'full',
      availableToolsCount: stats.registeredToolCount,
      exposedToolsCount,
      directExposeCount: 0, // TODO: get from config
      cachedToolsCount: stats.cachedToolCount,
      metaTools,
      catalog: undefined, // TODO: implement inline catalog
    };
  }

  /**
   * Cleanup method to remove all event listeners
   * Should be called when the aggregator is no longer needed
   */
  public cleanup(): void {
    debugIf('InstructionAggregator: Starting cleanup');

    // Clear all event listeners
    this.removeAllListeners();

    // Clear server instructions
    this.serverInstructions.clear();

    // Reset initialization state
    this.isInitialized = false;

    logger.info('InstructionAggregator: Cleanup completed - all listeners cleared');
  }
}
