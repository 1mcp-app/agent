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

export interface ConfigChange {
  serverName: string;
  type: ConfigChangeType;
  fieldsChanged?: string[];
}

export interface TemplateLoadResult {
  staticServers: Record<string, MCPServerParams>;
  templateServers: Record<string, MCPServerParams>;
  errors: string[];
}
