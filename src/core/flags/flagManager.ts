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
 * Result containing available tools and categories
 */
export interface AvailableToolsResult {
  tools: string[];
  categories: string[];
}

/**
 * Tool mapping for internal MCP tools
 */
const TOOL_MAPPING: Record<string, string | string[]> = {
  // Individual tools (short name -> MCP tool name)
  search: 'search',
  registry_status: 'registry_status',
  registry_info: 'registry_info',
  registry_list: 'registry_list',
  info: 'info',
  edit: 'edit',
  list: 'list',
  status: 'status',
  enable: 'enable',
  disable: 'disable',
  reload: 'reload',
  install: 'install',
  uninstall: 'uninstall',
  update: 'update',

  // Category shortcuts (category -> array of tool names)
  discovery: ['search', 'registry_status', 'registry_info', 'registry_list', 'info'],
  management: ['list', 'status', 'enable', 'disable', 'reload', 'edit'],
  installation: ['install', 'uninstall', 'update'],
  safe: ['search', 'registry_info', 'registry_list', 'info', 'list', 'status'],
};

/**
 * All available internal tool names for validation
 */
const ALL_AVAILABLE_TOOLS = [
  'search',
  'registry_status',
  'registry_info',
  'registry_list',
  'info',
  'edit',
  'list',
  'status',
  'enable',
  'disable',
  'reload',
  'install',
  'uninstall',
  'update',
];

/**
 * All available categories for validation
 */
const ALL_AVAILABLE_CATEGORIES = ['discovery', 'management', 'installation', 'safe'];

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
    { category: 'lazyTools', description: 'Lazy loading discovery tools' },
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

    // Internal tools are controlled by features.internalTools
    if (category === 'internalTools') {
      return configManager.isToolEnabled(category, subcategory, tool);
    }

    // Lazy tools are enabled when lazy loading is enabled
    if (category === 'lazyTools') {
      return configManager.get('lazyLoading').enabled;
    }

    return false;
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
      return ALL_AVAILABLE_TOOLS;
    }

    // Lazy tools
    if (category === 'lazyTools') {
      return ['tool_list', 'tool_schema', 'tool_invoke'];
    }

    return [];
  }

  /**
   * Parse comma-separated tools list and resolve categories
   */
  public parseToolsList(toolsString: string): string[] {
    if (!toolsString || typeof toolsString !== 'string') {
      return [];
    }

    // Split by comma and trim whitespace
    const requestedTools = toolsString
      .split(',')
      .map((tool) => tool.trim().toLowerCase())
      .filter(Boolean);
    const resolvedTools: string[] = [];
    const errors: string[] = [];

    for (const tool of requestedTools) {
      // Check if it's a category shortcut
      if (ALL_AVAILABLE_CATEGORIES.includes(tool)) {
        const categoryTools = TOOL_MAPPING[tool] as string[];
        if (Array.isArray(categoryTools)) {
          resolvedTools.push(...categoryTools);
        }
      }
      // Check if it's an individual tool
      else if (ALL_AVAILABLE_TOOLS.includes(tool)) {
        resolvedTools.push(tool);
      } else {
        errors.push(`Unknown tool or category: "${tool}"`);
      }
    }

    // Remove duplicates and return
    const uniqueTools = [...new Set(resolvedTools)];

    if (errors.length > 0) {
      throw new Error(
        `Invalid tools list: ${errors.join(', ')}. Available tools: ${ALL_AVAILABLE_TOOLS.join(', ')}. Available categories: ${ALL_AVAILABLE_CATEGORIES.join(', ')}`,
      );
    }

    return uniqueTools;
  }

  /**
   * Get enabled tools based on custom tools list
   */
  public getEnabledToolsFromList(category: string, toolsList: string[]): string[] {
    if (category !== 'internalTools' || !toolsList || toolsList.length === 0) {
      return [];
    }

    // Filter out any invalid tools and return valid ones
    return toolsList.filter((tool) => ALL_AVAILABLE_TOOLS.includes(tool));
  }

  /**
   * Get all available tools and categories for help
   */
  public getAvailableToolsAndCategories(): AvailableToolsResult {
    return {
      tools: [...ALL_AVAILABLE_TOOLS],
      categories: [...ALL_AVAILABLE_CATEGORIES],
    };
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
}
