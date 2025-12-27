import { createHash } from 'crypto';

import {
  mcpServerConfigSchema,
  MCPServerConfiguration,
  MCPServerParams,
  TemplateSettings,
} from '@src/core/types/transport.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { HandlebarsTemplateRenderer } from '@src/template/handlebarsTemplateRenderer.js';
import type { ContextData } from '@src/types/context.js';

import { TemplateLoadResult } from './types.js';

export class TemplateProcessor {
  private templateProcessingErrors: string[] = [];
  private processedTemplates: Record<string, MCPServerParams> = {};
  private lastContextHash?: string;

  public async loadConfigWithTemplates(rawConfig: unknown, context?: ContextData): Promise<TemplateLoadResult> {
    let config: MCPServerConfiguration;

    try {
      config = mcpServerConfigSchema.parse(rawConfig);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to parse configuration: ${errorMessage}`);
      return {
        staticServers: {},
        templateServers: {},
        errors: [`Configuration parsing failed: ${errorMessage}`],
      };
    }

    const settings = config.templateSettings;

    const staticServers: Record<string, MCPServerParams> = {};
    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      staticServers[serverName] = serverConfig;
    }

    let templateServers: Record<string, MCPServerParams> = {};
    let errors: string[] = [];

    if (config.mcpTemplates) {
      if (context) {
        const contextHash = this.hashContext(context);

        if (
          settings?.cacheContext &&
          this.lastContextHash === contextHash &&
          Object.keys(this.processedTemplates).length > 0
        ) {
          templateServers = this.processedTemplates;
          errors = this.templateProcessingErrors;
        } else {
          const result = await this.processTemplates(config.mcpTemplates, context, settings);
          templateServers = result.servers;
          errors = result.errors;

          if (settings?.cacheContext) {
            this.processedTemplates = templateServers;
            this.templateProcessingErrors = errors;
            this.lastContextHash = contextHash;
          }
        }
      }
    }

    const conflictingServers: string[] = [];
    for (const staticServerName of Object.keys(staticServers)) {
      if (staticServerName in templateServers) {
        conflictingServers.push(staticServerName);
        delete staticServers[staticServerName];
      }
    }

    if (conflictingServers.length > 0) {
      logger.warn(
        `Ignoring ${conflictingServers.length} static server(s) that conflict with template servers: ${conflictingServers.join(', ')}`,
      );
    }

    return { staticServers, templateServers, errors };
  }

  private async processTemplates(
    templates: Record<string, MCPServerParams>,
    context: ContextData,
    settings?: TemplateSettings,
  ): Promise<{ servers: Record<string, MCPServerParams>; errors: string[] }> {
    const errors: string[] = [];
    const templateRenderer = new HandlebarsTemplateRenderer();
    const processedServers: Record<string, MCPServerParams> = {};

    for (const [serverName, templateConfig] of Object.entries(templates)) {
      try {
        const processedConfig = templateRenderer.renderTemplate(templateConfig, context);
        processedServers[serverName] = processedConfig;

        debugIf(() => ({
          message: 'Template processed successfully',
          meta: { serverName },
        }));
      } catch (error) {
        const errorMsg = `Template processing failed for ${serverName}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        logger.error(errorMsg);

        if (settings?.failureMode === 'graceful') {
          processedServers[serverName] = templateConfig;
        }
      }
    }

    return { servers: processedServers, errors };
  }

  private hashContext(context: ContextData): string {
    return createHash('sha256').update(JSON.stringify(context)).digest('hex');
  }

  public getTemplateProcessingErrors(): string[] {
    return [...this.templateProcessingErrors];
  }

  public hasTemplateProcessingErrors(): boolean {
    return this.templateProcessingErrors.length > 0;
  }

  public clearTemplateCache(): void {
    this.processedTemplates = {};
    this.lastContextHash = undefined;
    this.templateProcessingErrors = [];
  }
}
