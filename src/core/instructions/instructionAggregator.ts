import { EventEmitter } from 'events';

import { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { InboundConnectionConfig, OutboundConnections } from '@src/core/types/index.js';
import type { InstructionTemplateConfig } from '@src/core/types/transport.js';
import logger, { debugIf } from '@src/logger/logger.js';

import Handlebars from 'handlebars';

import {
  type ConfiguredServerInstructionTarget,
  type ConfiguredServerInstructionTargets,
  hasConfiguredInstructionOverride,
  resolveEffectiveServerInstructions,
} from './effectiveServerInstructions.js';
import { registerTemplateHelpers } from './templateHelpers.js';
import {
  DEFAULT_CLI_INSTRUCTION_TEMPLATE,
  DEFAULT_INSTRUCTION_TEMPLATE,
  DEFAULT_TEMPLATE_CONFIG,
  LazyLoadingState,
  ServerData,
  TemplateVariables,
} from './templateTypes.js';

export type InstructionSurface = 'initialization' | 'cli';

export interface RuntimeInstructionConfiguration {
  instructionTemplates?: Record<string, InstructionTemplateConfig>;
  publishedInstructionTemplates?: Record<string, InstructionTemplateConfig>;
  activeInstructionTemplate?: string;
  configuredTargets: ConfiguredServerInstructionTargets;
}

interface InstructionRenderPresentationMetadata {
  type?: string;
  status?: string;
  available?: boolean;
  loadTracked?: boolean;
  toolCount?: number;
  note?: string;
  hasInstructions?: boolean;
  summary?: InstructionRenderPresentationMetadata & { hasInstructions?: boolean };
}

export interface InstructionRenderMetadata extends InstructionRenderPresentationMetadata {
  /** Internal configured-target provenance for render-only synthetic connections. */
  target?: ConfiguredServerInstructionTarget;
  /** Internal upstream value; presence distinguishes an explicit absent value from cache lookup. */
  upstreamInstructions?: string;
}

export interface InstructionRenderFailure {
  surface: InstructionSurface;
  templateIdentity: string;
  error: string;
  occurredAt: Date;
}

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
  private rawInstructions = new Map<string, string>();
  private instructionTargets = new Map<string, ConfiguredServerInstructionTarget>();
  private runtimeConfiguration: RuntimeInstructionConfiguration = {
    configuredTargets: { mcpServers: {}, mcpTemplates: {} },
  };
  private runtimeConfigurationSignature = JSON.stringify(this.runtimeConfiguration);
  private renderFailures: Partial<Record<InstructionSurface, InstructionRenderFailure>> = {};
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
  public setInstructions(
    server: string | ConfiguredServerInstructionTarget,
    instructions: string | undefined,
    outboundKey?: string,
  ): void {
    const isLegacyTarget = typeof server === 'string';
    const target = isLegacyTarget ? { source: 'mcpServers' as const, name: server } : server;
    const cacheKey = outboundKey ?? target.name;
    const previousRawInstructions = this.rawInstructions.get(cacheKey);
    const previousTarget = this.instructionTargets.get(cacheKey);
    const normalizedInstructions = instructions?.trim();
    const previousInstructions = this.serverInstructions.get(target.name);
    const hasChanges = previousInstructions !== normalizedInstructions;

    if (instructions === undefined) {
      this.rawInstructions.delete(cacheKey);
      if (isLegacyTarget) {
        this.instructionTargets.delete(cacheKey);
      } else {
        this.instructionTargets.set(cacheKey, target);
      }
    } else {
      this.rawInstructions.set(cacheKey, instructions);
      this.instructionTargets.set(cacheKey, target);
    }

    if (normalizedInstructions) {
      this.serverInstructions.set(target.name, normalizedInstructions);
      debugIf(() => ({
        message: `Updated instructions for server: ${target.name}`,
        meta: { serverName: target.name },
      }));
    } else {
      this.serverInstructions.delete(target.name);
      debugIf(() => ({
        message: `Removed instructions for server: ${target.name}`,
        meta: { serverName: target.name },
      }));
    }

    if (!this.isInitialized) {
      this.isInitialized = true;
      debugIf('InstructionAggregator initialized');
    }

    if (
      hasChanges ||
      previousRawInstructions !== instructions ||
      previousTarget?.source !== target.source ||
      previousTarget?.name !== target.name
    ) {
      logger.info(`Instructions changed. Total servers with instructions: ${this.serverInstructions.size}`);
      this.emit('instructions-changed');
    }
  }

  /**
   * Remove instructions for a specific server
   * @param serverName The name of the server to remove
   */
  public removeServer(server: string | ConfiguredServerInstructionTarget, outboundKey?: string): void {
    const target = typeof server === 'string' ? { source: 'mcpServers' as const, name: server } : server;
    const cacheKey = outboundKey ?? target.name;
    const hadInstructions = this.rawInstructions.has(cacheKey) || this.serverInstructions.has(target.name);
    this.serverInstructions.delete(target.name);
    this.rawInstructions.delete(cacheKey);
    this.instructionTargets.delete(cacheKey);

    if (hadInstructions) {
      logger.info(`Removed server instructions: ${target.name}. Remaining servers: ${this.serverInstructions.size}`);
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
    return this.renderInstructions('initialization', config, connections);
  }

  public setRuntimeInstructionConfiguration(configuration: RuntimeInstructionConfiguration): void {
    const signature = JSON.stringify(configuration);
    if (signature === this.runtimeConfigurationSignature) return;
    this.runtimeConfiguration = configuration;
    this.runtimeConfigurationSignature = signature;
    this.renderFailures = {};
    this.emit('instructions-changed');
  }

  public getActiveInstructionTemplate(): string | undefined {
    return this.runtimeConfiguration.activeInstructionTemplate;
  }

  public getRenderFailures(): Partial<Record<InstructionSurface, InstructionRenderFailure>> {
    return { ...this.renderFailures };
  }

  public renderInstructions(
    surface: InstructionSurface,
    config: InboundConnectionConfig,
    connections: OutboundConnections,
    metadata: Record<string, InstructionRenderMetadata> = {},
  ): string {
    debugIf(() => ({
      message: 'InstructionAggregator: Getting filtered instructions',
      meta: {
        filterMode: config.tagFilterMode,
        totalConnections: connections.size,
        totalInstructions: this.serverInstructions.size,
        hasCustomTemplate: surface === 'initialization' && !!config.customTemplate,
      },
    }));

    // Filter connections based on client configuration
    const filteredConnections = FilteringService.getFilteredConnections(connections, config);

    // Get filtering summary for logging
    const filteringSummary = FilteringService.getFilteringSummary(connections, filteredConnections, config);
    logger.info('InstructionAggregator: Filtering applied', filteringSummary);

    const activeIdentity = this.runtimeConfiguration.activeInstructionTemplate;
    const builtInTemplate =
      surface === 'initialization' ? DEFAULT_INSTRUCTION_TEMPLATE : DEFAULT_CLI_INSTRUCTION_TEMPLATE;
    if (activeIdentity) {
      const managedTemplate =
        activeIdentity === 'default'
          ? builtInTemplate
          : (this.runtimeConfiguration.publishedInstructionTemplates?.[activeIdentity] ??
            this.runtimeConfiguration.instructionTemplates?.[activeIdentity])?.[surface];
      if (managedTemplate === undefined) {
        return this.renderManagedFallback(
          surface,
          activeIdentity,
          'Active instruction template is unavailable',
          builtInTemplate,
          filteredConnections,
          config,
          metadata,
        );
      }
      try {
        const rendered = this.renderTemplate(managedTemplate, filteredConnections, config, metadata);
        delete this.renderFailures[surface];
        return rendered;
      } catch (error) {
        return this.renderManagedFallback(
          surface,
          activeIdentity,
          error instanceof Error ? error.message : String(error),
          builtInTemplate,
          filteredConnections,
          config,
          metadata,
        );
      }
    }

    // Legacy custom templates remain initialization-only when managed selection is absent.
    if (surface === 'initialization' && config.customTemplate) {
      logger.info('InstructionAggregator: Trying custom template', { templateLength: config.customTemplate.length });
      try {
        return this.renderTemplate(config.customTemplate, filteredConnections, config, metadata);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Log detailed error for debugging
        logger.error('InstructionAggregator: Custom template failed, falling back to default template', {
          error: errorMessage,
          templateLength: config.customTemplate.length,
        });

        // Fall back to default template with LLM-directed notice
        const fallbackContent = this.renderTemplate(
          DEFAULT_INSTRUCTION_TEMPLATE,
          filteredConnections,
          config,
          metadata,
        );

        // Prepend notice for LLM to inform the user about template failure
        const llmNotice = `⚠️ IMPORTANT: The user's custom instruction template failed to render due to an error: "${errorMessage}". Please inform the user that their custom template configuration has an issue and the default template is being used instead. They should check their template syntax.\n\n`;
        return llmNotice + fallbackContent;
      }
    } else {
      // Use default template directly
      return this.renderTemplate(builtInTemplate, filteredConnections, config, metadata);
    }
  }

  /** Render an operator-supplied variant without changing active runtime state or failure history. */
  public previewInstructions(
    template: string,
    config: InboundConnectionConfig,
    connections: OutboundConnections,
    metadata: Record<string, InstructionRenderMetadata> = {},
  ): string {
    return this.renderTemplate(
      template,
      FilteringService.getFilteredConnections(connections, config),
      config,
      metadata,
    );
  }

  private renderManagedFallback(
    surface: InstructionSurface,
    templateIdentity: string,
    error: string,
    builtInTemplate: string,
    filteredConnections: OutboundConnections,
    config: InboundConnectionConfig,
    metadata: Record<string, InstructionRenderMetadata>,
  ): string {
    this.renderFailures[surface] = { surface, templateIdentity, error, occurredAt: new Date() };
    logger.error('InstructionAggregator: Managed template failed, falling back to built-in variant', {
      surface,
      templateIdentity,
      error,
    });
    return this.renderTemplate(builtInTemplate, filteredConnections, config, metadata);
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

  /** Resolve the source-qualified effective instructions for one outbound connection. */
  public getEffectiveServerInstructions(outboundKey: string, serverName: string): string | undefined {
    const target = this.instructionTargets.get(outboundKey) ?? {
      source: outboundKey === serverName ? ('mcpServers' as const) : ('mcpTemplates' as const),
      name: serverName,
    };
    return resolveEffectiveServerInstructions({
      target,
      upstreamInstructions: this.rawInstructions.get(outboundKey) ?? this.serverInstructions.get(serverName),
      configuredTargets: this.runtimeConfiguration.configuredTargets,
    });
  }

  /**
   * Clear all instructions (useful for testing)
   */
  public clear(): void {
    const hadInstructions = this.serverInstructions.size > 0 || this.rawInstructions.size > 0;
    this.serverInstructions.clear();
    this.rawInstructions.clear();
    this.instructionTargets.clear();

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
   * Extract a short description from server instructions
   * @param instructions The full server instructions
   * @returns A short description or undefined
   */
  private extractDescription(instructions: string): string | undefined {
    if (!instructions) return undefined;

    // Try to extract first line or first sentence
    const firstLine = instructions.split('\n')[0].trim();
    if (firstLine && firstLine.length < 100) {
      return firstLine.replace(/^#+\s*/, ''); // Remove markdown heading
    }

    // Look for a sentence ending with period
    const firstSentence = instructions.match(/^[^.]*\./)?.[0];
    if (firstSentence && firstSentence.length < 100) {
      return firstSentence.trim();
    }

    return undefined; // No suitable description found
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
    metadata: Record<string, InstructionRenderMetadata> = {},
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
    const variables = this.generateTemplateVariables(filteredConnections, config, metadata);

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
    metadata: Record<string, InstructionRenderMetadata> = {},
  ): TemplateVariables {
    // Get server data for both arrays and individual server objects
    const serverInstructionSections: string[] = [];
    const servers: ServerData[] = [];

    // Sort filtered connections by name for consistent output
    const sortedConnections = Array.from(filteredConnections.entries()).sort(([a], [b]) => a.localeCompare(b));

    for (const [outboundKey, connection] of sortedConnections) {
      // Use clean name from connection object instead of Map key
      // Template servers use hash-based keys (e.g., "serena:6fa053f1...") but we want
      // to display the clean name (e.g., "serena") in instructions
      const serverName = connection.name;
      const renderMetadata = metadata[outboundKey] ?? metadata[serverName] ?? {};
      const {
        target: renderTarget,
        upstreamInstructions: renderUpstreamInstructions,
        ...serverMetadata
      } = renderMetadata;
      const target = renderTarget ??
        this.instructionTargets.get(outboundKey) ?? {
          source: 'mcpServers' as const,
          name: serverName,
        };
      const upstreamInstructions = Object.hasOwn(renderMetadata, 'upstreamInstructions')
        ? renderUpstreamInstructions
        : (this.rawInstructions.get(outboundKey) ?? this.serverInstructions.get(serverName));
      const effectiveInstructions = resolveEffectiveServerInstructions({
        target,
        upstreamInstructions,
        configuredTargets: this.runtimeConfiguration.configuredTargets,
      });
      const isOverridden = hasConfiguredInstructionOverride(target, this.runtimeConfiguration.configuredTargets);
      const instructions = isOverridden ? (effectiveInstructions ?? '') : (effectiveInstructions?.trim() ?? '');
      const summaryMetadata = serverMetadata.summary ?? serverMetadata;
      if (instructions.length > 0) {
        // Wrap instructions in XML-like tags
        const wrappedInstructions = `<${serverName}>\n${instructions}\n</${serverName}>`;
        serverInstructionSections.push(wrappedInstructions);

        // Extract description from instructions
        const description = this.extractDescription(instructions);

        // Add individual server data for iteration
        servers.push({
          name: serverName,
          instructions: instructions,
          hasInstructions: true,
          description: description,
          source: target.source,
          ...serverMetadata,
          toolCount: serverMetadata.toolCount ?? 0,
          availableKnown: serverMetadata.available !== undefined,
          loadTrackedKnown: serverMetadata.loadTracked !== undefined,
          summary: {
            ...summaryMetadata,
            toolCount: summaryMetadata.toolCount ?? serverMetadata.toolCount ?? 0,
            hasInstructions: summaryMetadata.hasInstructions ?? true,
            availableKnown: summaryMetadata.available !== undefined,
            loadTrackedKnown: summaryMetadata.loadTracked !== undefined,
          },
        });
      } else {
        servers.push({
          name: serverName,
          instructions: '',
          hasInstructions: false,
          source: target.source,
          ...serverMetadata,
          toolCount: serverMetadata.toolCount ?? 0,
          availableKnown: serverMetadata.available !== undefined,
          loadTrackedKnown: serverMetadata.loadTracked !== undefined,
          summary: {
            ...summaryMetadata,
            toolCount: summaryMetadata.toolCount ?? serverMetadata.toolCount ?? 0,
            hasInstructions: summaryMetadata.hasInstructions ?? false,
            availableKnown: summaryMetadata.available !== undefined,
            loadTrackedKnown: summaryMetadata.loadTracked !== undefined,
          },
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
    this.rawInstructions.clear();
    this.instructionTargets.clear();
    this.renderFailures = {};

    // Reset initialization state
    this.isInitialized = false;

    logger.info('InstructionAggregator: Cleanup completed - all listeners cleared');
  }
}
