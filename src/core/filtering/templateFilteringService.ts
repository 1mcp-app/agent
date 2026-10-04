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
    debugIf(() => ({ message: 'templateFilteringService.templatefilteringservice.filtering.templates.2419e4ac' }));

    const filterOptions = this.extractFilterOptions(config);

    // Check for preset name filtering first (highest priority)
    if (filterOptions.presetName) {
      debugIf(() => ({ message: 'templateFilteringService.templatefilteringservice.filtering.by.preset.e1c2a17b' }));

      // If we have a tagQuery from the preset, use it instead of simple preset name matching
      if (config.tagQuery) {
        debugIf(() => ({
          message: 'templateFilteringService.templatefilteringservice.using.preset.tag.query.for.filtering.22fe77a8',
        }));
        return this.byTagQuery(config.tagQuery)(templates);
      } else {
        // Fallback to simple preset name matching for backward compatibility
        return this.byPreset(filterOptions.presetName)(templates);
      }
    }

    if (!filterOptions.mode || filterOptions.mode === 'none') {
      debugIf(
        'templateFilteringService.templatefilteringservice.no.filtering.specified.returning.all.templates.72b5c81d',
      );
      return templates;
    }

    const filter = this.createFilter(filterOptions);
    const filteredTemplates = filter(templates);

    debugIf(() => ({
      message: 'templateFilteringService.templatefilteringservice.filtering.completed.33a5ef8e',
      meta: {
        originalCount: templates.length,
        filteredCount: filteredTemplates.length,
        removedCount: templates.length - filteredTemplates.length,
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
        message: 'templateFilteringService.templatefilteringservice.bytags.filtering.for.tags.9f2765ca',
      }));

      if (!tags || tags.length === 0) {
        debugIf(
          'templateFilteringService.templatefilteringservice.bytags.no.tags.specified.returning.all.templates.5544bcda',
        );
        return templates;
      }

      // Normalize the filter tags for consistent comparison
      const normalizedFilterTags = tags.map((tag) => normalizeTag(tag));

      return templates.filter(([_name, config]) => {
        const templateTags = config.tags || [];
        // Normalize template tags for comparison
        const normalizedTemplateTags = templateTags.map((tag) => normalizeTag(tag));
        const hasMatchingTags = normalizedTemplateTags.some((templateTag) =>
          normalizedFilterTags.includes(templateTag),
        );

        debugIf(() => ({ message: 'templateFilteringService.templatefilteringservice.bytags.template.41ff62f8' }));

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
        message: 'templateFilteringService.templatefilteringservice.bypreset.filtering.for.preset.920b4f6f',
      }));

      return templates.filter(([_name, config]) => {
        const templateTags = config.tags || [];
        const hasPresetTag = templateTags.includes(presetName);

        debugIf(() => ({ message: 'templateFilteringService.templatefilteringservice.bypreset.template.5819a00b' }));

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
        message: 'templateFilteringService.templatefilteringservice.bytagexpression.filtering.with.expression.262b994c',
      }));

      let parsedExpression;
      if (typeof expression === 'string') {
        try {
          parsedExpression = TagQueryParser.parseAdvanced(expression);
        } catch (error) {
          logger.warn(
            'templateFilteringService.templatefilteringservice.bytagexpression.failed.to.parse.expression.ff6c19a4',
            { error: error },
          );
          return templates; // Return all templates on parse error
        }
      } else {
        parsedExpression = expression; // Use TagExpression directly
      }

      return templates.filter(([_name, config]) => {
        const templateTags = config.tags || [];
        const matches = TagQueryParser.evaluate(parsedExpression, templateTags);

        debugIf(() => ({
          message: 'templateFilteringService.templatefilteringservice.bytagexpression.template.d8360e6c',
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
        message: 'templateFilteringService.templatefilteringservice.bytagquery.filtering.with.tag.query.e9c3aae4',
      }));

      return templates.filter(([_name, config]) => {
        const templateTags = config.tags || [];

        try {
          const matches = TagQueryEvaluator.evaluate(query, templateTags);

          debugIf(() => ({
            message: 'templateFilteringService.templatefilteringservice.bytagquery.template.query.a18b625d',
          }));

          return matches;
        } catch (error) {
          logger.warn(
            'templateFilteringService.templatefilteringservice.bytagquery.failed.to.evaluate.query.for.template.c9b2438d',
            { error: error },
          );
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
        message: 'templateFilteringService.templatefilteringservice.combinefilters.starting.with.templates.75cef24a',
        meta: { filterCount: filters.length },
      }));

      const result = filters.reduce((remainingTemplates, filter, _index) => {
        const afterFiltering = filter(remainingTemplates);

        debugIf(() => ({
          message:
            'templateFilteringService.templatefilteringservice.combinefilters.filter.reduced.templates.from.to.9398ece6',
        }));

        return afterFiltering;
      }, templates);

      debugIf(() => ({
        message: 'templateFilteringService.templatefilteringservice.combinefilters.final.result.has.templates.8bbd9345',
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
