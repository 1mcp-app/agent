import {
  type ServerInstance,
  ServerInstancePool,
  type ServerPoolOptions,
} from '@src/core/server/serverInstancePool.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import { debugIf, infoIf, warnIf } from '@src/logger/logger.js';
import { TemplateProcessor } from '@src/template/templateProcessor.js';
import { type ExtractionOptions, TemplateVariableExtractor } from '@src/template/templateVariableExtractor.js';
import type { ContextData, ContextNamespace, EnvironmentContext, UserContext } from '@src/types/context.js';

/**
 * Configuration options for template-based server creation
 */
export interface TemplateServerOptions {
  /** Whether this template creates shareable server instances */
  shareable?: boolean;
  /** Maximum instances per template (0 = unlimited) */
  maxInstances?: number;
  /** Idle timeout before termination in milliseconds */
  idleTimeout?: number;
  /** Force per-client instances (overrides shareable) */
  perClient?: boolean;
  /** Options for variable extraction */
  extractionOptions?: ExtractionOptions;
}

/**
 * Factory for creating MCP server instances from templates with specific context variables
 *
 * This class:
 * - Orchestrates the creation of server instances from templates
 * - Manages the server instance pool
 * - Handles template processing with context variables
 * - Provides a clean interface for ServerManager to use
 */
export class TemplateServerFactory {
  private instancePool: ServerInstancePool;
  private variableExtractor: TemplateVariableExtractor;
  private templateProcessor: TemplateProcessor;

  constructor(poolOptions?: Partial<ServerPoolOptions>) {
    this.instancePool = new ServerInstancePool(poolOptions);
    this.variableExtractor = new TemplateVariableExtractor();
    this.templateProcessor = new TemplateProcessor();

    debugIf(() => ({
      message: 'TemplateServerFactory initialized',
      meta: { poolOptions },
    }));
  }

  /**
   * Gets or creates a server instance for the given template and client context
   */
  async getOrCreateServerInstance(
    templateName: string,
    templateConfig: MCPServerParams,
    clientContext: ContextData,
    clientId: string,
    options?: TemplateServerOptions,
  ): Promise<ServerInstance> {
    // Extract variables used by this template
    const templateVariables = this.variableExtractor.getUsedVariables(
      templateConfig,
      clientContext,
      options?.extractionOptions,
    );

    // Create hash of variables for comparison
    const variableHash = this.variableExtractor.createVariableHash(templateVariables);

    infoIf(() => ({
      message: 'Processing template for server instance',
      meta: {
        templateName,
        clientId,
        variableCount: Object.keys(templateVariables).length,
        variableHash: variableHash.substring(0, 8) + '...',
        shareable: !options?.perClient && options?.shareable !== false,
      },
    }));

    // Process template with extracted variables
    const processedConfig = await this.processTemplateWithVariables(templateConfig, clientContext, templateVariables);

    // Get or create instance from pool
    const instance = this.instancePool.getOrCreateInstance(
      templateName,
      templateConfig,
      processedConfig,
      templateVariables,
      clientId,
    );

    return instance;
  }

  /**
   * Removes a client from a server instance
   */
  removeClientFromInstance(templateName: string, templateVariables: Record<string, unknown>, clientId: string): void {
    const variableHash = this.variableExtractor.createVariableHash(templateVariables);
    const instanceKey = `${templateName}:${variableHash}`;

    this.instancePool.removeClientFromInstance(instanceKey, clientId);
  }

  /**
   * Removes a client from a server instance by instance key
   */
  removeClientFromInstanceByKey(instanceKey: string, clientId: string): void {
    this.instancePool.removeClientFromInstance(instanceKey, clientId);
  }

  /**
   * Removes an instance by instance key
   */
  removeInstanceByKey(instanceKey: string): void {
    this.instancePool.removeInstance(instanceKey);
  }

  /**
   * Gets an existing server instance
   */
  getInstance(templateName: string, templateVariables: Record<string, unknown>): ServerInstance | undefined {
    const variableHash = this.variableExtractor.createVariableHash(templateVariables);
    const instanceKey = `${templateName}:${variableHash}`;

    return this.instancePool.getInstance(instanceKey);
  }

