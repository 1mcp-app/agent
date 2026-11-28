import { createMockLegacyInboundConnection, createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { ClientStatus, type InboundConnection, type OutboundConnections } from '@src/core/types/index.js';
import type { JsonObject, JsonValue } from '@src/sdk/contracts/index.js';
import {
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
} from '@src/sdk/legacy/types.js';

import { describe, expect, it, vi } from 'vitest';

import { registerPromptHandlers } from './promptRequestHandlers.js';
import { registerResourceHandlers } from './resourceRequestHandlers.js';

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return { getTemplateServerManager: () => undefined };
    },
  },
}));

type ListingHandler = (
  request: { params: Record<string, unknown> },
  extra: { signal: AbortSignal },
) => Promise<unknown>;

type RegisterHandlers = (connections: OutboundConnections, inbound: InboundConnection) => void;

function listingHandler(register: RegisterHandlers, connections: OutboundConnections, schema: unknown) {
  const handlers = new Map<unknown, ListingHandler>();
  const inbound = createMockLegacyInboundConnection({
    context: { sessionId: 'session-1' },
    server: {
      setRequestHandler: vi.fn((registered: unknown, handler: ListingHandler) => handlers.set(registered, handler)),
    } as never,
  });
  register(connections, inbound);
  const handler = handlers.get(schema);
  if (!handler) throw new Error('Listing handler was not registered');
  return (params: Record<string, unknown> = {}) => handler({ params }, { signal: new AbortController().signal });
}

type ResultsByMethod = Record<string, JsonValue>;

function backend(capabilities: JsonObject, results: ResultsByMethod) {
  return createMockOutboundConnection({
    name: 'backend',
    status: ClientStatus.Connected,
    capabilities,
    adapter: { request: vi.fn(async ({ method }) => results[method] ?? {}) },
  });
}

function stableConnections(capabilities: JsonObject, results: ResultsByMethod): OutboundConnections {
  return new Map([['backend', backend(capabilities, results)]]);
}

/** Replaces the captured connection on every upstream request while the first enumeration runs. */
function replacingConnections(capabilities: JsonObject, results: ResultsByMethod): OutboundConnections {
  const connections: OutboundConnections = new Map();
  const replacement = backend(capabilities, results);
  connections.set(
    'backend',
    createMockOutboundConnection({
      name: 'backend',
      status: ClientStatus.Connected,
      capabilities,
      adapter: {
        request: vi.fn(async ({ method }) => {
          connections.set('backend', replacement);
          return results[method] ?? {};
        }),
      },
    }),
  );
  return connections;
}

const prompt = { name: 'greeting', arguments: [{ name: 'topic' }] };
const resource = { name: 'guide', uri: 'file:///guide' };
const template = { name: 'guides', uriTemplate: 'file:///{name}' };

describe('catalog listing backend replacement', () => {
  it('returns the prompt catalog when an upstream adapter is replaced during the first listing', async () => {
    const results = { 'prompts/list': { prompts: [prompt] } };
    const expected = (await listingHandler(
      registerPromptHandlers,
      stableConnections({ prompts: {} }, results),
      ListPromptsRequestSchema,
    )()) as { prompts: unknown[] };
    expect(expected.prompts).toHaveLength(1);

    const racing = listingHandler(
      registerPromptHandlers,
      replacingConnections({ prompts: {} }, results),
      ListPromptsRequestSchema,
    );
    await expect(racing()).resolves.toEqual(expected);
  });

  it.each([
    ['resources', ListResourcesRequestSchema, 'resources'],
    ['resourceTemplates', ListResourceTemplatesRequestSchema, 'resourceTemplates'],
  ] as const)('returns the %s catalog when an upstream adapter is replaced', async (_kind, schema, kind) => {
    const results = {
      'resources/list': { resources: [resource] },
      'resources/templates/list': { resourceTemplates: [template] },
    };
    const expected = (await listingHandler(
      registerResourceHandlers,
      stableConnections({ resources: {} }, results),
      schema,
    )()) as Record<string, unknown[]>;
    expect(expected[kind]).toHaveLength(1);

    const racing = listingHandler(registerResourceHandlers, replacingConnections({ resources: {} }, results), schema);
    await expect(racing()).resolves.toEqual(expected);
  });
});
