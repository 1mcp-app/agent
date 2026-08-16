import { describe, expect, it } from 'vitest';

import { resolveEffectiveServerInstructions } from './effectiveServerInstructions.js';

describe('resolveEffectiveServerInstructions', () => {
  const upstream = 'Upstream {{literal}} instructions';

  it.each([
    ['absent override', {}, upstream],
    [
      'replacement override',
      { instructionOverride: 'Configured {{literal}} replacement' },
      'Configured {{literal}} replacement',
    ],
    ['empty suppression', { instructionOverride: '' }, ''],
    ['whitespace literal replacement', { instructionOverride: '  ' }, '  '],
  ] as const)('resolves a static target with %s', (_case, configuredTarget, expected) => {
    expect(
      resolveEffectiveServerInstructions({
        target: { source: 'mcpServers', name: 'shared' },
        upstreamInstructions: upstream,
        configuredTargets: { mcpServers: { shared: configuredTarget }, mcpTemplates: {} },
      }),
    ).toBe(expected);
  });

  it('restores upstream instructions when an override is removed', () => {
    const configuredTargets: {
      mcpServers: { shared: { instructionOverride?: string } };
      mcpTemplates: Record<string, { instructionOverride?: string }>;
    } = {
      mcpServers: { shared: { instructionOverride: 'temporary' } },
      mcpTemplates: {},
    };
    expect(
      resolveEffectiveServerInstructions({
        target: { source: 'mcpServers', name: 'shared' },
        upstreamInstructions: upstream,
        configuredTargets,
      }),
    ).toBe('temporary');

    delete configuredTargets.mcpServers.shared.instructionOverride;

    expect(
      resolveEffectiveServerInstructions({
        target: { source: 'mcpServers', name: 'shared' },
        upstreamInstructions: upstream,
        configuredTargets,
      }),
    ).toBe(upstream);
  });

  it('keeps same-name static and template targets source-qualified', () => {
    const configuredTargets = {
      mcpServers: { shared: { instructionOverride: 'static replacement' } },
      mcpTemplates: { shared: { instructionOverride: 'template replacement' } },
    };

    expect(
      resolveEffectiveServerInstructions({
        target: { source: 'mcpServers', name: 'shared' },
        upstreamInstructions: upstream,
        configuredTargets,
      }),
    ).toBe('static replacement');
    expect(
      resolveEffectiveServerInstructions({
        target: { source: 'mcpTemplates', name: 'shared' },
        upstreamInstructions: upstream,
        configuredTargets,
      }),
    ).toBe('template replacement');
  });
});
