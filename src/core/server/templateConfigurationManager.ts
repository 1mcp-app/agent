import { ConfigManager } from '@src/config/configManager.js';
import { MCPServerParams } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import type { ContextData } from '@src/types/context.js';

/**
 * Manages template configuration reprocessing with circuit breaker pattern
 */
export class TemplateConfigurationManager {
  // Circuit breaker state
  private templateProcessingErrors = 0;
  private readonly maxTemplateProcessingErrors = 3;
  private templateProcessingDisabled = false;
  private templateProcessingResetTimeout?: ReturnType<typeof setTimeout>;

  /**
   * Reprocess templates when context changes with circuit breaker pattern
   */
  public async reprocessTemplatesWithNewContext(
    context: ContextData | undefined,
    updateServersCallback: (newConfig: Record<string, MCPServerParams>) => Promise<void>,
  ): Promise<void> {
    // Check if template processing is disabled due to repeated failures
    if (this.templateProcessingDisabled) {
      logger.warn('Template processing temporarily disabled due to repeated failures');
      return;
    }

    try {
      const configManager = ConfigManager.getInstance();
      const { staticServers, templateServers, errors } = await configManager.loadConfigWithTemplates(context);

      // Merge static and template servers
      const newConfig = { ...staticServers, ...templateServers };

      // Call the callback to update servers
      await updateServersCallback(newConfig);

      if (errors.length > 0) {
        logger.warn(`Template reprocessing completed with ${errors.length} errors:`, { errors });
      }

      const templateCount = Object.keys(templateServers).length;
      if (templateCount > 0) {
        logger.info(`Reprocessed ${templateCount} template servers with new context`);
      }

      // Reset error count on success
      this.templateProcessingErrors = 0;
      if (this.templateProcessingResetTimeout) {
        clearTimeout(this.templateProcessingResetTimeout);
        this.templateProcessingResetTimeout = undefined;
      }
    } catch (error) {
      this.templateProcessingErrors++;
      logger.error(
        `Failed to reprocess templates with new context (${this.templateProcessingErrors}/${this.maxTemplateProcessingErrors}):`,
        {
          error: error instanceof Error ? error.message : String(error),
          context: context?.sessionId ? `session ${context.sessionId}` : 'unknown',
        },
      );

      // Implement circuit breaker pattern
      if (this.templateProcessingErrors >= this.maxTemplateProcessingErrors) {
        this.templateProcessingDisabled = true;
        logger.error(`Template processing disabled due to ${this.templateProcessingErrors} consecutive failures`);

        // Reset after 5 minutes
        this.templateProcessingResetTimeout = setTimeout(
          () => {
            this.templateProcessingDisabled = false;
            this.templateProcessingErrors = 0;
            logger.info('Template processing re-enabled after timeout');
          },
          5 * 60 * 1000,
        );
      }
      throw error;
    }
  }

  /**
   * Update servers individually to handle partial failures
   */
  public async updateServersIndividually(
    newConfig: Record<string, MCPServerParams>,
    updateServerCallback: (serverName: string, config: MCPServerParams) => Promise<void>,
  ): Promise<void> {
    const promises = Object.entries(newConfig).map(async ([serverName, config]) => {
      try {
        await updateServerCallback(serverName, config);
        logger.debug(`Successfully updated server: ${serverName}`);
      } catch (serverError) {
        logger.error(`Failed to update server ${serverName}:`, serverError);
        // Continue with other servers even if one fails
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Update servers with new configuration
   */
  public async updateServersWithNewConfig(
    newConfig: Record<string, MCPServerParams>,
    currentServers: Map<string, MCPServerParams>,
    startServerCallback: (serverName: string, config: MCPServerParams) => Promise<void>,
    stopServerCallback: (serverName: string) => Promise<void>,
    restartServerCallback: (serverName: string, config: MCPServerParams) => Promise<void>,
  ): Promise<void> {
    const currentServerNames = new Set(currentServers.keys());
    const newServerNames = new Set(Object.keys(newConfig));

    // Stop servers that are no longer in the configuration
    for (const serverName of currentServerNames) {
      if (!newServerNames.has(serverName)) {
        logger.info(`Stopping server no longer in configuration: ${serverName}`);
        await stopServerCallback(serverName);
      }
    }

    // Start or restart servers with new configurations
    for (const [serverName, config] of Object.entries(newConfig)) {
      const existingConfig = currentServers.get(serverName);

      if (existingConfig) {
        // Check if configuration changed
        if (this.configChanged(existingConfig, config)) {
          logger.info(`Restarting server with updated configuration: ${serverName}`);
          await restartServerCallback(serverName, config);
        }
      } else {
        // New server, start it
        logger.info(`Starting new server: ${serverName}`);
        await startServerCallback(serverName, config);
      }
    }
  }

  /**
   * Check if server configuration has changed
   */
  public configChanged(oldConfig: MCPServerParams, newConfig: MCPServerParams): boolean {
    return JSON.stringify(oldConfig) !== JSON.stringify(newConfig);
  }

  /**
   * Check if template processing is currently disabled
   */
  public isTemplateProcessingDisabled(): boolean {
    return this.templateProcessingDisabled;
  }

  /**
   * Get current error count
   */
  public getErrorCount(): number {
    return this.templateProcessingErrors;
  }

  /**
   * Reset the circuit breaker state
   */
  public resetCircuitBreaker(): void {
    this.templateProcessingErrors = 0;
    this.templateProcessingDisabled = false;
    if (this.templateProcessingResetTimeout) {
      clearTimeout(this.templateProcessingResetTimeout);
      this.templateProcessingResetTimeout = undefined;
    }
    logger.info('Circuit breaker reset - template processing re-enabled');
  }

  /**
   * Clean up resources
   */
  public cleanup(): void {
    if (this.templateProcessingResetTimeout) {
      clearTimeout(this.templateProcessingResetTimeout);
      this.templateProcessingResetTimeout = undefined;
    }
  }
}
