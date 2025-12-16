import type { MCPServerParams } from '@src/core/types/transport.js';
import { debugIf, infoIf } from '@src/logger/logger.js';
import { createHash as createStringHash } from '@src/utils/crypto.js';

/**
 * Represents a unique identifier for a server instance based on template and variables
 */
export interface ServerInstanceKey {
  templateName: string;
  variableHash: string;
}

/**
 * Represents an active MCP server instance created from a template
 */
export interface ServerInstance {
  /** Unique identifier for this instance */
  id: string;
  /** Name of the template this instance was created from */
  templateName: string;
  /** Processed server configuration with template variables substituted */
  processedConfig: MCPServerParams;
  /** Hash of the template variables used to create this instance */
  variableHash: string;
  /** Extracted template variables for this instance */
  templateVariables: Record<string, unknown>;
  /** Number of clients currently connected to this instance */
  clientCount: number;
  /** Timestamp when this instance was created */
  createdAt: Date;
  /** Timestamp of last client activity */
  lastUsedAt: Date;
  /** Current status of the instance */
  status: 'active' | 'idle' | 'terminating';
  /** Set of client IDs connected to this instance */
  clientIds: Set<string>;
}

/**
 * Configuration options for the server instance pool
 */
export interface ServerPoolOptions {
  /** Maximum number of instances per template (0 = unlimited) */
  maxInstances: number;
  /** Time in milliseconds to wait before terminating idle instances */
  idleTimeout: number;
  /** Interval in milliseconds to run cleanup checks */
  cleanupInterval: number;
  /** Maximum total instances across all templates (0 = unlimited) */
  maxTotalInstances?: number;
}

/**
 * Default pool configuration
 */
const DEFAULT_POOL_OPTIONS: ServerPoolOptions = {
  maxInstances: 10,
  idleTimeout: 5 * 60 * 1000, // 5 minutes
  cleanupInterval: 60 * 1000, // 1 minute
  maxTotalInstances: 100,
};

/**
 * Manages a pool of MCP server instances created from templates
 *
 * This class handles:
 * - Creating new instances from templates with specific variables
 * - Reusing existing instances when template variables match
 * - Tracking client connections per instance
 * - Cleaning up idle instances to free resources
 */
export class ServerInstancePool {
  private instances = new Map<string, ServerInstance>();
  private templateToInstances = new Map<string, Set<string>>();
  private options: ServerPoolOptions;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private instanceCounter = 0;

  constructor(options: Partial<ServerPoolOptions> = {}) {
    this.options = { ...DEFAULT_POOL_OPTIONS, ...options };
    this.startCleanupTimer();

    debugIf(() => ({
      message: 'ServerInstancePool initialized',
      meta: { options: this.options },
    }));
  }

  /**
   * Creates or retrieves a server instance for the given template and variables
   */
  getOrCreateInstance(
    templateName: string,
    templateConfig: MCPServerParams,
    processedConfig: MCPServerParams,
    templateVariables: Record<string, unknown>,
    clientId: string,
  ): ServerInstance {
    // Create hash of template variables for comparison
    const variableHash = this.createVariableHash(templateVariables);
    const instanceKey = this.createInstanceKey(
      templateName,
      variableHash,
      templateConfig.template?.perClient ? clientId : undefined,
    );

    // Check for existing instance
    const existingInstance = this.instances.get(instanceKey);

    if (existingInstance && existingInstance.status !== 'terminating') {
      // Check if this template is shareable
      const isShareable = !templateConfig.template?.perClient && templateConfig.template?.shareable !== false;

      if (isShareable) {
        return this.addClientToInstance(existingInstance, clientId);
      }
    }

    // Check instance limits before creating new
    this.checkInstanceLimits(templateName);

    // Create new instance
    const instance: ServerInstance = {
      id: this.generateInstanceId(),
      templateName,
      processedConfig,
      variableHash,
      templateVariables,
      clientCount: 1,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      status: 'active',
      clientIds: new Set([clientId]),
    };

    this.instances.set(instanceKey, instance);
    this.addToTemplateIndex(templateName, instanceKey);

    infoIf(() => ({
      message: 'Created new server instance from template',
      meta: {
        instanceId: instance.id,
        templateName,
        variableHash,
        clientId,
      },
    }));

    return instance;
  }

