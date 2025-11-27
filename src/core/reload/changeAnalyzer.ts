import { MCPServerParams } from '@src/core/types/transport.js';
import { debugIf } from '@src/logger/logger.js';

/**
 * Configuration change types
 */
export enum ChangeType {
  ADD_SERVER = 'add_server',
  REMOVE_SERVER = 'remove_server',
  MODIFY_SERVER = 'modify_server',
  ADD_TAGS = 'add_tags',
  REMOVE_TAGS = 'remove_tags',
  TRANSPORT_CHANGE = 'transport_change',
  CONFIG_RELOAD = 'config_reload',
  FLAGS_CHANGE = 'flags_change',
}

/**
 * Server change impact analysis
 */
export interface ServerChange {
  serverId: string; // This is now the server name
  changeType: ChangeType;
  oldConfig?: MCPServerParams;
  newConfig?: MCPServerParams;
  impact: {
    requiresFullRestart: boolean;
    affectsConnections: boolean;
    affectsCapabilities: boolean;
    estimatedDowntime: number; // in milliseconds
  };
}

/**
 * Reload impact analysis result
 */
export interface ReloadImpactAnalysis {
  changes: ServerChange[];
  summary: {
    totalChanges: number;
    requiresFullRestart: boolean;
    affectedServers: string[];
    estimatedTotalDowntime: number;
    canPartialReload: boolean;
    requiresConnectionMigration: boolean;
  };
  recommendations: {
    reloadStrategy: 'full' | 'partial' | 'deferred';
    reason: string;
    estimatedTime: number;
    userActionRequired: boolean;
  }[];
}

/**
 * Configuration comparison result
 */
export interface ConfigComparison {
  added: Array<{ name: string; config: MCPServerParams }>;
  removed: Array<{ name: string; config: MCPServerParams }>;
  modified: Array<{
    name: string;
    old: MCPServerParams;
    new: MCPServerParams;
    changes: string[];
  }>;
  unchanged: Array<{ name: string; config: MCPServerParams }>;
}

/**
 * ChangeAnalyzer provides intelligent analysis of configuration changes
 * to determine optimal reload strategies
 */
export class ChangeAnalyzer {
  /**
   * Analyze configuration changes and determine impact
   */
  public analyzeChanges(
    oldConfig: Record<string, MCPServerParams>,
    newConfig: Record<string, MCPServerParams>,
  ): ReloadImpactAnalysis {
    debugIf(() => ({
      message: 'Analyzing configuration changes for reload impact',
      meta: { oldServerCount: Object.keys(oldConfig).length, newServerCount: Object.keys(newConfig).length },
    }));

    const comparison = this.compareConfigurations(oldConfig, newConfig);
    const changes = this.processChanges(comparison);
    const summary = this.generateSummary(changes);
    const recommendations = this.generateRecommendations(summary, changes);

    const analysis: ReloadImpactAnalysis = {
      changes,
      summary,
      recommendations,
    };

    debugIf(() => ({
      message: 'Configuration change analysis completed',
      meta: {
        totalChanges: summary.totalChanges,
        requiresFullRestart: summary.requiresFullRestart,
        canPartialReload: summary.canPartialReload,
        estimatedDowntime: summary.estimatedTotalDowntime,
      },
    }));

    return analysis;
  }

  /**
   * Compare old and new configurations
   */
  private compareConfigurations(
    oldConfig: Record<string, MCPServerParams>,
    newConfig: Record<string, MCPServerParams>,
  ): ConfigComparison {
    const added: Array<{ name: string; config: MCPServerParams }> = [];
    const removed: Array<{ name: string; config: MCPServerParams }> = [];
    const modified: Array<{ name: string; old: MCPServerParams; new: MCPServerParams; changes: string[] }> = [];
    const unchanged: Array<{ name: string; config: MCPServerParams }> = [];

    // Find added and modified servers
    for (const [name, newServerConfig] of Object.entries(newConfig)) {
      const oldServerConfig = oldConfig[name];
      if (!oldServerConfig) {
        added.push({ name, config: newServerConfig });
      } else {
        const changes = this.getServerChanges(oldServerConfig, newServerConfig);
        if (changes.length > 0) {
          modified.push({ name, old: oldServerConfig, new: newServerConfig, changes });
        } else {
          unchanged.push({ name, config: newServerConfig });
        }
      }
    }

    // Find removed servers
    for (const [name, oldServerConfig] of Object.entries(oldConfig)) {
      if (!newConfig[name]) {
        removed.push({ name, config: oldServerConfig });
      }
    }

    return { added, removed, modified, unchanged };
  }

