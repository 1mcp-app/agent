/**
 * Utility for detecting changes in preset server lists
 * Compares before/after server lists to determine if notifications are needed
 */
export interface ServerListChange {
  hasChanged: boolean;
  added: string[];
  removed: string[];
  unchanged: string[];
}

export class PresetServerChangeDetector {
  private previousServerLists = new Map<string, string[]>();

  /**
   * Detect changes between previous and current server lists for a preset
   */
  public detectChanges(presetName: string, currentServers: string[]): ServerListChange {
    const previousServers = this.previousServerLists.get(presetName);

    // If no previous data exists, consider it as initialization (no change)
    if (!previousServers) {
      return {
        hasChanged: false,
        added: [],
        removed: [],
        unchanged: [...currentServers].sort(),
      };
    }

    const previousSet = new Set(previousServers);
    const currentSet = new Set(currentServers);

    const added: string[] = [];
    const removed: string[] = [];
    const unchanged: string[] = [];

    // Find added servers
    for (const server of currentServers) {
      if (!previousSet.has(server)) {
        added.push(server);
      } else {
        unchanged.push(server);
      }
    }

    // Find removed servers
    for (const server of previousServers) {
      if (!currentSet.has(server)) {
        removed.push(server);
      }
    }

    const hasChanged = added.length > 0 || removed.length > 0;

    return {
      hasChanged,
      added: added.sort(),
      removed: removed.sort(),
      unchanged: unchanged.sort(),
    };
  }

  /**
   * Update the stored server list for a preset
   */
  public updateServerList(presetName: string, servers: string[]): void {
    this.previousServerLists.set(presetName, [...servers].sort());
  }

  /**
   * Get the previously stored server list for a preset
   */
  public getPreviousServerList(presetName: string): string[] {
    return [...(this.previousServerLists.get(presetName) || [])];
  }

  /**
   * Check if we have stored data for a preset
   */
  public hasPreset(presetName: string): boolean {
    return this.previousServerLists.has(presetName);
  }

  /**
   * Remove tracking for a preset (cleanup when preset is deleted)
   */
  public removePreset(presetName: string): void {
    this.previousServerLists.delete(presetName);
  }

  /**
   * Get all tracked preset names
   */
  public getTrackedPresets(): string[] {
    return Array.from(this.previousServerLists.keys()).sort();
  }

  /**
   * Clear all stored server lists (useful for testing)
   */
  public clear(): void {
    this.previousServerLists.clear();
  }

  /**
   * Get statistics about tracked presets
   */
  public getStats(): {
    totalPresets: number;
    totalUniqueServers: number;
    serverCounts: Record<string, number>;
  } {
    const allServers = new Set<string>();
    const serverCounts: Record<string, number> = {};

    for (const [presetName, servers] of this.previousServerLists) {
      serverCounts[presetName] = servers.length;
      for (const server of servers) {
        allServers.add(server);
      }
    }

    return {
      totalPresets: this.previousServerLists.size,
      totalUniqueServers: allServers.size,
      serverCounts,
    };
  }
}
