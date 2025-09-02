/**
 * Type definitions for the dynamic preset system
 */

export type PresetStrategy = 'or' | 'and' | 'advanced';

/**
 * JSON-based tag query for MongoDB-like queries
 * Examples:
 * - { "tag": "web" } - servers with "web" tag
 * - { "$or": [{ "tag": "web" }, { "tag": "api" }] } - servers with "web" OR "api"
 * - { "$and": [{ "tag": "web" }, { "tag": "secure" }] } - servers with BOTH "web" AND "secure"
 * - { "tag": { "$in": ["web", "api", "database"] } } - servers with any of these tags
 */
export interface TagQuery {
  tag?: string;
  $or?: TagQuery[];
  $and?: TagQuery[];
  $not?: TagQuery;
  $in?: string[];
  [key: string]: any;
}

export interface PresetConfig {
  name: string;
  description?: string;
  strategy: PresetStrategy;
  tagQuery: TagQuery; // JSON-based query format
  created: string;
  lastModified: string;
  lastUsed?: string;
}

export interface PresetStorage {
  presets: Record<string, PresetConfig>;
  version?: string;
}

export interface PresetValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PresetUsageStats {
  name: string;
  serverCount: number;
  lastUsed?: string;
  usageFrequency: number;
}

export interface PresetListItem {
  name: string;
  description?: string;
  strategy: PresetStrategy;
  lastUsed?: string;
  tagQuery: TagQuery;
}
