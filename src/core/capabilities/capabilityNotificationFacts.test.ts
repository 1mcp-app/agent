import { describe, expect, it } from 'vitest';

import { createCapabilityNotificationFacts } from './capabilityNotificationFacts.js';

describe('createCapabilityNotificationFacts', () => {
  it('maps a template-only generation change to resource notification facts', () => {
    const previous = {
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
      readyServers: ['filesystem'],
      timestamp: new Date(),
    };
    const facts = createCapabilityNotificationFacts({
      hasChanges: true,
      toolsChanged: false,
      resourcesChanged: false,
      resourceTemplatesChanged: true,
      promptsChanged: false,
      addedServers: [],
      removedServers: [],
      previous,
      current: { ...previous, resourceTemplates: [{ name: 'guides', uriTemplate: 'file:///{name}' }] },
    });
    expect(facts.resourcesChanged).toBe(true);
    expect(facts.refresh).toEqual({ changed: true, shouldNotifyListChanged: false });
    expect(facts.promptsChanged).toBe(false);
  });

  it('maps tool changes to catalog refresh notification facts', () => {
    const facts = createCapabilityNotificationFacts({
      hasChanges: true,
      toolsChanged: true,
      resourcesChanged: false,
      resourceTemplatesChanged: false,
      promptsChanged: false,
      addedServers: ['filesystem'],
      removedServers: [],
      previous: {
        tools: [],
        resources: [],
        resourceTemplates: [],
        prompts: [],
        readyServers: [],
        timestamp: new Date(),
      },
      current: {
        tools: [{ name: 'read_file', description: 'Read file', inputSchema: { type: 'object' } }],
        resources: [],
        resourceTemplates: [],
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
