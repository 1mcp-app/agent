import { getRuntimeScopeEnvironment, sanitizeRuntimeScopeError } from '@src/config/runtimeScopeEnv.js';
import { createRuntimeTargetFingerprint } from '@src/config/runtimeTargetFingerprint.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { BackendStdioSupervisor, type BackendSupervisionSnapshot } from '@src/core/server/backendStdioSupervisor.js';
import {
  createTemplateInstanceId,
  resolveTemplateInstanceId,
  serializePoolIdentity,
  templateRuntimeHash,
} from '@src/core/server/templateIdentity.js';
import type { AuthProviderTransport } from '@src/core/types/client.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import logger, { debugIf, infoIf } from '@src/logger/logger.js';
import { HandlebarsTemplateRenderer } from '@src/template/handlebarsTemplateRenderer.js';
import type { ContextData } from '@src/types/context.js';

import { createPooledClientInstance } from './clientInstanceFactory.js';
import { ClientPoolOptions, DEFAULT_POOL_OPTIONS, PooledClientInstance } from './clientInstancePoolTypes.js';

export type { ClientPoolOptions, PooledClientInstance };

interface PendingCreation {
  runtimeFingerprint: string;
  promise: Promise<PooledClientInstance>;
}

class StaleRuntimeEnvironmentError extends Error {}

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
  private pendingCreations = new Map<string, PendingCreation>();
  private reservedCreationsByTemplate = new Map<string, number>();
  private reservedCreationCount = 0;
  private removalOperations = new Map<string, Promise<void>>();
  private supervisionPublisher?: (instance: PooledClientInstance, snapshot: BackendSupervisionSnapshot) => void;
  private isShuttingDown = false;
  private shutdownPromise?: Promise<void>;

  constructor(options: Partial<ClientPoolOptions> = {}) {
    this.options = { ...DEFAULT_POOL_OPTIONS, ...options };

    debugIf(() => ({
      message: 'ClientInstancePool initialized',
      meta: { options: this.options },
    }));
  }

  setSupervisionPublisher(
    publisher: (instance: PooledClientInstance, snapshot: BackendSupervisionSnapshot) => void,
  ): void {
    this.supervisionPublisher = publisher;
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
    this.assertActive();

    // Render template with context data
    const renderer = new HandlebarsTemplateRenderer();
    const renderedConfig = renderer.renderTemplate(templateConfig, context);
    const renderedHash = templateRuntimeHash(renderedConfig);

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

    while (true) {
      const runtimeFingerprint = this.createRuntimeFingerprint(renderedConfig);
      const existingInstance = this.instances.get(instanceKey);
      if (existingInstance && existingInstance.status !== 'terminating') {
        if (existingInstance.runtimeFingerprint !== runtimeFingerprint) {
          await this.removeInstance(instanceKey);
          continue;
        }
        if (templateSettings.shareable || existingInstance.clientIds.has(clientId)) {
          return this.addClientToInstance(existingInstance, clientId);
        }
      }

      const pendingCreation = this.pendingCreations.get(instanceKey);
      if (pendingCreation) {
        try {
          const instance = await pendingCreation.promise;
          const currentFingerprint = this.createRuntimeFingerprint(renderedConfig);
          if (
            pendingCreation.runtimeFingerprint === currentFingerprint &&
            instance.runtimeFingerprint === currentFingerprint &&
            instance.status !== 'terminating'
          ) {
            return this.addClientToInstance(instance, clientId);
          }
          if (this.instances.get(instanceKey) === instance) {
            await this.removeInstance(instanceKey);
          }
        } catch (error) {
          if (
            !(error instanceof StaleRuntimeEnvironmentError) &&
            pendingCreation.runtimeFingerprint === this.createRuntimeFingerprint(renderedConfig)
          ) {
            throw error;
          }
        }
        continue;
      }

      const instancePromise = (async (): Promise<PooledClientInstance> => {
        this.reserveCreation(templateName, templateSettings.maxInstances);
        try {
          const instance = await createPooledClientInstance({
            instanceId: createTemplateInstanceId(),
            instanceKey,
            templateName,
            processedConfig: renderedConfig,
            renderedHash,
            runtimeFingerprint,
            clientId,
            idleTimeout: templateSettings.idleTimeout,
          });
          if (this.isShuttingDown) {
            await this.disposeInstance(instance);
            throw new Error('ClientInstancePool is shutting down');
          }
          if (this.createRuntimeFingerprint(renderedConfig) !== runtimeFingerprint) {
            await this.disposeInstance(instance);
            throw new StaleRuntimeEnvironmentError();
          }
          this.configureInstanceSupervision(instance);
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
        } finally {
          this.releaseCreationReservation(templateName);
        }
      })();

      const pending = { runtimeFingerprint, promise: instancePromise };
      this.pendingCreations.set(instanceKey, pending);
      try {
        return await instancePromise;
      } catch (error) {
        if (!(error instanceof StaleRuntimeEnvironmentError)) throw error;
      } finally {
        if (this.pendingCreations.get(instanceKey) === pending) {
          this.pendingCreations.delete(instanceKey);
        }
      }
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
      const supervisionState = instance.supervisor?.snapshot().state;
      if (supervisionState === 'restarting' || supervisionState === 'crash-loop') {
        instance.status = 'terminating';
        void this.removeInstance(instance.instanceKey);
        return;
      }
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
    const resolvedId = resolveTemplateInstanceId(
      instanceId,
      Array.from(this.instances.values(), (instance) => instance.id),
    );
    if (!resolvedId) {
      return undefined;
    }

    for (const [instanceKey, instance] of this.instances) {
      if (instance.id === resolvedId) {
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
   * Resolves a full or unambiguous-prefix instance ID within one template.
   */
  resolveTemplateInstance(templateName: string, instanceIdOrPrefix: string): PooledClientInstance | undefined {
    const instances = this.getTemplateInstances(templateName);
    const resolvedId = resolveTemplateInstanceId(
      instanceIdOrPrefix,
      instances.map((instance) => instance.id),
    );
    return resolvedId ? instances.find((instance) => instance.id === resolvedId) : undefined;
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

    // Make the removal visible before yielding so concurrent lookups cannot
    // attach new memberships to an instance that is already being closed.
    instance.status = 'terminating';
    return this.scheduleRemoval(instanceKey, instance);
  }

  private scheduleRemoval(instanceKey: string, instance: PooledClientInstance): Promise<void> {
    const previousRemoval = this.removalOperations.get(instanceKey) ?? Promise.resolve();
    const removal = previousRemoval
      .catch(() => undefined)
      .then(() => this.removeCapturedInstance(instanceKey, instance));
    this.removalOperations.set(instanceKey, removal);
    void removal.then(
      () => {
        if (this.removalOperations.get(instanceKey) === removal) {
          this.removalOperations.delete(instanceKey);
        }
      },
      () => {
        if (this.removalOperations.get(instanceKey) === removal) {
          this.removalOperations.delete(instanceKey);
        }
      },
    );
    return removal;
  }

  private async removeCapturedInstance(instanceKey: string, instance: PooledClientInstance): Promise<void> {
    if (this.instances.get(instanceKey) !== instance) {
      return;
    }

    instance.status = 'terminating';
    await instance.supervisor?.stop();

    await this.disposeInstance(instance);

    if (this.instances.get(instanceKey) === instance) {
      this.instances.delete(instanceKey);
      this.removeFromTemplateIndex(instance.templateName, instanceKey);
    }

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
      const timeoutThreshold = instance.idleTimeout ?? this.options.idleTimeout!;

      if (instance.status === 'idle' && idleTime >= timeoutThreshold) {
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
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.isShuttingDown = true;
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    await Promise.allSettled(Array.from(this.pendingCreations.values(), ({ promise }) => promise));

    const instanceCount = this.instances.size;

    await Promise.allSettled(
      Array.from(this.instances, ([instanceKey, instance]) => this.scheduleRemoval(instanceKey, instance)),
    );
    await Promise.allSettled(Array.from(this.removalOperations.values()));

    this.instances.clear();
    this.templateToInstances.clear();
    this.pendingCreations.clear();
    this.reservedCreationsByTemplate.clear();
    this.reservedCreationCount = 0;
    this.removalOperations.clear();

    debugIf(() => ({
      message: 'ClientInstancePool shutdown complete',
      meta: {
        instancesRemoved: instanceCount,
      },
    }));
  }

  private assertActive(): void {
    if (this.isShuttingDown) {
      throw new Error('ClientInstancePool is shutting down');
    }
  }

  private createRuntimeFingerprint(config: MCPServerParams): string {
    return createRuntimeTargetFingerprint(
      config,
      getRuntimeScopeEnvironment(),
      AgentConfigManager.getInstance().isEnvSubstitutionEnabled(),
    );
  }

  private async disposeInstance(instance: PooledClientInstance): Promise<void> {
    try {
      await instance.client.close();
    } catch (error) {
      logger.warn(`Error closing client for instance ${instance.id}:`, sanitizeRuntimeScopeError(error));
    }
    try {
      await instance.transport.close();
    } catch (error) {
      logger.warn(`Error closing transport for instance ${instance.id}:`, sanitizeRuntimeScopeError(error));
    }
  }

  async restartInstance(instance: PooledClientInstance): Promise<BackendSupervisionSnapshot> {
    if (!instance.supervisor) {
      throw new Error(`Template instance ${instance.id} does not have stdio supervision enabled`);
    }
    await instance.supervisor.restartNow();
    return instance.supervisor.snapshot();
  }

  private configureInstanceSupervision(instance: PooledClientInstance): void {
    const metadata = instance.transport.stdioSupervision;
    if (!metadata) return;

    const supervisor =
      instance.supervisor ??
      new BackendStdioSupervisor({
        backendId: `template:${instance.templateName}:${instance.id}`,
        policy: metadata.policy,
        initialPid: (instance.transport as AuthProviderTransport & { pid?: number }).pid ?? null,
        recover: async (signal) => {
          const currentClient = instance.client;
          currentClient.onclose = undefined;
          try {
            await currentClient.close();
          } catch (error) {
            debugIf(() => ({ message: `Could not close template instance ${instance.id}: ${error}` }));
          }
          if (signal.aborted || instance.status === 'terminating') {
            throw new Error(`Template recovery cancelled for ${instance.id}`);
          }

          const clientId = instance.clientIds.values().next().value as string | undefined;
          if (!clientId) {
            throw new Error(`Template instance ${instance.id} has no active memberships`);
          }
          const candidate = await createPooledClientInstance({
            instanceId: instance.id,
            instanceKey: instance.instanceKey,
            templateName: instance.templateName,
            processedConfig: instance.processedConfig,
            renderedHash: instance.renderedHash,
            runtimeFingerprint: instance.runtimeFingerprint,
            clientId,
            idleTimeout: instance.idleTimeout,
          });
          const dispose = async (): Promise<void> => {
            candidate.client.onclose = undefined;
            await candidate.client.close().catch(() => candidate.transport.close().catch(() => undefined));
          };
          return {
            pid: (candidate.transport as AuthProviderTransport & { pid?: number | null }).pid ?? null,
            activate: () => {
              instance.client = candidate.client;
              instance.transport = candidate.transport;
              this.configureInstanceSupervision(instance);
            },
            dispose,
          };
        },
        onStateChange: (snapshot) => {
          instance.supervision = snapshot;
          if (snapshot.state === 'restarting') instance.status = 'restarting';
          if (snapshot.state === 'crash-loop') instance.status = 'crash-loop';
          if (snapshot.state === 'connected') instance.status = instance.referenceCount > 0 ? 'active' : 'idle';
          if (snapshot.state === 'stopped') instance.status = 'terminating';
          logger.info(`Template backend stdio supervision state changed for ${instance.templateName}`, {
            instanceId: instance.id,
            state: snapshot.state,
            attempt: snapshot.attempt,
            limit: snapshot.limit,
            nextRetryAt: snapshot.nextRetryAt,
            lastExit: snapshot.lastExit,
            currentPid: snapshot.currentPid,
            error: snapshot.lastError?.message,
          });
          this.supervisionPublisher?.(instance, snapshot);
        },
      });
    instance.supervisor = supervisor;
    instance.supervision = supervisor.snapshot();

    const client = instance.client;
    client.onclose = () => {
      if (instance.client !== client || instance.status === 'terminating') return;
      if (instance.referenceCount === 0) {
        instance.status = 'terminating';
        void this.removeInstance(instance.instanceKey).catch((error) => {
          logger.warn(`Failed to remove idle template instance ${instance.id} after child exit:`, error);
        });
        return;
      }
      supervisor.handleUnexpectedExit(
        instance.transport.stdioSupervision?.getLastExit() ?? {
          code: null,
          signal: null,
          pid: (instance.transport as AuthProviderTransport & { pid?: number | null }).pid ?? null,
          at: new Date(),
        },
      );
    };
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
        idleTimeout: options?.idleTimeout ?? this.options.idleTimeout!,
        maxInstances: this.options.maxInstances!,
      };
    }

    return {
      shareable: templateConfig.template.shareable !== false, // Default to true
      perClient: templateConfig.template.perClient === true, // Default to false
      idleTimeout: templateConfig.template.idleTimeout ?? options?.idleTimeout ?? this.options.idleTimeout!,
      maxInstances: templateConfig.template.maxInstances ?? this.options.maxInstances!,
    };
  }

  /**
   * Creates a unique instance key from template name and variable hash
   */
  private createInstanceKey(templateName: string, variableHash: string, clientId?: string): string {
    return serializePoolIdentity({ templateName, renderedHash: variableHash, sessionId: clientId });
  }

  /**
   * Checks if creating a new instance would exceed limits
   */
  private reserveCreation(templateName: string, maxInstances: number): void {
    // Check per-template limit
    if (maxInstances > 0) {
      const templateInstances = this.getTemplateInstances(templateName);
      const activeCount = templateInstances.filter((instance) => instance.status !== 'terminating').length;
      const reservedCount = this.reservedCreationsByTemplate.get(templateName) ?? 0;

      if (activeCount + reservedCount >= maxInstances) {
        throw new Error(`Maximum instances (${maxInstances}) reached for template '${templateName}'`);
      }
    }

    // Check total limit
    if (this.options.maxTotalInstances && this.options.maxTotalInstances > 0) {
      const activeCount = Array.from(this.instances.values()).filter(
        (instance) => instance.status !== 'terminating',
      ).length;

      if (activeCount + this.reservedCreationCount >= this.options.maxTotalInstances) {
        throw new Error(`Maximum total instances (${this.options.maxTotalInstances}) reached`);
      }
    }

    this.reservedCreationsByTemplate.set(templateName, (this.reservedCreationsByTemplate.get(templateName) ?? 0) + 1);
    this.reservedCreationCount++;
  }

  private releaseCreationReservation(templateName: string): void {
    const reservedCount = this.reservedCreationsByTemplate.get(templateName) ?? 0;
    if (reservedCount <= 1) {
      this.reservedCreationsByTemplate.delete(templateName);
    } else {
      this.reservedCreationsByTemplate.set(templateName, reservedCount - 1);
    }
    this.reservedCreationCount--;
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
}