  /**
   * Adds a client to an existing instance
   */
  addClientToInstance(instance: ServerInstance, clientId: string): ServerInstance {
    if (!instance.clientIds.has(clientId)) {
      instance.clientIds.add(clientId);
      instance.clientCount++;
      instance.lastUsedAt = new Date();
      instance.status = 'active';

      debugIf(() => ({
        message: 'Added client to existing server instance',
        meta: {
          instanceId: instance.id,
          clientId,
          clientCount: instance.clientCount,
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
    instance.clientCount = Math.max(0, instance.clientCount - 1);

    debugIf(() => ({
      message: 'Removed client from server instance',
      meta: {
        instanceId: instance.id,
        clientId,
        clientCount: instance.clientCount,
      },
    }));

    // Mark as idle if no more clients
    if (instance.clientCount === 0) {
      instance.status = 'idle';
      instance.lastUsedAt = new Date(); // Set lastUsedAt to when it became idle

      infoIf(() => ({
        message: 'Server instance marked as idle',
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
  getInstance(instanceKey: string): ServerInstance | undefined {
    return this.instances.get(instanceKey);
  }

  /**
   * Gets all instances for a specific template
   */
  getTemplateInstances(templateName: string): ServerInstance[] {
    const instanceKeys = this.templateToInstances.get(templateName);
    if (!instanceKeys) {
      return [];
    }

    return Array.from(instanceKeys)
      .map((key) => this.instances.get(key))
      .filter((instance): instance is ServerInstance => !!instance);
  }

  /**
   * Gets all active instances in the pool
   */
  getAllInstances(): ServerInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Manually removes an instance from the pool
   */
  removeInstance(instanceKey: string): void {
    const instance = this.instances.get(instanceKey);
    if (!instance) {
      return;
    }

    instance.status = 'terminating';
    this.instances.delete(instanceKey);
    this.removeFromTemplateIndex(instance.templateName, instanceKey);

    infoIf(() => ({
      message: 'Removed server instance from pool',
      meta: {
        instanceId: instance.id,
        templateName: instance.templateName,
        clientCount: instance.clientCount,
      },
    }));
  }

  /**
   * Forces cleanup of idle instances
   */
  cleanupIdleInstances(): void {
    const now = new Date();
    const instancesToRemove: string[] = [];

    for (const [instanceKey, instance] of this.instances) {
      const idleTime = now.getTime() - instance.lastUsedAt.getTime();

      // Use template-specific timeout if available, otherwise use pool-wide timeout
      const templateIdleTimeout = instance.processedConfig.template?.idleTimeout || this.options.idleTimeout;

      if (instance.status === 'idle' && idleTime > templateIdleTimeout) {
        instancesToRemove.push(instanceKey);
      }
    }

    if (instancesToRemove.length > 0) {
      infoIf(() => ({
        message: 'Cleaning up idle server instances',
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

      instancesToRemove.forEach((key) => this.removeInstance(key));
    }
  }

  /**
   * Shuts down the instance pool and cleans up all resources
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Mark all instances as terminating
    for (const instance of this.instances.values()) {
      instance.status = 'terminating';
    }

    const instanceCount = this.instances.size;
    this.instances.clear();
    this.templateToInstances.clear();

    debugIf(() => ({
      message: 'ServerInstancePool shutdown complete',
      meta: {
        instancesRemoved: instanceCount,
      },
    }));
  }

  /**
   * Creates a hash of template variables for efficient comparison
   */
  private createVariableHash(variables: Record<string, unknown>): string {
    const variableString = JSON.stringify(variables, Object.keys(variables).sort());
    return createStringHash(variableString);
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
    return `instance-${++this.instanceCounter}-${Date.now()}`;
  }

  /**
   * Checks if creating a new instance would exceed limits
   */
  private checkInstanceLimits(templateName: string): void {
    // Check per-template limit
    if (this.options.maxInstances > 0) {
      const templateInstances = this.getTemplateInstances(templateName);
      const activeCount = templateInstances.filter((instance) => instance.status !== 'terminating').length;

      if (activeCount >= this.options.maxInstances) {
        // Try to clean up idle instances first
        this.cleanupIdleInstances();

        // Recount after cleanup
        const newCount = this.getTemplateInstances(templateName).filter(
          (instance) => instance.status !== 'terminating',
        ).length;

        if (newCount >= this.options.maxInstances) {
          throw new Error(`Maximum instances (${this.options.maxInstances}) reached for template '${templateName}'`);
        }
      }
    }

    // Check total limit
    if (this.options.maxTotalInstances && this.options.maxTotalInstances > 0) {
      const activeCount = Array.from(this.instances.values()).filter(
        (instance) => instance.status !== 'terminating',
      ).length;

      if (activeCount >= this.options.maxTotalInstances) {
        this.cleanupIdleInstances();

        const newCount = Array.from(this.instances.values()).filter(
          (instance) => instance.status !== 'terminating',
        ).length;

        if (newCount >= this.options.maxTotalInstances) {
          throw new Error(`Maximum total instances (${this.options.maxTotalInstances}) reached`);
        }
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
    if (this.options.cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanupIdleInstances();
      }, this.options.cleanupInterval);

      // Ensure the timer doesn't prevent process exit
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
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
    const totalClients = instances.reduce((sum, i) => sum + i.clientCount, 0);

    return {
      totalInstances: instances.length,
      activeInstances: activeCount,
      idleInstances: idleCount,
      templateCount: this.templateToInstances.size,
      totalClients,
    };
  }
}
