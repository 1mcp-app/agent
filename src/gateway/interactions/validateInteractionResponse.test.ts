import { describe, expect, it } from 'vitest';

import type { ImmutableJsonValue } from '../contracts/index.js';
import { validateInteractionRequest, validateInteractionResponse } from './validateInteractionResponse.js';

const binding = {
  principal: 'owner',
  request: 'request',
  route: 'route',
  generation: 'one',
  inbound: 'modern',
  outbound: 'legacy',
};

function titledEnumRequest(items: ImmutableJsonValue) {
  return {
    method: 'elicitation/create' as const,
    params: {
      message: 'Select options',
      requestedSchema: {
        type: 'object',
        properties: {
          choices: {
            type: 'array',
            title: 'Choices',
            description: 'Choose up to two options',
            default: ['first'],
            minItems: 1,
            maxItems: 2,
            items,
          },
        },
        required: ['choices'],
      },
    },
  };
}

const titledEnumItems = {
  anyOf: [
    { const: 'first', title: 'First option' },
    { const: 'second', title: 'Second option' },
  ],
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

  it('admits titled multi-select enums without items.type and validates accepted selections', async () => {
    const request = titledEnumRequest(titledEnumItems);
    await expect(validateInteractionRequest(request, binding)).resolves.toBeUndefined();
    await expect(
      validateInteractionResponse(request, { action: 'accept', content: { choices: ['first', 'second'] } }, binding),
    ).resolves.toBeUndefined();
    for (const choices of [['unknown'], [1], [], ['first', 'second', 'first']]) {
      await expect(
        validateInteractionResponse(request, { action: 'accept', content: { choices } }, binding),
      ).rejects.toThrow('schema_input_invalid');
    }
    for (const action of ['decline', 'cancel']) {
      await expect(validateInteractionResponse(request, { action }, binding)).resolves.toBeUndefined();
    }
  });

  it.each([
    ['numeric const', { anyOf: [{ const: 1, title: 'Number' }] }],
    ['missing title', { anyOf: [{ const: 'first' }] }],
    ['non-string title', { anyOf: [{ const: 'first', title: 1 }] }],
    ['nested object', { anyOf: [{ type: 'object', properties: { nested: { type: 'string' } } }] }],
    ['nested array', { anyOf: [{ type: 'array', items: { type: 'string' } }] }],
    ['conflicting item type', { type: 'object', ...titledEnumItems }],
    ['external ref', { anyOf: [{ const: 'first', title: 'First', $ref: 'https://attacker.invalid/schema' }] }],
  ])('rejects %s in titled multi-select enums before presentation', async (_name, items) => {
    await expect(validateInteractionRequest(titledEnumRequest(items), binding)).rejects.toBeDefined();
  });

  it('continues admitting untitled multi-select enums', async () => {
    await expect(
      validateInteractionRequest(titledEnumRequest({ type: 'string', enum: ['first', 'second'] }), binding),
    ).resolves.toBeUndefined();
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
