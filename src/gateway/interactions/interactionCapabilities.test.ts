import { describe, expect, it } from 'vitest';

import { hasInteractionCapability } from './interactionCapabilities.js';

describe('exact interaction capability profiles', () => {
  it('requires the declared baseline capability', () => {
    expect(hasInteractionCapability({}, { method: 'roots/list' })).toBe(false);
    expect(hasInteractionCapability({ roots: {} }, { method: 'roots/list' })).toBe(true);
    expect(hasInteractionCapability({ roots: {} }, { method: 'sampling/createMessage' })).toBe(false);
  });

  it('requires sampling.tools for tools or toolChoice, including an empty tools array', () => {
    const request = {
      method: 'sampling/createMessage' as const,
      params: { tools: [{ name: 'local', inputSchema: {} }] },
    };
    expect(hasInteractionCapability({ sampling: {} }, request)).toBe(false);
    expect(hasInteractionCapability({ sampling: { tools: {} } }, request)).toBe(true);
    expect(hasInteractionCapability({ sampling: {} }, { ...request, params: { tools: [] } })).toBe(false);
    expect(hasInteractionCapability({ sampling: {} }, { ...request, params: { toolChoice: { mode: 'auto' } } })).toBe(
      false,
    );
    expect(hasInteractionCapability({ sampling: { tools: {} } }, { ...request, params: { tools: [] } })).toBe(true);
  });

  it('preserves implicit form compatibility but never lends URL capability to form or vice versa', () => {
    const form = { method: 'elicitation/create' as const, params: { message: 'Confirm' } };
    const url = { ...form, params: { mode: 'url', message: 'Login' } };
    expect(hasInteractionCapability({ elicitation: {} }, form)).toBe(true);
    expect(hasInteractionCapability({ elicitation: {} }, url)).toBe(false);
    expect(hasInteractionCapability({ elicitation: { form: {} } }, url)).toBe(false);
    expect(hasInteractionCapability({ elicitation: { url: {} } }, form)).toBe(false);
    expect(hasInteractionCapability({ elicitation: { url: {} } }, url)).toBe(true);
  });
});
