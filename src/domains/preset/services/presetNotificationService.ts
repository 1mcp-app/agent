import { EventEmitter } from 'events';

import logger from '@src/logger/logger.js';

/**
 * Client connection interface for tracking
 */
export interface ClientConnection {
  id: string;
  presetName?: string;
  sendNotification(method: string, params?: unknown): Promise<void>;
  isConnected(): boolean;
}

/**
 * PresetNotificationService manages client tracking and notifications
 * when presets are modified. Sends listChanged notifications to affected clients.
 */
export class PresetNotificationService extends EventEmitter {
  private static instance: PresetNotificationService;
  private clientsByPreset = new Map<string, Set<ClientConnection>>();
  private clientsById = new Map<string, ClientConnection>();

  private constructor() {
    super();
  }

  public static getInstance(): PresetNotificationService {
    if (!PresetNotificationService.instance) {
      PresetNotificationService.instance = new PresetNotificationService();
    }
    return PresetNotificationService.instance;
  }

  /**
   * Track a client connection with its associated preset
   */
  public trackClient(client: ClientConnection, presetName?: string): void {
    // Store client by ID for quick lookup
    this.clientsById.set(client.id, client);

    if (presetName) {
      // Track client by preset
      if (!this.clientsByPreset.has(presetName)) {
        this.clientsByPreset.set(presetName, new Set());
      }

      const clientSet = this.clientsByPreset.get(presetName)!;
      clientSet.add(client);

      // Update client's preset association
      client.presetName = presetName;

      logger.debug('Client tracked for preset', {
        clientId: client.id,
        presetName,
        totalClientsForPreset: clientSet.size,
      });
    } else {
      logger.debug('Client tracked without preset', { clientId: client.id });
    }

    this.emit('client_tracked', { client, presetName });
  }

  /**
   * Untrack a client connection
   */
  public untrackClient(clientId: string): void {
    const client = this.clientsById.get(clientId);
    if (!client) {
      return;
    }

    // Remove from clients by ID
    this.clientsById.delete(clientId);

    // Remove from preset tracking if associated
    if (client.presetName) {
      const clientSet = this.clientsByPreset.get(client.presetName);
      if (clientSet) {
        clientSet.delete(client);

        // Clean up empty preset sets
        if (clientSet.size === 0) {
          this.clientsByPreset.delete(client.presetName);
        }

        logger.debug('Client untracked from preset', {
          clientId,
          presetName: client.presetName,
          remainingClientsForPreset: clientSet.size,
        });
      }
    }

    this.emit('client_untracked', { clientId, presetName: client.presetName });
  }

  /**
   * Update a client's preset association
   */
  public updateClientPreset(clientId: string, newPresetName?: string): void {
    const client = this.clientsById.get(clientId);
    if (!client) {
      logger.warn('Attempted to update preset for unknown client', { clientId });
      return;
    }

    const oldPresetName = client.presetName;

    // Remove from old preset tracking
    if (oldPresetName) {
      const oldClientSet = this.clientsByPreset.get(oldPresetName);
      if (oldClientSet) {
        oldClientSet.delete(client);
        if (oldClientSet.size === 0) {
          this.clientsByPreset.delete(oldPresetName);
        }
      }
    }

    // Add to new preset tracking
    if (newPresetName) {
      if (!this.clientsByPreset.has(newPresetName)) {
        this.clientsByPreset.set(newPresetName, new Set());
      }
      this.clientsByPreset.get(newPresetName)!.add(client);
    }

    // Update client association
    client.presetName = newPresetName;

    logger.debug('Client preset updated', {
      clientId,
      oldPresetName,
      newPresetName,
    });

    this.emit('client_preset_updated', { clientId, oldPresetName, newPresetName });
  }

  /**
   * Send listChanged notifications to all clients using a specific preset
   */
  public async notifyPresetChange(presetName: string): Promise<void> {
    const clients = this.clientsByPreset.get(presetName) || new Set();

    if (clients.size === 0) {
      logger.debug('No clients to notify for preset change', { presetName });
      return;
    }

    logger.info('Sending preset change notifications', {
      presetName,
      clientCount: clients.size,
    });

    // Send notifications in parallel
    const notifications = Array.from(clients).map(async (client) => {
      if (!client.isConnected()) {
        logger.debug('Skipping disconnected client', {
          clientId: client.id,
          presetName,
        });
        return;
      }

      try {
        // Send all three types of listChanged notifications
        await Promise.all([
          client.sendNotification('notifications/tools/listChanged'),
          client.sendNotification('notifications/resources/listChanged'),
          client.sendNotification('notifications/prompts/listChanged'),
        ]);

        logger.debug('Preset change notifications sent to client', {
          clientId: client.id,
          presetName,
        });
      } catch (error: unknown) {
        logger.error('Failed to send preset change notification to client', {
          clientId: client.id,
          presetName,
          error,
        });

        // If client is no longer reachable, untrack it
        if (error instanceof Error && (error.message.includes('connection') || error.message.includes('closed'))) {
          this.untrackClient(client.id);
        }
      }
    });

    await Promise.allSettled(notifications);

    logger.info('Preset change notifications completed', {
      presetName,
      clientCount: clients.size,
    });

    this.emit('preset_notifications_sent', { presetName, clientCount: clients.size });
  }

  /**
   * Get statistics about tracked clients
   */
  public getStats(): {
    totalClients: number;
    presetCount: number;
    clientsByPreset: Record<string, number>;
  } {
    const clientsByPreset: Record<string, number> = {};

    for (const [presetName, clientSet] of this.clientsByPreset) {
      clientsByPreset[presetName] = clientSet.size;
    }

    return {
      totalClients: this.clientsById.size,
      presetCount: this.clientsByPreset.size,
      clientsByPreset,
    };
  }

  /**
   * Clean up disconnected clients
   */
  public async cleanup(): Promise<number> {
    let removedCount = 0;

    for (const [clientId, client] of this.clientsById) {
      if (!client.isConnected()) {
        this.untrackClient(clientId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.info('Cleaned up disconnected clients', { removedCount });
    }

    return removedCount;
  }

  /**
   * Get clients for a specific preset
   */
  public getClientsForPreset(presetName: string): ClientConnection[] {
    const clientSet = this.clientsByPreset.get(presetName);
    return clientSet ? Array.from(clientSet) : [];
  }

  /**
   * Check if a preset has any tracked clients
   */
  public hasClientsForPreset(presetName: string): boolean {
    const clientSet = this.clientsByPreset.get(presetName);
    return !!(clientSet && clientSet.size > 0);
  }

  /**
   * Get all tracked preset names
   */
  public getTrackedPresets(): string[] {
    return Array.from(this.clientsByPreset.keys());
  }
}
