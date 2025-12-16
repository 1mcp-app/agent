import { debugIf } from '@src/logger/logger.js';

/**
 * Template instance information
 */
export interface TemplateInstanceInfo {
  templateName: string;
  instanceId: string;
  clientIds: Set<string>;
  referenceCount: number;
  createdAt: Date;
  lastAccessed: Date;
  shareable: boolean;
  perClient: boolean;
}

/**
 * Client-template relationship information
 */
export interface ClientTemplateRelationship {
  clientId: string;
  templateName: string;
  instanceId: string;
  connectedAt: Date;
}

/**
 * Tracks client-template relationships and manages instance lifecycle
 * This prevents orphaned template instances and enables proper cleanup
 */
export class ClientTemplateTracker {
  private templateInstances = new Map<string, TemplateInstanceInfo>();
  private clientRelationships = new Map<string, ClientTemplateRelationship[]>();
  private instanceKeys = new Map<string, string>(); // instanceId -> templateName mapping

  /**
   * Add a client-template relationship
   */
  public addClientTemplate(
    clientId: string,
    templateName: string,
    instanceId: string,
    options: { shareable?: boolean; perClient?: boolean } = {},
  ): void {
    debugIf(() => ({
      message: `ClientTemplateTracker.addClientTemplate: Adding client ${clientId} to template ${templateName}:${instanceId}`,
      meta: {
        clientId,
        templateName,
        instanceId,
        shareable: options.shareable,
        perClient: options.perClient,
      },
    }));

    const instanceKey = `${templateName}:${instanceId}`;

    // Update or create template instance info
    let instanceInfo = this.templateInstances.get(instanceKey);
    if (!instanceInfo) {
      instanceInfo = {
        templateName,
        instanceId,
        clientIds: new Set(),
        referenceCount: 0,
        createdAt: new Date(),
        lastAccessed: new Date(),
        shareable: options.shareable ?? true,
        perClient: options.perClient ?? false,
      };
      this.templateInstances.set(instanceKey, instanceInfo);
      this.instanceKeys.set(instanceId, templateName);
    }

    // Add client to instance if not already present
    if (!instanceInfo.clientIds.has(clientId)) {
      instanceInfo.clientIds.add(clientId);
      instanceInfo.referenceCount++;
      instanceInfo.lastAccessed = new Date();
    }

    // Add relationship record
    const relationships = this.clientRelationships.get(clientId) || [];
    const existingRelationship = relationships.find(
      (rel) => rel.templateName === templateName && rel.instanceId === instanceId,
    );

    if (!existingRelationship) {
      relationships.push({
        clientId,
        templateName,
        instanceId,
        connectedAt: new Date(),
      });
      this.clientRelationships.set(clientId, relationships);
    }

    debugIf(() => ({
      message: `ClientTemplateTracker.addClientTemplate: Added relationship`,
      meta: {
        instanceKey,
        clientCount: instanceInfo.clientIds.size,
        referenceCount: instanceInfo.referenceCount,
        totalRelationships: relationships.length,
      },
    }));
  }

  /**
   * Remove a client and return list of instances to cleanup
   */
  public removeClient(clientId: string): string[] {
    debugIf(() => ({
      message: `ClientTemplateTracker.removeClient: Removing client ${clientId}`,
      meta: { clientId },
    }));

    const relationships = this.clientRelationships.get(clientId);
    if (!relationships) {
      debugIf(`ClientTemplateTracker.removeClient: No relationships found for client ${clientId}`);
      return [];
    }

    const instancesToCleanup: string[] = [];

    for (const relationship of relationships) {
      const instanceKey = `${relationship.templateName}:${relationship.instanceId}`;
      const instanceInfo = this.templateInstances.get(instanceKey);

      if (instanceInfo) {
        // Remove client from instance
        instanceInfo.clientIds.delete(clientId);
        instanceInfo.referenceCount--;

        debugIf(() => ({
          message: `ClientTemplateTracker.removeClient: Removed client from instance ${instanceKey}`,
          meta: {
            instanceKey,
            remainingClients: instanceInfo.clientIds.size,
            referenceCount: instanceInfo.referenceCount,
          },
        }));

        // If no more clients, mark for cleanup
        if (instanceInfo.referenceCount === 0) {
          instancesToCleanup.push(instanceKey);
        }
      }
    }

    // Clean up client relationships
    this.clientRelationships.delete(clientId);

    debugIf(() => ({
      message: `ClientTemplateTracker.removeClient: Client ${clientId} removal completed`,
      meta: {
        relationshipsRemoved: relationships.length,
        instancesToCleanup: instancesToCleanup.length,
      },
    }));

    return instancesToCleanup;
  }

