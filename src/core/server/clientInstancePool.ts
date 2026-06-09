import { serializePoolIdentity, templateRenderedHash } from '@src/core/server/templateIdentity.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import logger, { debugIf, infoIf } from '@src/logger/logger.js';
import { HandlebarsTemplateRenderer } from '@src/template/handlebarsTemplateRenderer.js';
import type { ContextData } from '@src/types/context.js';

import { createPooledClientInstance } from './clientInstanceFactory.js';
import { ClientPoolOptions, DEFAULT_POOL_OPTIONS, PooledClientInstance } from './clientInstancePoolTypes.js';

export type { ClientPoolOptions, PooledClientInstance };

/**
 * Manages a pool of MCP client instances created from templates
 *
 * This class handles:
 * - Creating new client instances from templates with specific variables
 * - Reusing existing instances when template variables match
 * - Managing client connections per instance
 * - Cleaning up idle instances to free resources
 */
export class ClientInstancePool {
  private instances = new Map<string, PooledClientInstance>();
  private templateToInstances = new Map<string, Set<string>>();
  private options: ClientPoolOptions;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private instanceCounter = 0;
  private pendingCreations = new Map<string, Promise<PooledClientInstance>>();

  constructor(options: Partial<ClientPoolOptions> = {}) {
    this.options = { ...DEFAULT_POOL_OPTIONS, ...options };
    this.startCleanupTimer();

    debugIf(() => ({
      message: 'ClientInstancePool initialized',
      meta: { options: this.options },
    }));
  }

  /**
   * Creates or retrieves a client instance for the given template and variables
   */
  async getOrCreateClientInstance(
    templateName: string,
    templateConfig: MCPServerParams,
    context: ContextData,
    clientId: string,
    options?: {
      shareable?: boolean;
      perClient?: boolean;
      idleTimeout?: number;
    },
  ): Promise<PooledClientInstance> {
    // Render template with context data
    const renderer = new HandlebarsTemplateRenderer();
    const renderedConfig = renderer.renderTemplate(templateConfig, context);
    const renderedHash = templateRenderedHash(renderedConfig);

    // Debug logging to verify template rendering
    debugIf(() => ({
      message: 'Template rendering details',
      meta: {
        templateName,
        clientId,
        projectPath: context.project?.path || 'undefined',
        renderedConfig,
        renderedHash: renderedHash.substring(0, 8) + '...',
        hasRenderedChanges: JSON.stringify(renderedConfig) !== JSON.stringify(templateConfig),
      },
    }));

    infoIf(() => ({
      message: 'Processing template for client instance',
      meta: {
        templateName,
        clientId,
        renderedHash: renderedHash.substring(0, 8) + '...',
        shareable: !options?.perClient && options?.shareable !== false,
      },
    }));

    // Get template configuration with proper defaults
    const templateSettings = this.getTemplateSettings(templateConfig, options);
    const instanceKey = this.createInstanceKey(
      templateName,
      renderedHash,
      templateSettings.perClient || !templateSettings.shareable ? clientId : undefined,
    );
    logger.info(`Template ${templateName}, renderedHash: ${renderedHash}, Instance key: ${instanceKey}`);

    // Check for existing instance
    const existingInstance = this.instances.get(instanceKey);

    if (existingInstance && existingInstance.status !== 'terminating') {
      // Check if this template is shareable
      if (templateSettings.shareable || existingInstance.clientIds.has(clientId)) {
        return this.addClientToInstance(existingInstance, clientId);
      }
    }

    const pendingCreation = this.pendingCreations.get(instanceKey);
    if (pendingCreation) {
      const instance = await pendingCreation;
      if (instance.status !== 'terminating') {
        return this.addClientToInstance(instance, clientId);
      }
    }

    const instancePromise = (async (): Promise<PooledClientInstance> => {
      // Check instance limits before creating new
      this.checkInstanceLimits(templateName);

      // Create new client instance
      const instance: PooledClientInstance = await createPooledClientInstance({
        instanceId: this.generateInstanceId(),
        instanceKey,
        templateName,
        processedConfig: renderedConfig,
        renderedHash,
        clientId,
        idleTimeout: templateSettings.idleTimeout,
      });

      this.instances.set(instanceKey, instance);
      this.addToTemplateIndex(templateName, instanceKey);

      infoIf(() => ({
        message: 'Created new client instance from template',
        meta: {
          instanceId: instance.id,
          templateName,
          renderedHash: renderedHash.substring(0, 8) + '...',
          clientId,
          shareable: templateSettings.shareable,
        },
      }));

      return instance;
    })();

    this.pendingCreations.set(instanceKey, instancePromise);
    try {
      return await instancePromise;
    } finally {
      this.pendingCreations.delete(instanceKey);
    }
  }