  /**
   * Process configuration changes into server change events
   */
  private processChanges(comparison: ConfigComparison): ServerChange[] {
    const changes: ServerChange[] = [];

    // Process added servers
    for (const { name, config } of comparison.added) {
      changes.push({
        serverId: name,
        changeType: ChangeType.ADD_SERVER,
        newConfig: config,
        impact: this.calculateImpact(ChangeType.ADD_SERVER, undefined, config),
      });
    }

    // Process removed servers
    for (const { name, config } of comparison.removed) {
      changes.push({
        serverId: name,
        changeType: ChangeType.REMOVE_SERVER,
        oldConfig: config,
        impact: this.calculateImpact(ChangeType.REMOVE_SERVER, config, undefined),
      });
    }

    // Process modified servers
    for (const { name, old, new: newServer, changes: serverChanges } of comparison.modified) {
      const changeType = this.categorizeModification(serverChanges);

      // Transport type changes should be treated as remove + add
      if (changeType === ChangeType.TRANSPORT_CHANGE) {
        // Add remove change
        changes.push({
          serverId: name,
          changeType: ChangeType.REMOVE_SERVER,
          oldConfig: old,
          impact: this.calculateImpact(ChangeType.REMOVE_SERVER, old, undefined),
        });

        // Add add change
        changes.push({
          serverId: name,
          changeType: ChangeType.ADD_SERVER,
          newConfig: newServer,
          impact: this.calculateImpact(ChangeType.ADD_SERVER, undefined, newServer),
        });
      } else {
        // Regular modification
        changes.push({
          serverId: name,
          changeType,
          oldConfig: old,
          newConfig: newServer,
          impact: this.calculateImpact(changeType, old, newServer),
        });
      }
    }

    return changes;
  }

  /**
   * Generate summary of all changes
   */
  private generateSummary(changes: ServerChange[]): ReloadImpactAnalysis['summary'] {
    const affectedServers = changes.map((c) => c.serverId);
    const requiresFullRestart = changes.some((c) => c.impact.requiresFullRestart);
    const affectsConnections = changes.some((c) => c.impact.affectsConnections);
    const canPartialReload = !requiresFullRestart && changes.length > 0;
    const requiresConnectionMigration = affectsConnections && !requiresFullRestart;

    const totalDowntime = changes.reduce((sum, change) => sum + change.impact.estimatedDowntime, 0);

    return {
      totalChanges: changes.length,
      requiresFullRestart,
      affectedServers,
      estimatedTotalDowntime: totalDowntime,
      canPartialReload,
      requiresConnectionMigration,
    };
  }

  /**
   * Generate reload recommendations based on impact analysis
   */
  private generateRecommendations(
    summary: ReloadImpactAnalysis['summary'],
    changes: ServerChange[],
  ): ReloadImpactAnalysis['recommendations'] {
    const recommendations: ReloadImpactAnalysis['recommendations'] = [];

    if (summary.requiresFullRestart) {
      recommendations.push({
        reloadStrategy: 'full',
        reason: 'Configuration changes require full server restart',
        estimatedTime: summary.estimatedTotalDowntime,
        userActionRequired: false,
      });
    } else if (summary.canPartialReload) {
      if (summary.requiresConnectionMigration) {
        recommendations.push({
          reloadStrategy: 'partial',
          reason: 'Selective reload with connection migration',
          estimatedTime: summary.estimatedTotalDowntime,
          userActionRequired: false,
        });
      } else {
        recommendations.push({
          reloadStrategy: 'partial',
          reason: 'Selective reload without connection interruption',
          estimatedTime: summary.estimatedTotalDowntime,
          userActionRequired: false,
        });
      }
    } else {
      recommendations.push({
        reloadStrategy: 'deferred',
        reason: 'No functional changes detected',
        estimatedTime: 0,
        userActionRequired: false,
      });
    }

    // Add safety recommendations for dangerous operations
    const dangerousChanges = changes.filter(
      (c) => c.changeType === ChangeType.TRANSPORT_CHANGE || c.changeType === ChangeType.REMOVE_SERVER,
    );

    if (dangerousChanges.length > 0) {
      recommendations.push({
        reloadStrategy: 'deferred',
        reason: 'Potentially disruptive changes detected - consider backup before proceeding',
        estimatedTime: 0,
        userActionRequired: true,
      });
    }

    return recommendations;
  }

