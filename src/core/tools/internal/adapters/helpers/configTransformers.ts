/**
 * Configuration transformation and change detection helpers
 */
import { MCPServerParams } from '@src/core/types/index.js';

/**
 * Configuration change tracking
 */
export interface ConfigChange {
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Detect changes between two configurations
 */
export function detectConfigChanges(
  oldConfig: MCPServerParams,
  newConfig: Partial<MCPServerParams & { newName?: string }>,
  serverName: string,
): ConfigChange[] {
  const changes: ConfigChange[] = [];

  // Handle renaming as a change
  if (newConfig.newName && newConfig.newName !== serverName) {
    changes.push({
      field: 'name',
      oldValue: serverName,
      newValue: newConfig.newName,
    });
  }

  // Check all other fields for changes
  const checkableFields = [
    'disabled',
    'timeout',
    'connectionTimeout',
    'requestTimeout',
    'tags',
    'command',
    'args',
    'cwd',
    'env',
    'inheritParentEnv',
    'envFilter',
    'restartOnExit',
    'maxRestarts',
    'restartDelay',
    'url',
    'headers',
    'oauth',
  ] as const;

  for (const field of checkableFields) {
    if (field in newConfig) {
      const oldValue = oldConfig[field];
      const newValue = newConfig[field];

      // Only add change if value is actually different
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({
          field,
          oldValue,
          newValue,
        });
      }
    }
  }

  return changes;
}

/**
 * Generate warnings based on configuration changes
 */
export function generateChangeWarnings(changes: ConfigChange[]): string[] {
  const warnings: string[] = [];

  if (changes.some((change) => change.field === 'command' || change.field === 'url')) {
    warnings.push('Transport configuration changed - server restart required');
  }

  if (changes.some((change) => change.field === 'oauth')) {
    warnings.push('OAuth configuration changed - re-authentication may be required');
  }

  return warnings;
}

/**
 * Transform server info for display
 */
export function transformServerInfo(name: string, config: MCPServerParams) {
  return {
    name,
    config,
    status: config.disabled ? ('disabled' as const) : ('enabled' as const),
    transport: config.url ? (config.url.includes('/sse') ? ('sse' as const) : ('http' as const)) : ('stdio' as const),
    url: config.url,
    healthStatus: 'unknown' as const,
    metadata: {
      tags: config.tags,
    },
  };
}
