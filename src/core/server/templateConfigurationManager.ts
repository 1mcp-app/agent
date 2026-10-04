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
   * Merge server configurations
   * Note: ConfigManager.loadConfigWithTemplates already handles conflict detection
   * by filtering out static servers that conflict with template servers before returning them.
   * This method simply combines the two configurations.
   */
  private mergeServerConfigurations(
    staticServers: Record<string, MCPServerParams>,
    templateServers: Record<string, MCPServerParams>,
  ): Record<string, MCPServerParams> {
    return {
      ...staticServers,
      ...templateServers,
    };
  }

  /**
   * Reprocess templates when context changes with circuit breaker pattern
   */
  public async reprocessTemplatesWithNewContext(
    context: ContextData | undefined,
    updateServersCallback: (newConfig: Record<string, MCPServerParams>) => Promise<void>,
  ): Promise<void> {
    // Check if template processing is disabled due to repeated failures
    if (this.templateProcessingDisabled) {
      logger.warn(
        'templateConfigurationManager.template.processing.temporarily.disabled.due.to.repeated.failures.b2ad37a7',
      );
      return;
    }

    try {
      const configManager = ConfigManager.getInstance();
      const { staticServers, templateServers, errors } = await configManager.loadConfigWithTemplates(context);

      // Merge static and template servers with conflict resolution
      const newConfig = this.mergeServerConfigurations(staticServers, templateServers);

      // Call the callback to update servers
      await updateServersCallback(newConfig);

      if (errors.length > 0) {
        logger.warn('templateConfigurationManager.template.reprocessing.completed.with.errors.bd10403a');
      }

      const templateCount = Object.keys(templateServers).length;
      if (templateCount > 0) {
        logger.info('templateConfigurationManager.reprocessed.template.servers.with.new.context.8b389171');
      }

      // Reset error count on success
      this.templateProcessingErrors = 0;
      if (this.templateProcessingResetTimeout) {
        clearTimeout(this.templateProcessingResetTimeout);
        this.templateProcessingResetTimeout = undefined;
      }
    } catch (error) {
      this.templateProcessingErrors++;
      logger.error('templateConfigurationManager.failed.to.reprocess.templates.with.new.context.b78012e6', {
        error: error,
      });

      // Implement circuit breaker pattern
      if (this.templateProcessingErrors >= this.maxTemplateProcessingErrors) {
        this.templateProcessingDisabled = true;
        logger.error('templateConfigurationManager.template.processing.disabled.due.to.consecutive.failures.cf9104c7', {
          error: error,
        });

        // Reset after 5 minutes
        this.templateProcessingResetTimeout = setTimeout(
          () => {
            this.templateProcessingDisabled = false;
            this.templateProcessingErrors = 0;
            logger.info('templateConfigurationManager.template.processing.re.enabled.after.timeout.53c73a3e');
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
        logger.debug('templateConfigurationManager.successfully.updated.server.d3792672');
      } catch (_serverError) {
        logger.error('templateConfigurationManager.failed.to.update.server.d4020326', { error: _serverError });
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
        logger.info('templateConfigurationManager.stopping.server.no.longer.in.configuration.206a3906');
        await stopServerCallback(serverName);
      }
    }

    // Start or restart servers with new configurations
    for (const [serverName, config] of Object.entries(newConfig)) {
      const existingConfig = currentServers.get(serverName);

      if (existingConfig) {
        // Check if configuration changed
        if (this.configChanged(existingConfig, config)) {
          logger.info('templateConfigurationManager.restarting.server.with.updated.configuration.6c6d6977');
          await restartServerCallback(serverName, config);
        }
      } else {
        // New server, start it
        logger.info('templateConfigurationManager.starting.new.server.d11f5171');
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
    logger.info('templateConfigurationManager.circuit.breaker.reset.template.processing.re.enabled.19a7d7e5');
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
