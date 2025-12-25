import { MCPServerParams } from '@src/core/types/index.js';
import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { TagExpression, TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import { TagQuery } from '@src/domains/preset/types/presetTypes.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { normalizeTag } from '@src/utils/validation/sanitization.js';

/**
 * Template index entry with metadata
 */
interface TemplateIndexEntry {
  name: string;
  config: MCPServerParams;
  tags: Set<string>;
  normalizedTags: Set<string>;
  tagCount: number;
}

/**
 * Tag index mapping tags to template names
 */
interface TagIndex {
  byTag: Map<string, Set<string>>; // tag -> template names
  byNormalizedTag: Map<string, Set<string>>; // normalized tag -> template names
  popularTags: Array<{ tag: string; count: number }>; // Sorted by frequency
}

/**
 * Index statistics
 */
export interface IndexStats {
  totalTemplates: number;
  totalTags: number;
  uniqueTags: number;
  averageTagsPerTemplate: number;
  mostPopularTag: { tag: string; count: number } | null;
  indexSize: number; // Memory usage estimate
  buildTime: number; // Time to build index in ms
}

/**
 * High-performance index for template filtering operations
 * Provides O(1) tag lookups and optimized expression evaluation
 */
export class TemplateIndex {
  private templates = new Map<string, TemplateIndexEntry>();
  private tagIndex: TagIndex;
  private built = false;
  private buildTime = 0;

  constructor() {
    this.tagIndex = {
      byTag: new Map(),
      byNormalizedTag: new Map(),
      popularTags: [],
    };
  }

  /**
   * Build index from template configurations
   */
  public buildIndex(templates: Record<string, MCPServerParams>): void {
    const startTime = Date.now();

    debugIf(() => ({
      message: `TemplateIndex.buildIndex: Building index for ${Object.keys(templates).length} templates`,
      meta: { templateCount: Object.keys(templates).length },
    }));

    // Clear existing index
    this.clear();

    // Process each template
    for (const [name, config] of Object.entries(templates)) {
      this.addTemplate(name, config);
    }

    // Build popular tags list
    this.buildPopularTags();

    this.built = true;
    this.buildTime = Date.now() - startTime;

    const stats = this.getStats();
    debugIf(() => ({
      message: `TemplateIndex.buildIndex: Index built successfully`,
      meta: {
        buildTime: this.buildTime,
        totalTemplates: stats.totalTemplates,
        uniqueTags: stats.uniqueTags,
        averageTagsPerTemplate: stats.averageTagsPerTemplate,
      },
    }));
  }

  /**
   * Get templates by tag (O(1) lookup)
   */
  public getTemplatesByTag(tag: string): string[] {
    if (!this.built) {
      logger.warn('TemplateIndex.getTemplatesByTag: Index not built, returning empty result');
      return [];
    }

    const normalizedTag = normalizeTag(tag);
    const templateNames = this.tagIndex.byNormalizedTag.get(normalizedTag);
    return templateNames ? Array.from(templateNames) : [];
  }

  /**
   * Get templates by multiple tags (OR logic)
   */
  public getTemplatesByTags(tags: string[]): string[] {
    if (!this.built || tags.length === 0) {
      return [];
    }

    const templateSet = new Set<string>();

    for (const tag of tags) {
      const templates = this.getTemplatesByTag(tag);
      for (const templateName of templates) {
        templateSet.add(templateName);
      }
    }

    return Array.from(templateSet);
  }

  /**
   * Get templates matching all specified tags (AND logic)
   */
  public getTemplatesByAllTags(tags: string[]): string[] {
    if (!this.built || tags.length === 0) {
      return [];
    }

    if (tags.length === 1) {
      return this.getTemplatesByTag(tags[0]);
    }

    // Get templates for first tag
    const firstTagTemplates = this.getTemplatesByTag(tags[0]);
    if (firstTagTemplates.length === 0) {
      return [];
    }

    // Filter templates that have all remaining tags
    const result: string[] = [];
    for (const templateName of firstTagTemplates) {
      const template = this.templates.get(templateName);
      if (template) {
        const hasAllTags = tags.every((tag) => template.normalizedTags.has(normalizeTag(tag)));
        if (hasAllTags) {
          result.push(templateName);
        }
      }
    }

    return result;
  }

  /**
   * Evaluate advanced tag expression against indexed templates
   * Optimized evaluation using index lookups where possible
   */
  public evaluateExpression(expression: string): string[] {
    if (!this.built) {
      logger.warn('TemplateIndex.evaluateExpression: Index not built, returning empty result');
      return [];
    }

    try {
      const parsedExpression = TagQueryParser.parseAdvanced(expression);
      return this.evaluateParsedExpression(parsedExpression);
    } catch (error) {
      logger.warn(`TemplateIndex.evaluateExpression: Failed to parse expression: ${expression}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        expression,
      });
      return [];
    }
  }

  /**
   * Evaluate MongoDB-style tag query against indexed templates
   */
  public evaluateTagQuery(query: TagQuery): string[] {
    if (!this.built) {
      logger.warn('TemplateIndex.evaluateTagQuery: Index not built, returning empty result');
      return [];
    }

    const result: string[] = [];

    for (const [templateName, template] of this.templates) {
      const templateTags = Array.from(template.tags);
      try {
        if (TagQueryEvaluator.evaluate(query, templateTags)) {
          result.push(templateName);
        }
      } catch (error) {
        logger.warn(`TemplateIndex.evaluateTagQuery: Failed to evaluate query for template ${templateName}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          templateName,
          templateTags,
        });
      }
    }

    return result;
  }

  /**
   * Get template entry with full information
   */
  public getTemplate(name: string): TemplateIndexEntry | null {
    return this.templates.get(name) || null;
  }

  /**
   * Check if template exists in index
   */
  public hasTemplate(name: string): boolean {
    return this.templates.has(name);
  }

  /**
   * Get all template names
   */
  public getAllTemplateNames(): string[] {
    return Array.from(this.templates.keys());
  }

  /**
   * Get all unique tags
   */
  public getAllTags(): string[] {
    return Array.from(this.tagIndex.byNormalizedTag.keys());
  }

  /**
   * Get popular tags (most frequently used)
   */
  public getPopularTags(limit: number = 10): Array<{ tag: string; count: number }> {
    return this.tagIndex.popularTags.slice(0, limit);
  }

  /**
   * Get index statistics
   */
  public getStats(): IndexStats {
    const totalTemplates = this.templates.size;
    const totalTags = Array.from(this.templates.values()).reduce((sum, template) => sum + template.tagCount, 0);
    const uniqueTags = this.tagIndex.byNormalizedTag.size;
    const averageTagsPerTemplate = totalTemplates > 0 ? totalTags / totalTemplates : 0;
    const mostPopularTag = this.tagIndex.popularTags[0] || null;

    // Estimate memory usage (rough calculation)
    const indexSize =
      this.templates.size * 200 + // Estimate per template entry
      this.tagIndex.byNormalizedTag.size * 100; // Estimate per tag entry

    return {
      totalTemplates,
      totalTags,
      uniqueTags,
      averageTagsPerTemplate,
      mostPopularTag,
      indexSize,
      buildTime: this.buildTime,
    };
  }

  /**
   * Check if index is built and ready
   */
  public isBuilt(): boolean {
    return this.built;
  }

  /**
   * Add a single template to the index
   */
  private addTemplate(name: string, config: MCPServerParams): void {
    const tags = config.tags || [];
    const normalizedTags = new Set(tags.map((tag) => normalizeTag(tag)));

    const entry: TemplateIndexEntry = {
      name,
      config,
      tags: new Set(tags),
      normalizedTags,
      tagCount: tags.length,
    };

    this.templates.set(name, entry);

    // Update tag index
    for (const tag of tags) {
      const normalizedTag = normalizeTag(tag);

      // Add to regular tag index
      if (!this.tagIndex.byTag.has(tag)) {
        this.tagIndex.byTag.set(tag, new Set());
      }
      this.tagIndex.byTag.get(tag)!.add(name);

      // Add to normalized tag index
      if (!this.tagIndex.byNormalizedTag.has(normalizedTag)) {
        this.tagIndex.byNormalizedTag.set(normalizedTag, new Set());
      }
      this.tagIndex.byNormalizedTag.get(normalizedTag)!.add(name);
    }
  }

  /**
   * Build popular tags list sorted by frequency
   */
  private buildPopularTags(): void {
    const tagCounts = new Map<string, number>();

    // Count tag frequencies
    for (const [normalizedTag, templateNames] of this.tagIndex.byNormalizedTag) {
      tagCounts.set(normalizedTag, templateNames.size);
    }

    // Sort by frequency (descending) and convert to array
    this.tagIndex.popularTags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Evaluate parsed expression using optimized index lookups
   */
  private evaluateParsedExpression(expression: TagExpression): string[] {
    switch (expression.type) {
      case 'tag': {
        return this.getTemplatesByTag(expression.value!);
      }

      case 'not': {
        if (!expression.children || expression.children.length !== 1) {
          return [];
        }
        const childResults = this.evaluateParsedExpression(expression.children[0] as TagExpression);
        const allTemplates = new Set(this.getAllTemplateNames());
        for (const templateName of childResults) {
          allTemplates.delete(templateName);
        }
        return Array.from(allTemplates);
      }

      case 'and': {
        if (!expression.children || expression.children.length === 0) {
          return this.getAllTemplateNames();
        }

        // Get results for first child
        const firstChildResults = this.evaluateParsedExpression(expression.children[0] as TagExpression);
        if (firstChildResults.length === 0) {
          return [];
        }

        // Intersect with results from remaining children
        let result = new Set(firstChildResults);
        for (let i = 1; i < expression.children.length; i++) {
          const childResults = this.evaluateParsedExpression(expression.children[i] as TagExpression);
          const childSet = new Set(childResults);
          result = new Set([...result].filter((x) => childSet.has(x)));

          if (result.size === 0) {
            break; // Early exit if no matches remain
          }
        }

        return Array.from(result);
      }

      case 'or': {
        if (!expression.children || expression.children.length === 0) {
          return [];
        }

        const result = new Set<string>();
        for (const child of expression.children) {
          const childResults = this.evaluateParsedExpression(child as TagExpression);
          for (const templateName of childResults) {
            result.add(templateName);
          }
        }

        return Array.from(result);
      }

      case 'group': {
        if (!expression.children || expression.children.length !== 1) {
          return [];
        }
        return this.evaluateParsedExpression(expression.children[0] as TagExpression);
      }

      default:
        logger.warn(`TemplateIndex.evaluateParsedExpression: Unknown expression type: ${expression.type}`);
        return [];
    }
  }

  /**
   * Clear index
   */
  private clear(): void {
    this.templates.clear();
    this.tagIndex.byTag.clear();
    this.tagIndex.byNormalizedTag.clear();
    this.tagIndex.popularTags = [];
    this.built = false;
    this.buildTime = 0;
  }

  /**
   * Optimize index for memory usage
   */
  public optimize(): void {
    if (!this.built) {
      return;
    }

    // Remove empty tag entries
    for (const [tag, templateNames] of this.tagIndex.byNormalizedTag) {
      if (templateNames.size === 0) {
        this.tagIndex.byNormalizedTag.delete(tag);
      }
    }

    // Rebuild popular tags
    this.buildPopularTags();

    debugIf('TemplateIndex.optimize: Index optimization completed');
  }

  /**
   * Get detailed debugging information
   */
  public getDebugInfo(): {
    templates: Array<{
      name: string;
      tagCount: number;
      tags: string[];
    }>;
    tagDistribution: Array<{
      tag: string;
      count: number;
      templates: string[];
    }>;
    stats: IndexStats;
  } {
    const templates = Array.from(this.templates.values()).map((template) => ({
      name: template.name,
      tagCount: template.tagCount,
      tags: Array.from(template.tags),
    }));

    const tagDistribution = Array.from(this.tagIndex.byNormalizedTag.entries()).map(([tag, templateNames]) => ({
      tag,
      count: templateNames.size,
      templates: Array.from(templateNames),
    }));

    return {
      templates,
      tagDistribution,
      stats: this.getStats(),
    };
  }
}
