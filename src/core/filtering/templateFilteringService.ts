import { MCPServerParams } from '@src/core/types/index.js';
import { InboundConnectionConfig } from '@src/core/types/index.js';
import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { TagExpression, TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import { TagQuery } from '@src/domains/preset/types/presetTypes.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { normalizeTag } from '@src/utils/validation/sanitization.js';

/**
 * Filter options for template configurations
 */
export interface TemplateFilterOptions {
  presetName?: string;
  tags?: string[];
  tagExpression?: TagExpression;
  tagQuery?: TagQuery;
  mode?: 'simple-or' | 'advanced' | 'preset' | 'none';
}

/**
 * Template filter function type
 */
export type TemplateFilter = (templates: Array<[string, MCPServerParams]>) => Array<[string, MCPServerParams]>;

/**
 * Service for filtering MCP template configurations based on tags, presets, and advanced expressions
 * This follows the same patterns as FilteringService but works with template configs instead of connections
 */
export class TemplateFilteringService {
  /**
   * Filter template configurations based on connection options
   *
   * @param templates Array of template configurations
   * @param config Connection configuration with filter criteria
   * @returns Filtered array of template configurations
   */
  public static getMatchingTemplates(
    templates: Array<[string, MCPServerParams]>,
    config: InboundConnectionConfig,
  ): Array<[string, MCPServerParams]> {
    debugIf(() => ({
      message: 'TemplateFilteringService: Filtering templates',
      meta: {
        totalTemplates: templates.length,
        filterMode: config.tagFilterMode,
        tags: config.tags,
        hasTagExpression: !!config.tagExpression,
        hasTagQuery: !!config.tagQuery,
        presetName: config.presetName,
      },
    }));

    const filterOptions = this.extractFilterOptions(config);

    // Check for preset name filtering first (highest priority)
    if (filterOptions.presetName) {
      debugIf(() => ({
        message: `TemplateFilteringService: Filtering by preset: ${filterOptions.presetName}`,
        meta: { presetName: filterOptions.presetName },
      }));

      // If we have a tagQuery from the preset, use it instead of simple preset name matching
      if (config.tagQuery) {
        debugIf(() => ({
          message: `TemplateFilteringService: Using preset tag query for filtering`,
          meta: { presetName: filterOptions.presetName, tagQuery: config.tagQuery },
        }));
        return this.byTagQuery(config.tagQuery)(templates);
      } else {
        // Fallback to simple preset name matching for backward compatibility
        return this.byPreset(filterOptions.presetName)(templates);
      }
    }

    if (!filterOptions.mode || filterOptions.mode === 'none') {
      debugIf('TemplateFilteringService: No filtering specified, returning all templates');
      return templates;
    }

    const filter = this.createFilter(filterOptions);
    const filteredTemplates = filter(templates);

    debugIf(() => ({
      message: 'TemplateFilteringService: Filtering completed',
      meta: {
        originalCount: templates.length,
        filteredCount: filteredTemplates.length,
        removedCount: templates.length - filteredTemplates.length,
        filteredNames: filteredTemplates.map(([name]) => name),
      },
    }));

    return filteredTemplates;
  }

  /**
   * Extract filter options from connection configuration
   */
  private static extractFilterOptions(config: InboundConnectionConfig): TemplateFilterOptions {
    return {
      presetName: config.presetName,
      tags: config.tags,
      tagExpression: config.tagExpression,
      tagQuery: config.tagQuery,
      mode: config.tagFilterMode as 'simple-or' | 'advanced' | 'preset' | 'none',
    };
  }

  /**
   * Create a filter function based on filter options
   */
  public static createFilter(options: TemplateFilterOptions): TemplateFilter {
    // Preset filtering has highest priority
    if (options.presetName) {
      return this.byPreset(options.presetName);
    } else if (options.mode === 'preset' && options.tagQuery) {
      return this.byTagQuery(options.tagQuery);
    } else if (options.mode === 'advanced' && options.tagExpression) {
      return this.byTagExpression(options.tagExpression);
    } else if (options.mode === 'simple-or' || options.tags) {
      return this.byTags(options.tags);
    } else {
      // No filtering - return all templates
      return this.byTags(undefined);
    }
  }

  /**
   * Filter templates by tags using OR logic (backward compatible)
   */
  public static byTags(tags?: string[]): TemplateFilter {
    return (templates: Array<[string, MCPServerParams]>) => {
      debugIf(() => ({
        message: `TemplateFilteringService.byTags: Filtering for tags: ${tags ? tags.join(', ') : 'none'}`,
        meta: { tags },
      }));

      if (!tags || tags.length === 0) {
        debugIf('TemplateFilteringService.byTags: No tags specified, returning all templates');
        return templates;
      }

      // Normalize the filter tags for consistent comparison
      const normalizedFilterTags = tags.map((tag) => normalizeTag(tag));

      return templates.filter(([name, config]) => {
        const templateTags = config.tags || [];
        // Normalize template tags for comparison
        const normalizedTemplateTags = templateTags.map((tag) => normalizeTag(tag));
        const hasMatchingTags = normalizedTemplateTags.some((templateTag) =>
          normalizedFilterTags.includes(templateTag),
        );

        debugIf(() => ({
          message: `TemplateFilteringService.byTags: Template ${name}`,
          meta: {
            templateTags,
            normalizedTemplateTags,
            requiredTags: tags,
            normalizedRequiredTags: normalizedFilterTags,
            hasMatchingTags,
          },
        }));

        return hasMatchingTags;
      });
    };
  }

  /**
   * Filter templates by preset name (exact match)
   */
  public static byPreset(presetName: string): TemplateFilter {
    return (templates: Array<[string, MCPServerParams]>) => {
      debugIf(() => ({
        message: `TemplateFilteringService.byPreset: Filtering for preset: ${presetName}`,
        meta: { presetName },
      }));

      return templates.filter(([name, config]) => {
        const templateTags = config.tags || [];
        const hasPresetTag = templateTags.includes(presetName);

        debugIf(() => ({
          message: `TemplateFilteringService.byPreset: Template ${name}`,
          meta: {
            templateTags,
            presetName,
            hasPresetTag,
          },
        }));

        return hasPresetTag;
      });
    };
  }

  /**
   * Filter templates by advanced tag expression
   */
  public static byTagExpression(expression: TagExpression | string): TemplateFilter {
    return (templates: Array<[string, MCPServerParams]>) => {
      debugIf(() => ({
        message: `TemplateFilteringService.byTagExpression: Filtering with expression: ${expression}`,
        meta: { expression },
      }));

      let parsedExpression;
      if (typeof expression === 'string') {
        try {
          parsedExpression = TagQueryParser.parseAdvanced(expression);
        } catch (error) {
          logger.warn(`TemplateFilteringService.byTagExpression: Failed to parse expression: ${expression}`, {
            error: error instanceof Error ? error.message : 'Unknown error',
            expression,
          });
          return templates; // Return all templates on parse error
        }
      } else {
        parsedExpression = expression; // Use TagExpression directly
      }

      return templates.filter(([name, config]) => {
        const templateTags = config.tags || [];
        const matches = TagQueryParser.evaluate(parsedExpression, templateTags);

        debugIf(() => ({
          message: `TemplateFilteringService.byTagExpression: Template ${name}`,
          meta: {
            templateTags,
            expression: TagQueryParser.expressionToString(parsedExpression),
            matches,
          },
        }));

        return matches;
      });
    };
  }

  /**
   * Filter templates by MongoDB-style tag query
   */
  public static byTagQuery(query: TagQuery): TemplateFilter {
    return (templates: Array<[string, MCPServerParams]>) => {
      debugIf(() => ({
        message: 'TemplateFilteringService.byTagQuery: Filtering with tag query',
        meta: { query },
      }));

      return templates.filter(([name, config]) => {
        const templateTags = config.tags || [];

        try {
          const matches = TagQueryEvaluator.evaluate(query, templateTags);

          debugIf(() => ({
            message: `TemplateFilteringService.byTagQuery: Template ${name} ${matches ? 'matches' : 'does not match'} query`,
            meta: {
              templateTags,
              query,
              matches,
            },
          }));

          return matches;
        } catch (error) {
          logger.warn(`TemplateFilteringService.byTagQuery: Failed to evaluate query for template ${name}`, {
            error: error instanceof Error ? error.message : 'Unknown error',
            templateTags,
            query,
          });
          return false; // Exclude template on evaluation error
        }
      });
    };
  }

  /**
   * Combine multiple template filters using AND logic
   */
  public static combineFilters(...filters: TemplateFilter[]): TemplateFilter {
    return (templates: Array<[string, MCPServerParams]>) => {
      debugIf(() => ({
        message: `TemplateFilteringService.combineFilters: Starting with ${templates.length} templates`,
        meta: {
          templateNames: templates.map(([name]) => name),
          filterCount: filters.length,
        },
      }));

      const result = filters.reduce((remainingTemplates, filter, index) => {
        const beforeCount = remainingTemplates.length;
        const afterFiltering = filter(remainingTemplates);
        const afterCount = afterFiltering.length;

        debugIf(() => ({
          message: `TemplateFilteringService.combineFilters: Filter ${index} reduced templates from ${beforeCount} to ${afterCount}`,
          meta: {
            beforeNames: remainingTemplates.map(([name]) => name),
            afterNames: afterFiltering.map(([name]) => name),
          },
        }));

        return afterFiltering;
      }, templates);

      debugIf(() => ({
        message: `TemplateFilteringService.combineFilters: Final result has ${result.length} templates`,
        meta: {
          finalNames: result.map(([name]) => name),
        },
      }));

      return result;
    };
  }

  /**
   * Get a summary of filtering results for logging and debugging
   */
  public static getFilteringSummary(
    originalTemplates: Array<[string, MCPServerParams]>,
    filteredTemplates: Array<[string, MCPServerParams]>,
    options: TemplateFilterOptions,
  ): {
    original: number;
    filtered: number;
    removed: number;
    filterType: string;
    filteredNames: string[];
    removedNames: string[];
  } {
    const originalNames = originalTemplates.map(([name]) => name);
    const filteredNames = filteredTemplates.map(([name]) => name);
    const removedNames = originalNames.filter((name) => !filteredNames.includes(name));

    let filterType = 'none';
    if (options.mode === 'preset') {
      filterType = 'preset';
    } else if (options.mode === 'advanced') {
      filterType = 'advanced';
    } else if (options.mode === 'simple-or' || options.tags) {
      filterType = 'simple-or';
    }

    return {
      original: originalTemplates.length,
      filtered: filteredTemplates.length,
      removed: removedNames.length,
      filterType,
      filteredNames: filteredNames.sort(),
      removedNames: removedNames.sort(),
    };
  }
}