  /**
   * Remove client from specific template instance
   */
  public removeClientFromInstance(clientId: string, templateName: string, instanceId: string): boolean {
    const instanceKey = `${templateName}:${instanceId}`;
    const instanceInfo = this.templateInstances.get(instanceKey);

    if (!instanceInfo || !instanceInfo.clientIds.has(clientId)) {
      return false;
    }

    instanceInfo.clientIds.delete(clientId);
    instanceInfo.referenceCount--;

    // Remove from client relationships
    const relationships = this.clientRelationships.get(clientId) || [];
    const filteredRelationships = relationships.filter(
      (rel) => !(rel.templateName === templateName && rel.instanceId === instanceId),
    );

    if (filteredRelationships.length === 0) {
      this.clientRelationships.delete(clientId);
    } else {
      this.clientRelationships.set(clientId, filteredRelationships);
    }

    debugIf(() => ({
      message: `ClientTemplateTracker.removeClientFromInstance: Removed client ${clientId} from ${instanceKey}`,
      meta: {
        instanceKey,
        remainingClients: instanceInfo.clientIds.size,
        referenceCount: instanceInfo.referenceCount,
        shouldCleanup: instanceInfo.referenceCount === 0,
      },
    }));

    return instanceInfo.referenceCount === 0; // Return true if should cleanup
  }

  /**
   * Check if an instance has clients
   */
  public hasClients(templateName: string, instanceId: string): boolean {
    const instanceKey = `${templateName}:${instanceId}`;
    const instanceInfo = this.templateInstances.get(instanceKey);
    return instanceInfo ? instanceInfo.clientIds.size > 0 : false;
  }

  /**
   * Get client count for an instance
   */
  public getClientCount(templateName: string, instanceId: string): number {
    const instanceKey = `${templateName}:${instanceId}`;
    const instanceInfo = this.templateInstances.get(instanceKey);
    return instanceInfo ? instanceInfo.clientIds.size : 0;
  }

  /**
   * Get all instances for a template
   */
  public getTemplateInstances(templateName: string): string[] {
    const instances: string[] = [];
    for (const [_instanceKey, instanceInfo] of this.templateInstances) {
      if (instanceInfo.templateName === templateName) {
        instances.push(instanceInfo.instanceId);
      }
    }
    return instances;
  }

  /**
   * Get all templates for a client
   */
  public getClientTemplates(clientId: string): Array<{ templateName: string; instanceId: string }> {
    const relationships = this.clientRelationships.get(clientId) || [];
    return relationships.map((rel) => ({
      templateName: rel.templateName,
      instanceId: rel.instanceId,
    }));
  }

  /**
   * Get idle instances (no clients for specified duration)
   */
  public getIdleInstances(
    idleTimeoutMs: number,
  ): Array<{ templateName: string; instanceId: string; idleTime: number }> {
    const now = new Date();
    const idleInstances: Array<{ templateName: string; instanceId: string; idleTime: number }> = [];

    for (const [_instanceKey, instanceInfo] of this.templateInstances) {
      if (instanceInfo.clientIds.size === 0) {
        const idleTime = now.getTime() - instanceInfo.lastAccessed.getTime();
        if (idleTime >= idleTimeoutMs) {
          idleInstances.push({
            templateName: instanceInfo.templateName,
            instanceId: instanceInfo.instanceId,
            idleTime,
          });
        }
      }
    }

    return idleInstances;
  }

