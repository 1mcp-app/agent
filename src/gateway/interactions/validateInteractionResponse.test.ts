import { describe, expect, it } from 'vitest';

import { validateInteractionRequest, validateInteractionResponse } from './validateInteractionResponse.js';

const binding = {
  principal: 'owner',
  request: 'request',
  route: 'route',
  generation: 'one',
  inbound: 'modern',
  outbound: 'legacy',
};

describe('shared interaction schema boundary', () => {
  it('passes cancellation through the shared request and response schema boundary', async () => {
    const controller = new AbortController();
    controller.abort();
    const request = {
      method: 'elicitation/create' as const,
      params: { message: 'Name', requestedSchema: { type: 'object', properties: {} } },
    };
    await expect(validateInteractionRequest(request, binding, controller.signal)).rejects.toThrow(
      'schema_evaluation_unavailable',
    );
    await expect(
      validateInteractionResponse(request, { action: 'decline' }, binding, controller.signal),
    ).rejects.toThrow('schema_evaluation_unavailable');
  });

  it('admits a form before presentation and rejects nested objects and unresolved refs', async () => {
    await expect(
      validateInteractionRequest(
        {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: 'Name',
            requestedSchema: { type: 'object', properties: { name: { type: 'string' } } },
          },
        },
        binding,
      ),
    ).resolves.toBeUndefined();
    await expect(
      validateInteractionRequest(
        {
          method: 'elicitation/create',
          params: { message: 'Name', requestedSchema: { type: 'object', properties: { nested: { type: 'object' } } } },
        },
        binding,
      ),
    ).rejects.toBeDefined();
    await expect(
      validateInteractionRequest(
        {
          method: 'elicitation/create',
          params: {
            message: 'Name',
            requestedSchema: {
              type: 'object',
              properties: { name: { type: 'string', $ref: 'https://attacker.invalid/schema' } },
            },
          },
        },
        binding,
      ),
    ).rejects.toBeDefined();
  });

  it('admits sampling tool schemas before forwarding and never treats them as aggregate tools', async () => {
    const params = {
      messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
      maxTokens: 10,
      tools: [{ name: 'local', inputSchema: { type: 'object', properties: {} } }],
    };
    await expect(
      validateInteractionRequest({ method: 'sampling/createMessage', params }, binding),
    ).resolves.toBeUndefined();
    await expect(
      validateInteractionRequest(
        {
          method: 'sampling/createMessage',
          params: { ...params, tools: [{ name: 'local', inputSchema: { $ref: 'file:///private/schema' } }] },
        },
        binding,
      ),
    ).rejects.toBeDefined();
  });

  it('rejects invalid roots and malformed sampling blocks while preserving decline/cancel', async () => {
    await expect(
      validateInteractionResponse({ method: 'roots/list' }, { roots: [{ uri: 'file:///workspace' }] }, binding),
    ).resolves.toBeUndefined();
    await expect(
      validateInteractionResponse({ method: 'roots/list' }, { roots: [{ uri: 'file://[' }] }, binding),
    ).rejects.toBeDefined();
    await expect(
      validateInteractionResponse(
        { method: 'sampling/createMessage' },
        { role: 'assistant', model: 'peer', content: { type: 'tool_result', toolUseId: 'one', content: [{}] } },
        binding,
      ),
    ).rejects.toBeDefined();
    for (const action of ['decline', 'cancel'])
      await expect(
        validateInteractionResponse({ method: 'elicitation/create' }, { action }, binding),
      ).resolves.toBeUndefined();
  });
});
