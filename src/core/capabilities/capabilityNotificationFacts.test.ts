import { describe, expect, it } from 'vitest';

import { createCapabilityNotificationFacts } from './capabilityNotificationFacts.js';

describe('createCapabilityNotificationFacts', () => {
  it('maps tool changes to catalog refresh notification facts', () => {
    const facts = createCapabilityNotificationFacts({
      hasChanges: true,
      toolsChanged: true,
      resourcesChanged: false,
      promptsChanged: false,
      addedServers: ['filesystem'],
      removedServers: [],
      previous: {
        tools: [],
        resources: [],
        prompts: [],
        readyServers: [],
        timestamp: new Date(),
      },
      current: {
        tools: [{ name: 'read_file', description: 'Read file', inputSchema: { type: 'object' } }],
        resources: [],
        prompts: [],
        readyServers: ['filesystem'],
        timestamp: new Date(),
      },
    });

    expect(facts.refresh).toEqual({
      changed: true,
      shouldNotifyListChanged: true,
    });
    expect(facts.resourcesChanged).toBe(false);
    expect(facts.promptsChanged).toBe(false);
  });
});
