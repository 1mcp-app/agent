import { schemaBoundary } from '@src/core/validation/schemaBoundary.js';

import type { GatewayInteractionRequest } from '../ports/outboundEraAdapter.js';
import type { InteractionBinding } from './interactionOwner.js';

const object = { type: 'object' };
const simpleContent = {
  anyOf: [
    { type: 'object', required: ['type', 'text'], properties: { type: { const: 'text' }, text: { type: 'string' } } },
    {
      type: 'object',
      required: ['type', 'data', 'mimeType'],
      properties: { type: { enum: ['image', 'audio'] }, data: { type: 'string' }, mimeType: { type: 'string' } },
    },
  ],
};
const contentBlock = {
  anyOf: [
    { type: 'object', required: ['type', 'text'], properties: { type: { const: 'text' }, text: { type: 'string' } } },
    {
      type: 'object',
      required: ['type', 'data', 'mimeType'],
      properties: { type: { enum: ['image', 'audio'] }, data: { type: 'string' }, mimeType: { type: 'string' } },
    },
    {
      type: 'object',
      required: ['type', 'id', 'name', 'input'],
      properties: { type: { const: 'tool_use' }, id: { type: 'string' }, name: { type: 'string' }, input: object },
    },
    {
      type: 'object',
      required: ['type', 'toolUseId', 'content'],
      properties: {
        type: { const: 'tool_result' },
        toolUseId: { type: 'string' },
        content: { type: 'array', items: simpleContent },
        isError: { type: 'boolean' },
      },
    },
  ],
};
const responseSchemas = {
  'elicitation/create': {
    type: 'object',
    required: ['action'],
    properties: {
      action: { enum: ['accept', 'decline', 'cancel'] },
      content: object,
    },
  },
  'roots/list': {
    type: 'object',
    required: ['roots'],
    properties: {
      roots: {
        type: 'array',
        items: {
          type: 'object',
          required: ['uri'],
          properties: {
            uri: { type: 'string', pattern: '^file://', format: 'uri' },
            name: { type: 'string' },
          },
        },
      },
    },
  },
  'sampling/createMessage': {
    type: 'object',
    required: ['role', 'content', 'model'],
    properties: {
      role: { enum: ['assistant', 'user'] },
      model: { type: 'string' },
      content: { anyOf: [contentBlock, { type: 'array', items: contentBlock }] },
      stopReason: { type: 'string' },
    },
  },
};

/** Every schema evaluation, including elicitation's caller-supplied schema, uses #481's bounded worker. */
export async function validateInteractionResponse(
  request: GatewayInteractionRequest,
  response: unknown,
  binding: InteractionBinding,
): Promise<void> {
  const scope = { routeKey: binding.route, generation: binding.generation, profile: 'interaction' as const };
  const contract = await schemaBoundary.admit(responseSchemas[request.method], scope);
  await schemaBoundary.evaluate(contract, response, scope);
  const value = response as Record<string, unknown>;
  const params = request.params as Record<string, unknown> | undefined;
  if (request.method === 'roots/list') {
    for (const root of value.roots as Array<{ uri: string }>) {
      const parsed = new URL(root.uri);
      if (
        parsed.protocol !== 'file:' ||
        !parsed.pathname.startsWith('/') ||
        Array.from(root.uri).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127) ||
        /%(?![0-9a-f]{2})/iu.test(root.uri)
      )
        throw new TypeError('Invalid root URI');
    }
  }
  if (
    request.method === 'elicitation/create' &&
    value.action === 'accept' &&
    params &&
    typeof params === 'object' &&
    !Array.isArray(params) &&
    params.requestedSchema !== undefined
  ) {
    const content = await schemaBoundary.admit(params.requestedSchema, scope);
    await schemaBoundary.evaluate(content, value.content, scope);
  }
}

export async function validateInteractionRequest(
  request: GatewayInteractionRequest,
  binding: InteractionBinding,
): Promise<void> {
  const scope = { routeKey: binding.route, generation: binding.generation, profile: 'interaction' as const };
  const params = request.params as Record<string, unknown> | undefined;
  if (request.method === 'roots/list') return;
  const schema =
    request.method === 'elicitation/create'
      ? {
          type: 'object',
          required: ['message'],
          properties: { message: { type: 'string' }, mode: { enum: ['form', 'url'] }, url: { type: 'string' } },
          anyOf: [
            { required: ['requestedSchema'] },
            {
              required: ['mode', 'url', 'elicitationId'],
              properties: { mode: { const: 'url' }, elicitationId: { type: 'string' } },
            },
          ],
        }
      : {
          type: 'object',
          required: ['messages', 'maxTokens'],
          properties: {
            maxTokens: { type: 'integer', minimum: 1 },
            systemPrompt: { type: 'string' },
            includeContext: { enum: ['none', 'thisServer', 'allServers'] },
            messages: {
              type: 'array',
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { enum: ['user', 'assistant'] },
                  content: { anyOf: [contentBlock, { type: 'array', items: contentBlock }] },
                },
              },
            },
            tools: {
              type: 'array',
              items: { type: 'object', required: ['name', 'inputSchema'], properties: { name: { type: 'string' } } },
            },
          },
        };
  await schemaBoundary.evaluate(await schemaBoundary.admit(schema, scope), params, scope);
  if (request.method === 'elicitation/create' && params?.requestedSchema !== undefined) {
    const formProfile = {
      type: 'object',
      required: ['type', 'properties'],
      properties: {
        type: { const: 'object' },
        properties: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            anyOf: [
              { required: ['type'], properties: { type: { enum: ['string', 'number', 'integer', 'boolean'] } } },
              {
                required: ['type', 'items'],
                properties: {
                  type: { const: 'array' },
                  items: { type: 'object', required: ['type'], properties: { type: { const: 'string' } } },
                },
              },
            ],
          },
        },
      },
    };
    await schemaBoundary.evaluate(await schemaBoundary.admit(formProfile, scope), params.requestedSchema, scope);
    await schemaBoundary.admit(params.requestedSchema, scope);
  }
  if (request.method === 'sampling/createMessage' && Array.isArray(params?.tools)) {
    for (const tool of params.tools as Array<Record<string, unknown>>) {
      await schemaBoundary.admit(tool.inputSchema, { ...scope, profile: 'tool-input' });
      if (tool.outputSchema !== undefined)
        await schemaBoundary.admit(tool.outputSchema, { ...scope, profile: 'tool-output' });
    }
  }
}