  /**
   * Get statistics for monitoring and debugging
   */
  public getStats(): {
    totalInstances: number;
    totalClients: number;
    totalRelationships: number;
    idleInstances: number;
    averageClientsPerInstance: number;
  } {
    const totalInstances = this.templateInstances.size;
    const totalClients = this.clientRelationships.size;
    const totalRelationships = Array.from(this.clientRelationships.values()).reduce(
      (sum, relationships) => sum + relationships.length,
      0,
    );

    const idleInstances = Array.from(this.templateInstances.values()).filter(
      (instance) => instance.clientIds.size === 0,
    ).length;

    const totalClientsAcrossInstances = Array.from(this.templateInstances.values()).reduce(
      (sum, instance) => sum + instance.clientIds.size,
      0,
    );

    const averageClientsPerInstance = totalInstances > 0 ? totalClientsAcrossInstances / totalInstances : 0;

    return {
      totalInstances,
      totalClients,
      totalRelationships,
      idleInstances,
      averageClientsPerInstance,
    };
  }

  /**
   * Get detailed information for debugging
   */
  public getDetailedInfo(): {
    instances: Array<{
      templateName: string;
      instanceId: string;
      clientCount: number;
      referenceCount: number;
      shareable: boolean;
      perClient: boolean;
      createdAt: Date;
      lastAccessed: Date;
    }>;
    clients: Array<{
      clientId: string;
      templateCount: number;
      templates: Array<{ templateName: string; instanceId: string; connectedAt: Date }>;
    }>;
  } {
    const instances = Array.from(this.templateInstances.values()).map((instance) => ({
      templateName: instance.templateName,
      instanceId: instance.instanceId,
      clientCount: instance.clientIds.size,
      referenceCount: instance.referenceCount,
      shareable: instance.shareable,
      perClient: instance.perClient,
      createdAt: instance.createdAt,
      lastAccessed: instance.lastAccessed,
    }));

    const clients = Array.from(this.clientRelationships.entries()).map(([clientId, relationships]) => ({
      clientId,
      templateCount: relationships.length,
      templates: relationships.map((rel) => ({
        templateName: rel.templateName,
        instanceId: rel.instanceId,
        connectedAt: rel.connectedAt,
      })),
    }));

    return { instances, clients };
  }

  /**
   * Clean up an instance completely
   */
  public cleanupInstance(templateName: string, instanceId: string): void {
    const instanceKey = `${templateName}:${instanceId}`;
    const instanceInfo = this.templateInstances.get(instanceKey);

    if (instanceInfo) {
      // Remove from all client relationships
      for (const clientId of instanceInfo.clientIds) {
        const relationships = this.clientRelationships.get(clientId) || [];
        const filteredRelationships = relationships.filter(
          (rel) => !(rel.templateName === templateName && rel.instanceId === instanceId),
        );

        if (filteredRelationships.length === 0) {
          this.clientRelationships.delete(clientId);
        } else {
          this.clientRelationships.set(clientId, filteredRelationships);
        }
      }

      // Remove instance
      this.templateInstances.delete(instanceKey);
      this.instanceKeys.delete(instanceId);

      debugIf(() => ({
        message: `ClientTemplateTracker.cleanupInstance: Cleaned up instance ${instanceKey}`,
        meta: {
          instanceKey,
          clientsRemoved: instanceInfo.clientIds.size,
        },
      }));
    }
  }

  /**
   * Clear all tracking data (for testing)
   */
  public clear(): void {
    this.templateInstances.clear();
    this.clientRelationships.clear();
    this.instanceKeys.clear();
  }
}
