import type { CapabilityChanges } from './capabilityAggregator.js';
import type { CapabilityRefreshResult } from './capabilityCatalog.js';

export interface CapabilityNotificationFacts {
  refresh: Required<CapabilityRefreshResult>;
  resourcesChanged: boolean;
  promptsChanged: boolean;
}

export function createCapabilityNotificationFacts(changes: CapabilityChanges): CapabilityNotificationFacts {
  return {
    refresh: {
      changed: changes.hasChanges,
      shouldNotifyListChanged: changes.toolsChanged,
    },
    resourcesChanged: changes.resourcesChanged,
    promptsChanged: changes.promptsChanged,
  };
}
