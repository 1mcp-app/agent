import { EventEmitter } from 'events';

import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { debugIf } from '@src/logger/logger.js';

/**
 * Tool category definition - simplified structure
 */
export interface ToolCategory {
  category: string;
  description: string;
}

/**
 * Flag change notification event
 */
export interface FlagChangeEvent {
  category: string;
  subcategory?: string;
  tool?: string;
  oldValue: boolean;
  newValue: boolean;
  source: 'cli' | 'config' | 'runtime';
}

/**
 * Flag validation result
 */
export interface FlagValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * FlagManager provides simplified management for feature flags
 *
 * This class manages the simplified flag structure for internal tools,
 * providing basic flag checking without complex hierarchy or dependencies.
 */
export class FlagManager extends EventEmitter {
  private static instance: FlagManager;

  // Simplified tool categories
  private readonly toolCategories: ToolCategory[] = [
    { category: 'internalTools', description: 'Internal MCP management tools' },
  ];

  private constructor() {
    super();
    this.setupConfigWatcher();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): FlagManager {
    if (!FlagManager.instance) {
      FlagManager.instance = new FlagManager();
    }
    return FlagManager.instance;
  }

  /**
   * Check if a specific tool is enabled
   */
  public isToolEnabled(category: string, subcategory?: string, tool?: string): boolean {
    const configManager = AgentConfigManager.getInstance();
    return configManager.isToolEnabled(category, subcategory, tool);
  }

  /**
   * Check if an entire category is enabled
   */
  public isCategoryEnabled(category: string): boolean {
    return this.isToolEnabled(category);
  }

  /**
   * Get enabled tools for a category (simplified)
   */
  public getEnabledTools(category: string): string[] {
    if (!this.isCategoryEnabled(category)) {
      return [];
    }

    // For simplified structure, if category is enabled, all tools are enabled
    if (category === 'internalTools') {
      return ['search', 'install', 'uninstall', 'update', 'enable', 'disable', 'list', 'status', 'reload', 'registry'];
    }

    return [];
  }

  /**
   * Get tool categories information
   */
  public getToolCategories(): ToolCategory[] {
    return [...this.toolCategories];
  }

  /**
   * Validate flag configuration (simplified)
   */
  public validateFlags(): FlagValidationResult {
    // Simplified validation - no complex dependencies to check
    const configManager = AgentConfigManager.getInstance();
    configManager.areInternalToolsEnabled();

    return {
      valid: true,
      errors: [],
      warnings: [],
    };
  }

  /**
   * Get flag status summary (simplified)
   */
  public getFlagSummary(): Record<string, unknown> {
    const configManager = AgentConfigManager.getInstance();

    return {
      internalTools: configManager.areInternalToolsEnabled(),
    };
  }

  /**
   * Set up configuration change watcher
   */
  private setupConfigWatcher(): void {
    // Watch for configuration changes and emit events
    // This would integrate with the existing config reload system
    debugIf(() => ({
      message: 'FlagManager initialized and watching for configuration changes',
      meta: { categoryCount: this.toolCategories.length },
    }));
  }

  /**
   * Emit flag change event (used by config system when flags change)
   */
  public emitFlagChange(event: FlagChangeEvent): void {
    debugIf(() => ({
      message: `Flag changed: ${event.category}${event.subcategory ? '.' + event.subcategory : ''}${event.tool ? '.' + event.tool : ''} from ${event.oldValue} to ${event.newValue}`,
      meta: { source: event.source },
    }));

    this.emit('flagChanged', event);
  }

  /**
   * Check if tools are safe for current context (simplified)
   */
  public areToolsSafeForContext(context: 'production' | 'development' | 'testing'): boolean {
    if (context === 'production') {
      // In production, internal tools might be risky - let the admin decide
      // Simplified approach: just check if internal tools are enabled
      return !this.isCategoryEnabled('internalTools');
    }

    return true;
  }
}
