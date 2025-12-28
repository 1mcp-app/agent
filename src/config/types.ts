import type { MCPServerParams } from '@src/core/types/transport.js';

export enum ConfigChangeType {
  ADDED = 'added',
  REMOVED = 'removed',
  MODIFIED = 'modified',
}

export const CONFIG_EVENTS = {
  CONFIG_CHANGED: 'configChanged',
  SERVER_ADDED: 'serverAdded',
  SERVER_REMOVED: 'serverRemoved',
  METADATA_UPDATED: 'metadataUpdated',
  VALIDATION_ERROR: 'validationError',
} as const;

/**
 * Configuration change event with discriminated union to prevent invalid states.
 * - Added servers don't have fieldsChanged
 * - Removed servers don't have fieldsChanged
 * - Modified servers must have fieldsChanged
 */
export type ConfigChange =
  | { serverName: string; type: ConfigChangeType.ADDED }
  | { serverName: string; type: ConfigChangeType.REMOVED }
  | { serverName: string; type: ConfigChangeType.MODIFIED; fieldsChanged: readonly string[] };

export interface TemplateLoadResult {
  staticServers: Record<string, MCPServerParams>;
  templateServers: Record<string, MCPServerParams>;
  errors: string[];
}
