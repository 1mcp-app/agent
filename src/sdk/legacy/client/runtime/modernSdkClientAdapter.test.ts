import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';

import * as validation from '@src/gateway/interactions/validateInteractionResponse.js';

import { describe, expect, it, vi } from 'vitest';

import { withLegacyInteractionLease } from './legacyInteractionLease.js';
import type { AuthProviderTransport } from './legacyTransport.js';
import { ModernSdkClientAdapter } from './modernSdkClientAdapter.js';

describe('ModernSdkClientAdapter', () => {
  it('uses request-local MRTR capabilities without registering SDK reverse handlers on a capability-less modern client', async () => {
    const client = new Client({ name: 'configured-client', version: '2.0.0' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    const register = vi.spyOn(client, 'setRequestHandler');
    vi.spyOn(client, 'request')
      .mockResolvedValueOnce({
        resultType: 'input_required',
        requestState: 'state',
        inputRequests: { roots: { method: 'roots/list' } },
      } as never)
      .mockResolvedValueOnce({ content: [] } as never);
    const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
    const answer = vi.fn(async () => ({ roots: [] }));
    adapter.registerRequestHandler({ shape: { method: { value: 'roots/list' } } }, answer);
    expect(register).not.toHaveBeenCalled();
    await expect(
      withLegacyInteractionLease(
        adapter,
        () => adapter.request({ id: 'local-profile' as never, method: 'tools/call', params: { name: 'act' } }),
        undefined,
        undefined,
        { roots: {} },
      ),
    ).resolves.toEqual({ content: [] });
    expect(answer).toHaveBeenCalledOnce();
  });
  it.each(['cancel', 'capability loss'] as const)(
    'does not send a continuation after %s during response validation',
    async (change) => {
      const client = new Client({ name: 'configured-client', version: '2.0.0' });
      vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
      vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
      const request = vi.spyOn(client, 'request').mockResolvedValueOnce({
        resultType: 'input_required',
        requestState: 'state',
        inputRequests: { roots: { method: 'roots/list' } },
      } as never);
      const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
      adapter.registerRequestHandler({ shape: { method: { value: 'roots/list' } } }, async () => ({ roots: [] }));
      const controller = new AbortController();
      const capabilities: { roots?: object } = { roots: {} };
      const validate = vi
        .spyOn(validation, 'validateInteractionResponse')
        .mockImplementationOnce(async (_input, _response, _binding, signal) => {
          expect(signal).toBe(controller.signal);
          if (change === 'cancel') controller.abort();
          else delete capabilities.roots;
        });
      try {
        await expect(
          withLegacyInteractionLease(
            adapter,
            () => adapter.request({ id: 'cancelled-round' as never, method: 'tools/call', params: { name: 'act' } }),
            controller.signal,
            undefined,
            capabilities,
          ),
        ).rejects.toBeDefined();
        expect(validate).toHaveBeenCalledOnce();
        expect(request).toHaveBeenCalledOnce();
      } finally {
        validate.mockRestore();
      }
    },
  );

  it('drives a real modern peer MRTR through the gateway using envelope continuations', async () => {
    const calls: unknown[] = [];
    const handler = createMcpHandler(
      () => {
        const server = new Server({ name: 'peer', version: '1' }, { capabilities: { tools: {} } });
        server.setRequestHandler('tools/call', async (_request, context) => {
          expect(context.mcpReq.envelope).toMatchObject({
            'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } },
            'io.modelcontextprotocol/logLevel': 'warning',
          });
          calls.push(context.mcpReq.id);
          if (context.mcpReq.requestState() === undefined)
            return {
              resultType: 'input_required',
              requestState: 'upstream-private-state',
              inputRequests: {
                confirm: {
                  method: 'elicitation/create',
                  params: { mode: 'form', message: 'Confirm', requestedSchema: { type: 'object', properties: {} } },
                },
              },
            };
          expect(context.mcpReq.requestState()).toBe('upstream-private-state');
          expect(context.mcpReq.inputResponses).toEqual({ confirm: { action: 'accept', content: {} } });
          return { content: [{ type: 'text', text: 'done' }] };
        });
        return server;
      },
      { legacy: 'reject' },
    );
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      fetch: async (input, init) => handler.fetch(new Request(input, init)),
    });
    const client = new Client(
      { name: 'gateway', version: '1' },
      { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    await client.connect(transport);
    const adapter = new ModernSdkClientAdapter(client, transport as unknown as AuthProviderTransport);
    adapter.registerRequestHandler({ shape: { method: { value: 'elicitation/create' } } }, async () => ({
      action: 'accept',
      content: {},
    }));
    try {
      await expect(
        withLegacyInteractionLease(
          adapter,
          () => adapter.request({ id: 'operation' as never, method: 'tools/call', params: { name: 'write' } }),
          undefined,
          'warning',
          { elicitation: { form: {} } },
        ),
      ).resolves.toMatchObject({ content: [{ text: 'done' }] });
      expect(calls).toHaveLength(2);
      expect(calls[0]).not.toBe(calls[1]);
    } finally {
      await adapter.close();
      await handler.close();
    }
  });
  it.each([
    ['tools/list', 'tools', { name: 'tool', inputSchema: { type: 'object' } }],
    ['prompts/list', 'prompts', { name: 'prompt' }],
    ['resources/list', 'resources', { name: 'resource', uri: 'file:///resource' }],
    ['resources/templates/list', 'resourceTemplates', { name: 'template', uriTemplate: 'file:///{name}' }],
  ] as const)('keeps %s page-local despite SDK cursorless auto-pagination', async (method, field, item) => {
    const cursors: unknown[] = [];
    const handler = createMcpHandler(
      () => {
        const server = new Server(
          { name: 'paged-peer', version: '1' },
          { capabilities: { tools: {}, prompts: {}, resources: {} } },
        );
        server.setRequestHandler(method, async (request) => {
          const cursor = request.params?.cursor;
          cursors.push(cursor);
          return { [field]: [item], ...(cursor === undefined ? { nextCursor: 'second' } : {}) } as never;
        });
        return server;
      },
      { legacy: 'reject' },
    );
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      fetch: async (input, init) => handler.fetch(new Request(input, init)),
    });
    const client = new Client(
      { name: 'gateway', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    await client.connect(transport);
    const adapter = new ModernSdkClientAdapter(client, transport as unknown as AuthProviderTransport);
    try {
      // The released convenience helper aggregates both pages.
      const helpers = {
        'tools/list': () => client.listTools(),
        'prompts/list': () => client.listPrompts(),
        'resources/list': () => client.listResources(),
        'resources/templates/list': () => client.listResourceTemplates(),
      };
      const aggregate = await helpers[method]();
      expect(aggregate).toMatchObject({ [field]: [item, item] });
      expect(aggregate).not.toHaveProperty('nextCursor');
      expect(cursors).toEqual([undefined, 'second']);
      cursors.length = 0;
      // The gateway boundary must return the first cursor to its own budgeted walker.
      expect(await adapter.request({ id: 'first' as never, method })).toMatchObject({
        [field]: [item],
        nextCursor: 'second',
      });
      expect(cursors).toEqual([undefined]);
      expect(await adapter.request({ id: 'next' as never, method, params: { cursor: 'second' } })).toMatchObject({
        [field]: [item],
      });
      expect(cursors).toEqual([undefined, 'second']);
    } finally {
      await adapter.close();
      await handler.close();
    }
  });

  it.each([
    ['bounded', { content: [{ type: 'text', text: 'x'.repeat(64 * 1024) }] }, true],
    ['string budget', { content: [{ type: 'text', text: 'x'.repeat(1_000_001) }] }, false],
    ['node budget', { content: Array.from({ length: 4000 }, () => ({ type: 'text', text: 'x' })) }, false],
  ] as const)('retains gateway %s limits on a real SSE tool result', async (_label, result, accepted) => {
    let calls = 0;
    const handler = createMcpHandler(
      () => {
        const server = new Server({ name: 'large-peer', version: '1' }, { capabilities: { tools: {} } });
        server.setRequestHandler('tools/call', async () => {
          calls++;
          return result as never;
        });
        return server;
      },
      { legacy: 'reject' },
    );
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      fetch: async (input, init) => {
        const response = await handler.fetch(new Request(input, init));
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        if (body.method !== 'tools/call') return response;
        const json = await response.text();
        return new Response(`event: message\ndata: ${json}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    const client = new Client(
      { name: 'gateway', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    await client.connect(transport);
    const adapter = new ModernSdkClientAdapter(client, transport as unknown as AuthProviderTransport);
    try {
      const pending = adapter.request({ id: 'large' as never, method: 'tools/call', params: { name: 'echo' } });
      if (accepted) await expect(pending).resolves.toMatchObject(result);
      else await expect(pending).rejects.toThrow('Gateway transport failure');
      expect(calls).toBe(1);
    } finally {
      await adapter.close();
      await handler.close();
    }
  });

  it('quarantines malformed template syntax before catalog capture', async () => {
    const client = new Client({ name: 'configured-client', version: '2.0.0' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    const healthy = { name: 'guide', uriTemplate: 'file:///{name}', unknown: [1] };
    vi.spyOn(client, 'request').mockResolvedValue({
      resourceTemplates: [healthy, { name: 'broken', uriTemplate: 'file:///{' }],
    } as never);
    const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
    await expect(adapter.request({ id: 'templates' as never, method: 'resources/templates/list' })).resolves.toEqual({
      resourceTemplates: [healthy, null],
    });
  });

  it.each(['notifications/progress', 'notifications/cancelled', 'notifications/roots/list_changed'])(
    'strips inbound metadata from %s before SDK envelope generation',
    async (method) => {
      const client = new Client({ name: 'configured-client', version: '2.0.0' });
      vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
      vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
      const notify = vi.spyOn(client, 'notification').mockResolvedValue(undefined);
      const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
      await adapter.notify({
        method,
        params: {
          progressToken: 'one',
          progress: 1,
          data: { baggage: 'business' },
          _meta: {
            baggage: 'private',
            'io.modelcontextprotocol/protocolVersion': '2025-11-25',
            'io.modelcontextprotocol/clientInfo': { name: 'inbound', version: '1' },
          },
        },
      });
      expect(notify).toHaveBeenCalledWith({
        method,
        params: { progressToken: 'one', progress: 1, data: { baggage: 'business' } },
      });
    },
  );

  it.each([
    ['tools/list', { cursor: 'page-2', _meta: { attacker: true } }, { cursor: 'page-2' }],
    [
      'tools/call',
      {
        name: 'echo',
        arguments: { text: 'hello' },
        _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'spoof' } },
      },
      { name: 'echo', arguments: { text: 'hello' } },
    ],
  ] as const)(
    'strips caller-controlled _meta from %s while preserving business params',
    async (method, params, expected) => {
      const client = new Client({ name: 'configured-client', version: '2.0.0' }, { capabilities: { roots: {} } });
      vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
      vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
      const request = vi.spyOn(client, 'request').mockResolvedValue({ tools: [] } as never);
      const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);

      await adapter.request({ id: `request-${method}`, method, params } as never);

      expect(request.mock.calls[0][0]).toMatchObject({ method, params: expected });
      expect(request.mock.calls[0].at(-1)).toMatchObject({ signal: expect.any(AbortSignal) });
    },
  );

  it.each(['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list'])(
    'preserves opaque %s data and malformed siblings for catalog quarantine',
    async (method) => {
      const client = new Client({ name: 'configured-client', version: '2.0.0' });
      vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
      vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
      const result = { arbitrary: [{ nested: [1, true, null] }, { name: 42 }] };
      const request = vi.spyOn(client, 'request').mockResolvedValue(result as never);
      const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
      const captured = await adapter.request({ id: `list-${method}`, method } as never);
      const schema = request.mock.calls[0][1];
      expect(await schema['~standard'].validate(result)).toEqual({ value: result });
      expect(captured).toEqual(result);
      expect(captured).not.toBe(result);
      expect(await schema['~standard'].validate(null)).toHaveProperty('issues');
    },
  );

  it('shares concurrent close work and publishes closed once', async () => {
    const client = new Client({ name: 'modern-test', version: '2.0.0' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    let finishClose!: () => void;
    const close = vi
      .spyOn(client, 'close')
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishClose = resolve)));
    const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);

    const first = adapter.close();
    const second = adapter.close();
    await vi.waitFor(() => expect(finishClose).toBeTypeOf('function'));
    expect(close).toHaveBeenCalledOnce();

    finishClose();
    await Promise.all([first, second, adapter.close()]);

    expect(close).toHaveBeenCalledOnce();
    await expect(adapter.nextEvent()).resolves.toEqual({ type: 'closed' });
  });
});