  /**
   * Gets all instances for a specific template
   */
  getTemplateInstances(templateName: string): ServerInstance[] {
    return this.instancePool.getTemplateInstances(templateName);
  }

  /**
   * Gets all instances in the pool
   */
  getAllInstances(): ServerInstance[] {
    return this.instancePool.getAllInstances();
  }

  /**
   * Manually removes an instance from the pool
   */
  removeInstance(templateName: string, templateVariables: Record<string, unknown>): void {
    const variableHash = this.variableExtractor.createVariableHash(templateVariables);
    const instanceKey = `${templateName}:${variableHash}`;

    this.instancePool.removeInstance(instanceKey);
  }

  /**
   * Forces cleanup of idle instances
   */
  cleanupIdleInstances(): void {
    this.instancePool.cleanupIdleInstances();
  }

  /**
   * Shuts down the factory and cleans up all resources
   */
  shutdown(): void {
    this.instancePool.shutdown();
    this.variableExtractor.clearCache();

    debugIf(() => ({
      message: 'TemplateServerFactory shutdown complete',
    }));
  }

  /**
   * Gets factory statistics for monitoring
   */
  getStats(): {
    pool: ReturnType<ServerInstancePool['getStats']>;
    cache: ReturnType<TemplateVariableExtractor['getCacheStats']>;
  } {
    return {
      pool: this.instancePool.getStats(),
      cache: this.variableExtractor.getCacheStats(),
    };
  }

  /**
   * Processes a template configuration with specific variables
   */
  private async processTemplateWithVariables(
    templateConfig: MCPServerParams,
    fullContext: ContextData,
    templateVariables: Record<string, unknown>,
  ): Promise<MCPServerParams> {
    try {
      // Create a context with only the variables used by this template
      const filteredContext: ContextData = {
        ...fullContext,
        // Only include the variables that are actually used
        project: this.filterObject(
          fullContext.project as Record<string, unknown>,
          templateVariables,
          'project.',
        ) as ContextNamespace,
        user: this.filterObject(fullContext.user as Record<string, unknown>, templateVariables, 'user.') as UserContext,
        environment: this.filterObject(
          fullContext.environment as Record<string, unknown>,
          templateVariables,
          'environment.',
        ) as EnvironmentContext,
      };

      // Process the template
      const result = await this.templateProcessor.processServerConfig(
        'template-instance',
        templateConfig,
        filteredContext,
      );

      return result.processedConfig;
    } catch (error) {
      // If template processing fails, log and return original config
      warnIf(() => ({
        message: 'Template processing failed, using original config',
        meta: {
          error: error instanceof Error ? error.message : String(error),
          templateVariables: Object.keys(templateVariables),
        },
      }));

      return templateConfig;
    }
  }

  /**
   * Filters an object to only include properties referenced in templateVariables
   */
  private filterObject(
    obj: Record<string, unknown> | undefined,
    templateVariables: Record<string, unknown>,
    prefix: string,
  ): Record<string, unknown> {
    if (!obj || typeof obj !== 'object') {
      return obj || {};
    }

    const filtered: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = `${prefix}${key}`;

      // Check if this property or any nested property is referenced
      const isReferenced = Object.keys(templateVariables).some(
        (varKey) => varKey === fullKey || varKey.startsWith(fullKey + '.'),
      );

      if (isReferenced) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          // Recursively filter nested objects
          filtered[key] = this.filterObject(value as Record<string, unknown>, templateVariables, `${fullKey}.`);
        } else {
          filtered[key] = value;
        }
      }
    }

    return filtered;
  }

  /**
   * Validates template configuration for server creation
   */
  private validateTemplateConfig(templateConfig: MCPServerParams): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!templateConfig.command && !templateConfig.url) {
      errors.push('Template must specify either "command" or "url"');
    }

    // Check for required template processing dependencies
    const variables = this.variableExtractor.extractTemplateVariables(templateConfig);

    // Warn about potentially problematic configurations
    if (variables.length === 0) {
      debugIf(() => ({
        message: 'Template configuration contains no variables',
        meta: { configKeys: Object.keys(templateConfig) },
      }));
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Creates a template key for caching and identification
   */
  private createTemplateKey(templateName: string): string {
    return this.variableExtractor.createTemplateKey({
      command: templateName,
    });
  }
}
