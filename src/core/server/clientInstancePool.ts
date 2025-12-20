import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { AuthProviderTransport } from '@src/core/types/index.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import logger, { debugIf, infoIf } from '@src/logger/logger.js';
import { createTransportsWithContext } from '@src/transport/transportFactory.js';
import type { ContextData } from '@src/types/context.js';
import { createVariableHash } from '@src/utils/crypto.js';

/**
 * Configuration options for client instance pool
 */
export interface ClientPoolOptions {
  /** Maximum number of instances per template (0 = unlimited) */
  maxInstances?: number;
  /** Time in milliseconds to wait before terminating idle instances */
  idleTimeout?: number;
  /** Interval in milliseconds to run cleanup checks */
  cleanupInterval?: number;
  /** Maximum total instances across all templates (0 = unlimited) */
  maxTotalInstances?: number;
}

/**
 * Default pool configuration
 */
const DEFAULT_POOL_OPTIONS: ClientPoolOptions = {
  maxInstances: 10,
  idleTimeout: 5 * 60 * 1000, // 5 minutes
  cleanupInterval: 60 * 1000, // 1 minute
  maxTotalInstances: 100,
};

/**
 * Represents a pooled client instance connected to an upstream MCP server
 */
export interface PooledClientInstance {
  /** Unique identifier for this instance */
  id: string;
  /** Name of the template this instance was created from */
  templateName: string;
  /** MCP client instance */
  client: Client;
  /** Transport connected to upstream server */
  transport: AuthProviderTransport;
  /** Hash of the template variables used to create this instance */
  variableHash: string;
  /** Extracted template variables for this instance */
  templateVariables: Record<string, unknown>;
  /** Processed server configuration */
  processedConfig: MCPServerParams;
  /** Number of clients currently connected to this instance */
  referenceCount: number;
  /** Timestamp when this instance was created */
  createdAt: Date;
  /** Timestamp of last client activity */
  lastUsedAt: Date;
  /** Current status of the instance */
  status: 'active' | 'idle' | 'terminating';
  /** Set of client IDs connected to this instance */
  clientIds: Set<string>;
  /** Template-specific idle timeout */
  idleTimeout: number;
}

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
    // Create hash of template variables for comparison
    const extractor = await import('@src/template/templateVariableExtractor.js');
    const variableExtractor = new extractor.TemplateVariableExtractor();

    const templateVariables = variableExtractor.getUsedVariables(templateConfig, context);
    const variableHash = createVariableHash(templateVariables);

    infoIf(() => ({
      message: 'Processing template for client instance',
      meta: {
        templateName,
        clientId,
        variableCount: Object.keys(templateVariables).length,
        variableHash: variableHash.substring(0, 8) + '...',
        shareable: !options?.perClient && options?.shareable !== false,
      },
    }));

    // Process template with variables
    const processedConfig = await this.processTemplateWithVariables(templateConfig, context, templateVariables);

    // Get template configuration with proper defaults
    const templateSettings = this.getTemplateSettings(templateConfig, options);
    const instanceKey = this.createInstanceKey(
      templateName,
      variableHash,
      templateSettings.perClient ? clientId : undefined,
    );

    // Check for existing instance
    const existingInstance = this.instances.get(instanceKey);

    if (existingInstance && existingInstance.status !== 'terminating') {
      // Check if this template is shareable
      if (templateSettings.shareable) {
        return this.addClientToInstance(existingInstance, clientId);
      }
    }

    // Check instance limits before creating new
    this.checkInstanceLimits(templateName);

    // Create new client instance
    const instance: PooledClientInstance = await this.createNewInstance(
      templateName,
      templateConfig,
      processedConfig,
      templateVariables,
      variableHash,
      clientId,
      templateSettings.idleTimeout,
    );

    this.instances.set(instanceKey, instance);
    this.addToTemplateIndex(templateName, instanceKey);

    infoIf(() => ({
      message: 'Created new client instance from template',
      meta: {
        instanceId: instance.id,
        templateName,
        variableHash: variableHash.substring(0, 8) + '...',
        clientId,
        shareable: templateSettings.shareable,
      },
    }));

    return instance;
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
  removeClientFromInstance(instanceKey: string, clientId: string): void {
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
      instance.lastUsedAt = new Date(); // Set lastUsedAt to when it became idle

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
   * Processes a template configuration with specific variables
   */
  private async processTemplateWithVariables(
    templateConfig: MCPServerParams,
    fullContext: ContextData,
    templateVariables: Record<string, unknown>,
  ): Promise<MCPServerParams> {
    try {
      const { TemplateProcessor } = await import('@src/template/templateProcessor.js');

      // Create a context with only the variables used by this template
      const filteredContext: ContextData = {
        ...fullContext,
        // Only include the variables that are actually used
        project: this.filterObject(fullContext.project as Record<string, unknown>, templateVariables, 'project.'),
        user: this.filterObject(fullContext.user as Record<string, unknown>, templateVariables, 'user.'),
        environment: this.filterObject(
          fullContext.environment as Record<string, unknown>,
          templateVariables,
          'environment.',
        ),
      };

      // Process the template
      const templateProcessor = new TemplateProcessor({
        strictMode: false,
        allowUndefined: true,
        validateTemplates: true,
        cacheResults: true,
      });

      const result = await templateProcessor.processServerConfig('template-instance', templateConfig, filteredContext);

      return result.processedConfig;
    } catch (error) {
      logger.warn('Template processing failed, using original config:', {
        error: error instanceof Error ? error.message : String(error),
        templateVariables: Object.keys(templateVariables),
      });

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
   * Creates a new client instance and connects to upstream server
   */
  private async createNewInstance(
    templateName: string,
    templateConfig: MCPServerParams,
    processedConfig: MCPServerParams,
    templateVariables: Record<string, unknown>,
    variableHash: string,
    clientId: string,
    idleTimeout: number,
  ): Promise<PooledClientInstance> {
    // Create transport for the upstream server
    const transports = await createTransportsWithContext(
      {
        [templateName]: processedConfig,
      },
      undefined, // No context needed as templates are already processed
    );

    const transport = transports[templateName];
    if (!transport) {
      throw new Error(`Failed to create transport for template ${templateName}`);
    }

    // Create client instance
    const { ClientManager } = await import('@src/core/client/clientManager.js');
    const clientManager = ClientManager.getOrCreateInstance();
    const client = clientManager.createPooledClientInstance();

    // Connect client to the upstream server
    await client.connect(transport);

    return {
      id: this.generateInstanceId(),
      templateName,
      client,
      transport,
      variableHash,
      templateVariables,
      processedConfig,
      referenceCount: 1,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      status: 'active',
      clientIds: new Set([clientId]),
      idleTimeout,
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
    if (clientId) {
      return `${templateName}:${variableHash}:${clientId}`;
    }
    return `${templateName}:${variableHash}`;
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