  /**
   * Adds a client to an existing instance
   */
  addClientToInstance(instance: PooledClientInstance, clientId: string): PooledClientInstance {
    if (!instance.clientIds.has(clientId)) {
      instance.clientIds.add(clientId);
      instance.referenceCount++;
      instance.lastUsedAt = new Date();
      instance.status = 'active';

      debugIf(() => ({
        message: 'Added client to existing client instance',
        meta: {
          instanceId: instance.id,
          clientId,
          clientCount: instance.referenceCount,
        },
      }));
    }

    return instance;
  }

  /**
   * Removes a client from an instance
   */
  removeClientFromInstance(instanceKey: string, clientId: string, idleSince: Date = new Date()): void {
    const instance = this.instances.get(instanceKey);
    if (!instance) {
      return;
    }

    instance.clientIds.delete(clientId);
    instance.referenceCount = Math.max(0, instance.referenceCount - 1);

    debugIf(() => ({
      message: 'Removed client from client instance',
      meta: {
        instanceId: instance.id,
        clientId,
        clientCount: instance.referenceCount,
      },
    }));

    // Mark as idle if no more clients
    if (instance.referenceCount === 0) {
      instance.status = 'idle';
      instance.lastUsedAt = idleSince; // Set lastUsedAt to when it became idle

      infoIf(() => ({
        message: 'Client instance marked as idle',
        meta: {
          instanceId: instance.id,
          templateName: instance.templateName,
        },
      }));
    }
  }

  /**
   * Gets an instance by its key
   */
  getInstance(instanceKey: string): PooledClientInstance | undefined {
    return this.instances.get(instanceKey);
  }

  /**
   * Gets an instance key by its generated instance ID
   */
  getInstanceKeyById(instanceId: string): string | undefined {
    for (const [instanceKey, instance] of this.instances) {
      if (instance.id === instanceId) {
        return instanceKey;
      }
    }

    return undefined;
  }

  /**
   * Gets all instances for a specific template
   */
  getTemplateInstances(templateName: string): PooledClientInstance[] {
    const instanceKeys = this.templateToInstances.get(templateName);
    if (!instanceKeys) {
      return [];
    }

    return Array.from(instanceKeys)
      .map((key) => this.instances.get(key))
      .filter((instance): instance is PooledClientInstance => !!instance);
  }

  /**
   * Gets all active instances in the pool
   */
  getAllInstances(): PooledClientInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Manually removes an instance from the pool
   */
  async removeInstance(instanceKey: string): Promise<void> {
    const instance = this.instances.get(instanceKey);
    if (!instance) {
      return;
    }

    instance.status = 'terminating';

    try {
      // Close transport and client connection
      await instance.client.close();
      await instance.transport.close();
    } catch (error) {
      logger.warn(`Error closing client instance ${instance.id}:`, error);
    }

    this.instances.delete(instanceKey);
    this.removeFromTemplateIndex(instance.templateName, instanceKey);

    infoIf(() => ({
      message: 'Removed client instance from pool',
      meta: {
        instanceId: instance.id,
        templateName: instance.templateName,
        clientCount: instance.referenceCount,
      },
    }));
  }

  /**
   * Forces cleanup of idle instances
   */
  async cleanupIdleInstances(): Promise<void> {
    const now = new Date();
    const instancesToRemove: string[] = [];

    for (const [instanceKey, instance] of this.instances) {
      const idleTime = now.getTime() - instance.lastUsedAt.getTime();

      // Use instance-specific timeout if available, otherwise use pool-wide timeout
      const timeoutThreshold = instance.idleTimeout || this.options.idleTimeout!;

      if (instance.status === 'idle' && idleTime > timeoutThreshold) {
        instancesToRemove.push(instanceKey);
      }
    }

    if (instancesToRemove.length > 0) {
      infoIf(() => ({
        message: 'Cleaning up idle client instances',
        meta: {
          count: instancesToRemove.length,
          instances: instancesToRemove.map((key) => {
            const instance = this.instances.get(key);
            return {
              instanceId: instance?.id,
              templateName: instance?.templateName,
              idleTime: instance ? now.getTime() - instance.lastUsedAt.getTime() : 0,
            };
          }),
        },
      }));

      await Promise.all(instancesToRemove.map((key) => this.removeInstance(key)));
    }
  }

