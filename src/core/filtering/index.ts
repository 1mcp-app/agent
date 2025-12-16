/**
 * Filtering module for template server optimization
 * Provides advanced filtering, caching, indexing, and lifecycle management
 */

// Core filtering service
export { TemplateFilteringService } from './templateFilteringService.js';
export type { TemplateFilterOptions, TemplateFilter } from './templateFilteringService.js';

// Client-template lifecycle tracking
export { ClientTemplateTracker } from './clientTemplateTracker.js';
export type { TemplateInstanceInfo, ClientTemplateRelationship } from './clientTemplateTracker.js';

// Performance caching layer
export { FilterCache, getFilterCache, resetFilterCache } from './filterCache.js';
export type { CacheConfig, CacheStats } from './filterCache.js';

// High-performance template indexing
export { TemplateIndex } from './templateIndex.js';
export type { IndexStats } from './templateIndex.js';

// Re-export existing filtering utilities
export { FilteringService } from './filteringService.js';
export {
  filterClientsByTags,
  filterClientsByCapabilities,
  filterClients,
  byCapabilities,
  byTags,
  byTagExpression,
} from './clientFiltering.js';
export type { ClientFilter } from './clientFiltering.js';
