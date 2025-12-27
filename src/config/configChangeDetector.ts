import { MCPServerParams } from '@src/core/types/transport.js';

import { ConfigChange, ConfigChangeType } from './types.js';

export class ConfigChangeDetector {
  private deepEqual(obj1: unknown, obj2: unknown): boolean {
    if (obj1 === obj2) return true;
    if (obj1 == null || obj2 == null) return false;
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  }

  private getChangedFields(oldConfig: MCPServerParams, newConfig: MCPServerParams): string[] {
    const changed: string[] = [];
    for (const key of Object.keys(newConfig) as (keyof MCPServerParams)[]) {
      if (!(key in oldConfig) || !this.deepEqual(oldConfig[key], newConfig[key])) {
        changed.push(key);
      }
    }
    return changed;
  }

  public detectChanges(
    oldConfig: Record<string, MCPServerParams>,
    newConfig: Record<string, MCPServerParams>,
  ): ConfigChange[] {
    const changes: ConfigChange[] = [];
    const oldKeys = new Set(Object.keys(oldConfig));
    const newKeys = new Set(Object.keys(newConfig));

    for (const name of newKeys) {
      if (!oldKeys.has(name)) {
        changes.push({ serverName: name, type: ConfigChangeType.ADDED });
      }
    }

    for (const name of oldKeys) {
      if (!newKeys.has(name)) {
        changes.push({ serverName: name, type: ConfigChangeType.REMOVED });
      }
    }

    for (const name of newKeys) {
      if (oldKeys.has(name)) {
        const oldServer = oldConfig[name];
        const newServer = newConfig[name];

        if (!this.deepEqual(oldServer, newServer)) {
          changes.push({
            serverName: name,
            type: ConfigChangeType.MODIFIED,
            fieldsChanged: this.getChangedFields(oldServer, newServer),
          });
        }
      }
    }

    return changes;
  }
}