  /**
   * Shuts down the instance pool and cleans up all resources
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Mark all instances as terminating
    for (const instance of this.instances.values()) {
      instance.status = 'terminating';
    }

    const instanceCount = this.instances.size;

    // Close all client connections and transports
    await Promise.all(
      Array.from(this.instances.values()).map(async (instance) => {
        try {
          await instance.client.close();
          await instance.transport.close();
        } catch (error) {
          logger.warn(`Error shutting down client instance ${instance.id}:`, error);
        }
      }),
    );

    this.instances.clear();
    this.templateToInstances.clear();
    this.pendingCreations.clear();

    debugIf(() => ({
      message: 'ClientInstancePool shutdown complete',
      meta: {
        instancesRemoved: instanceCount,
      },
    }));
  }

  /**
   * Gets pool statistics for monitoring
   */
  getStats(): {
    totalInstances: number;
    activeInstances: number;
    idleInstances: number;
    templateCount: number;
    totalClients: number;
  } {
    const instances = Array.from(this.instances.values());
    const activeCount = instances.filter((i) => i.status === 'active').length;
    const idleCount = instances.filter((i) => i.status === 'idle').length;
    const totalClients = instances.reduce((sum, i) => sum + i.referenceCount, 0);

    return {
      totalInstances: instances.length,
      activeInstances: activeCount,
      idleInstances: idleCount,
      templateCount: this.templateToInstances.size,
      totalClients,
    };
  }

  /**
   * Gets template configuration with proper defaults
   */
  private getTemplateSettings(
    templateConfig: MCPServerParams,
    options?: {
      shareable?: boolean;
      perClient?: boolean;
      idleTimeout?: number;
    },
  ): {
    shareable: boolean;
    perClient: boolean;
    idleTimeout: number;
    maxInstances: number;
  } {
    // Apply defaults if template configuration is undefined
    if (!templateConfig.template) {
      return {
        shareable: options?.shareable !== false, // Default to true
        perClient: options?.perClient === true, // Default to false
        idleTimeout: options?.idleTimeout || this.options.idleTimeout!,
        maxInstances: this.options.maxInstances!,
      };
    }

    return {
      shareable: templateConfig.template.shareable !== false, // Default to true
      perClient: templateConfig.template.perClient === true, // Default to false
      idleTimeout: templateConfig.template.idleTimeout || this.options.idleTimeout!,
      maxInstances: templateConfig.template.maxInstances || this.options.maxInstances!,
    };
  }

  /**
   * Creates a unique instance key from template name and variable hash
   */
  private createInstanceKey(templateName: string, variableHash: string, clientId?: string): string {
    return serializePoolIdentity({ templateName, renderedHash: variableHash, sessionId: clientId });
  }

  /**
   * Generates a unique instance ID
   */
  private generateInstanceId(): string {
    return `client-instance-${++this.instanceCounter}-${Date.now()}`;
  }

  /**
   * Checks if creating a new instance would exceed limits
   */
  private checkInstanceLimits(templateName: string): void {
    // Check per-template limit
    if (this.options.maxInstances! > 0) {
      const templateInstances = this.getTemplateInstances(templateName);
      const activeCount = templateInstances.filter((instance) => instance.status !== 'terminating').length;

      if (activeCount >= this.options.maxInstances!) {
        throw new Error(`Maximum instances (${this.options.maxInstances}) reached for template '${templateName}'`);
      }
    }

    // Check total limit
    if (this.options.maxTotalInstances && this.options.maxTotalInstances > 0) {
      const activeCount = Array.from(this.instances.values()).filter(
        (instance) => instance.status !== 'terminating',
      ).length;

      if (activeCount >= this.options.maxTotalInstances) {
        throw new Error(`Maximum total instances (${this.options.maxTotalInstances}) reached`);
      }
    }
  }

  /**
   * Adds an instance to the template index
   */
  private addToTemplateIndex(templateName: string, instanceKey: string): void {
    if (!this.templateToInstances.has(templateName)) {
      this.templateToInstances.set(templateName, new Set());
    }
    this.templateToInstances.get(templateName)!.add(instanceKey);
  }

  /**
   * Removes an instance from the template index
   */
  private removeFromTemplateIndex(templateName: string, instanceKey: string): void {
    const instanceKeys = this.templateToInstances.get(templateName);
    if (instanceKeys) {
      instanceKeys.delete(instanceKey);
      if (instanceKeys.size === 0) {
        this.templateToInstances.delete(templateName);
      }
    }
  }

  /**
   * Starts the periodic cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.options.cleanupInterval! > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanupIdleInstances().catch((error) => {
          logger.error('Error during client instance cleanup:', error);
        });
      }, this.options.cleanupInterval!);

      // Ensure the timer doesn't prevent process exit
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
  }
}
