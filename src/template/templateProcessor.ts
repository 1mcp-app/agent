import logger, { debugIf } from '@src/logger/logger.js';
import type { ContextData, MCPServerParams } from '@src/types/context.js';

import { ConfigFieldProcessor } from './configFieldProcessor.js';
import { TemplateParser } from './templateParser.js';
import type { TemplateParseResult } from './templateParser.js';
import { TemplateValidator } from './templateValidator.js';

/**
 * Template processing options
 */
export interface TemplateProcessorOptions {
  strictMode?: boolean;
  allowUndefined?: boolean;
  validateTemplates?: boolean;
  cacheResults?: boolean;
}

/**
 * Template processing result
 */
export interface TemplateProcessingResult {
  success: boolean;
  processedConfig: MCPServerParams;
  processedTemplates: string[];
  errors: string[];
  warnings: string[];
}

/**
 * Template Processor
 *
 * Processes templates in MCP server configurations with context data.
 * Handles command, args, env, cwd, and other template fields.
 */
export class TemplateProcessor {
  private parser: TemplateParser;
  private validator: TemplateValidator;
  private fieldProcessor: ConfigFieldProcessor;
  private options: Required<TemplateProcessorOptions>;
  private cache: Map<string, TemplateParseResult> = new Map();
  private cacheStats = {
    hits: 0,
    misses: 0,
  };

  constructor(options: TemplateProcessorOptions = {}) {
    this.options = {
      strictMode: options.strictMode ?? false,
      allowUndefined: options.allowUndefined ?? true,
      validateTemplates: options.validateTemplates ?? true,
      cacheResults: options.cacheResults ?? true,
    };

    this.parser = new TemplateParser({
      strictMode: this.options.strictMode,
      allowUndefined: this.options.allowUndefined,
    });

    this.validator = new TemplateValidator({
      allowSensitiveData: false, // Never allow sensitive data in templates
      // Transport-specific validation can be added later if needed
    });

    this.fieldProcessor = new ConfigFieldProcessor(
      this.parser,
      this.validator,
      // Pass processTemplate method to enable caching
      (template: string, context: ContextData) => this.processTemplate(template, context),
    );
  }

  /**
   * Process a single MCP server configuration
   */
  async processServerConfig(
    serverName: string,
    config: MCPServerParams,
    context: ContextData,
  ): Promise<TemplateProcessingResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const processedTemplates: string[] = [];

    try {
      debugIf(() => ({
        message: 'Processing server configuration templates',
        meta: {
          serverName,
          hasCommand: !!config.command,
          hasArgs: !!(config.args && config.args.length > 0),
          hasEnv: !!(config.env && Object.keys(config.env).length > 0),
          hasCwd: !!config.cwd,
        },
      }));

      // Create a deep copy to avoid mutating the original
      const processedConfig: MCPServerParams = JSON.parse(JSON.stringify(config)) as MCPServerParams;

      // Create enhanced context with transport information
      const enhancedContext: ContextData = {
        ...context,
        transport: {
          type: processedConfig.type || 'unknown',
          // Don't include URL in transport context to avoid circular dependency
          url: undefined,
          connectionId: `conn_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          connectionTimestamp: new Date().toISOString(),
        },
      };

      // Process string fields using the field processor
      if (processedConfig.command) {
        processedConfig.command = this.fieldProcessor.processStringField(
          processedConfig.command,
          'command',
          enhancedContext,
          errors,
          processedTemplates,
        );
      }

      // Process array fields
      if (processedConfig.args) {
        processedConfig.args = this.fieldProcessor.processArrayField(
          processedConfig.args,
          'args',
          enhancedContext,
          errors,
          processedTemplates,
        );
      }

      // Process string fields that may have templates
      if (processedConfig.cwd) {
        processedConfig.cwd = this.fieldProcessor.processStringField(
          processedConfig.cwd,
          'cwd',
          enhancedContext,
          errors,
          processedTemplates,
        );
      }

      // Process env field (can be Record<string, string> or string[])
      if (processedConfig.env) {
        processedConfig.env = this.fieldProcessor.processObjectField(
          processedConfig.env,
          'env',
          enhancedContext,
          errors,
          processedTemplates,
        ) as Record<string, string> | string[];
      }

      if (processedConfig.headers) {
        processedConfig.headers = this.fieldProcessor.processRecordField(
          processedConfig.headers,
          'headers',
          enhancedContext,
          errors,
          processedTemplates,
        );
      }

      // Process URL field for HTTP/SSE transports
      if (processedConfig.url) {
        processedConfig.url = this.fieldProcessor.processStringField(
          processedConfig.url,
          'url',
          enhancedContext,
          errors,
          processedTemplates,
        );
      }

      // Process headers for HTTP/SSE transports
      if (processedConfig.headers) {
        for (const [headerName, headerValue] of Object.entries(processedConfig.headers)) {
          if (typeof headerValue === 'string') {
            processedConfig.headers[headerName] = this.fieldProcessor.processStringField(
              headerValue,
              `headers.${headerName}`,
              enhancedContext,
              errors,
              processedTemplates,
            );
          }
        }
      }

      // Prefix errors with server name
      const prefixedErrors = errors.map((e) => `${serverName}: ${e}`);

      debugIf(() => ({
        message: 'Template processing complete',
        meta: {
          serverName,
          templateCount: processedTemplates.length,
          errorCount: prefixedErrors.length,
        },
      }));

      return {
        success: prefixedErrors.length === 0,
        processedConfig,
        processedTemplates,
        errors: prefixedErrors,
        warnings,
      };
    } catch (error) {
      const errorMsg = `Template processing failed for ${serverName}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);

      return {
        success: false,
        processedConfig: config,
        processedTemplates,
        errors: [errorMsg],
        warnings,
      };
    }
  }

  /**
   * Process multiple server configurations
   */
  async processMultipleServerConfigs(
    configs: Record<string, MCPServerParams>,
    context: ContextData,
  ): Promise<Record<string, TemplateProcessingResult>> {
    const results: Record<string, TemplateProcessingResult> = {};

    // Process all configurations concurrently for better performance
    await Promise.all(
      Object.entries(configs).map(async ([serverName, config]) => {
        results[serverName] = await this.processServerConfig(serverName, config, context);
      }),
    );

    return results;
  }

  /**
   * Process a single template string with caching
   */
  private processTemplate(template: string, context: ContextData): TemplateParseResult {
    // Check cache first
    const cacheKey = `${template}:${context.sessionId}`;

    if (this.options.cacheResults && this.cache.has(cacheKey)) {
      this.cacheStats.hits++;
      return this.cache.get(cacheKey)!;
    }

    this.cacheStats.misses++;

    // Parse template
    const result = this.parser.parse(template, context);

    // Cache result if enabled
    if (this.options.cacheResults) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Clear the template cache
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheStats.hits = 0;
    this.cacheStats.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return {
      size: this.cache.size,
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
      hitRate: total > 0 ? Math.round((this.cacheStats.hits / total) * 100) / 100 : 0,
    };
  }
}