  /**
   * Calculate impact of a specific change
   */
  private calculateImpact(
    changeType: ChangeType,
    oldConfig?: MCPServerParams,
    newConfig?: MCPServerParams,
  ): ServerChange['impact'] {
    switch (changeType) {
      case ChangeType.ADD_SERVER:
        return {
          requiresFullRestart: false,
          affectsConnections: false,
          affectsCapabilities: true,
          estimatedDowntime: 100, // Fast - just start new server
        };

      case ChangeType.REMOVE_SERVER:
        return {
          requiresFullRestart: false,
          affectsConnections: true, // Might affect active connections
          affectsCapabilities: true,
          estimatedDowntime: 500, // Need to gracefully shutdown
        };

      case ChangeType.TRANSPORT_CHANGE:
        return {
          requiresFullRestart: true, // Transport changes always need restart
          affectsConnections: true,
          affectsCapabilities: true,
          estimatedDowntime: 5000, // Full restart takes time
        };

      case ChangeType.MODIFY_SERVER:
        if (!oldConfig || !newConfig) {
          return {
            requiresFullRestart: false,
            affectsConnections: false,
            affectsCapabilities: false,
            estimatedDowntime: 0,
          };
        }

        // Check for transport type change
        if (oldConfig.type !== newConfig.type) {
          return this.calculateImpact(ChangeType.TRANSPORT_CHANGE, oldConfig, newConfig);
        }

        // Check for command/args change (requires restart)
        if (this.isServerRestartRequired(oldConfig, newConfig)) {
          return {
            requiresFullRestart: false,
            affectsConnections: true,
            affectsCapabilities: false,
            estimatedDowntime: 2000, // Server restart
          };
        }

        // Minor configuration changes
        return {
          requiresFullRestart: false,
          affectsConnections: false,
          affectsCapabilities: false,
          estimatedDowntime: 100, // Quick config reload
        };

      default:
        return {
          requiresFullRestart: false,
          affectsConnections: false,
          affectsCapabilities: false,
          estimatedDowntime: 0,
        };
    }
  }

  /**
   * Check if server restart is required for configuration changes
   */
  private isServerRestartRequired(oldConfig: MCPServerParams, newConfig: MCPServerParams): boolean {
    // Check for changes that require server restart
    const restartRequiredFields = ['command', 'args', 'url', 'type'];

    for (const field of restartRequiredFields) {
      if (
        JSON.stringify(oldConfig[field as keyof MCPServerParams]) !==
        JSON.stringify(newConfig[field as keyof MCPServerParams])
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Categorize modification type
   */
  private categorizeModification(changes: string[]): ChangeType {
    // Any changes to core execution parameters require remove + add
    if (changes.some((c) => ['type', 'command', 'args', 'url'].includes(c))) {
      return ChangeType.TRANSPORT_CHANGE; // This will be converted to remove + add
    }

    if (changes.some((c) => c.includes('tag'))) {
      return ChangeType.ADD_TAGS; // Simplified - could be more specific
    }

    return ChangeType.MODIFY_SERVER;
  }

  /**
   * Get list of changes between two server configurations
   */
  private getServerChanges(oldConfig: MCPServerParams, newConfig: MCPServerParams): string[] {
    const changes: string[] = [];

    const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);

    for (const key of allKeys) {
      const oldValue = (oldConfig as Record<string, unknown>)[key];
      const newValue = (newConfig as Record<string, unknown>)[key];

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push(key);
      }
    }

    return changes;
  }
}
