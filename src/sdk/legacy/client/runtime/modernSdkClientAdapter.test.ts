import {
  Client,
  MissingRequiredClientCapabilityError,
  ProtocolError,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';

import * as validation from '@src/gateway/interactions/validateInteractionResponse.js';
import {
  getCapabilityPaginationGeneration,
  registerCapabilityPaginationNotifications,
  unregisterCapabilityPaginationConnections,
} from '@src/core/capabilities/capabilityPagination.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/index.js';
import { gatewayFailureFromUnknown, gatewayFailureToMcp } from '@src/gateway/contracts/gatewayFailure.js';
import { withRequestProgress } from '@src/sdk/contracts/requestProgress.js';

import { describe, expect, it, vi } from 'vitest';

import { withLegacyInteractionLease } from './legacyInteractionLease.js';
import type { AuthProviderTransport } from './legacyTransport.js';
import { ModernSdkClientAdapter, setModernSdkTransport } from './modernSdkClientAdapter.js';

describe('ModernSdkClientAdapter', () => {
  it('retains the shared lease when the modern SDK negotiated the legacy protocol', async () => {
    const client = new Client({ name: 'configured-client', version: '2' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('legacy');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2025-11-25');
    const request = vi.spyOn(client, 'request');
    const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
    let release!: () => void;
    const pending = withLegacyInteractionLease(
      adapter,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    try {
      await expect(
        adapter.request({ id: 'legacy-peer' as never, method: 'tools/call', params: { name: 'act' } }),
      ).rejects.toThrow('interaction_capacity_exceeded');
      expect(request).not.toHaveBeenCalled();
    } finally {
      release();
      await pending;
    }
  });
  it('keeps concurrent modern callback answers and continuations attached to their request', async () => {
    const client = new Client({ name: 'configured-client', version: '2' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    const request = vi.spyOn(client, 'request').mockImplementation(async (message) => {
      const params = message.params as { name: string; inputResponses?: { roots: unknown } };
      if (params.inputResponses) return { content: [], ownerAnswer: params.inputResponses.roots } as never;
      return { resultType: 'input_required', inputRequests: { roots: { method: 'roots/list' } } } as never;
    });
    const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
    let answerFirst!: (value: unknown) => void;
    adapter.registerRequestHandler(
      { shape: { method: { value: 'roots/list' } } },
      () =>
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
    );
    const first = withLegacyInteractionLease(
      adapter,
      () =>
        adapter.request({
          id: 'first-owner' as never,
          method: 'tools/call',
          params: { name: 'first' },
        }),
      undefined,
      undefined,
      { roots: {} },
    );
    await vi.waitFor(() => expect(answerFirst).toBeTypeOf('function'));
    adapter.registerRequestHandler({ shape: { method: { value: 'roots/list' } } }, async () => ({
      roots: [{ uri: 'file:///second' }],
    }));
    await expect(
      withLegacyInteractionLease(
        adapter,
        () =>
          adapter.request({
            id: 'second-owner' as never,
            method: 'tools/call',
            params: { name: 'second' },
          }),
        undefined,
        undefined,
        { roots: {} },
      ),
    ).resolves.toMatchObject({ ownerAnswer: { roots: [{ uri: 'file:///second' }] } });
    answerFirst({ roots: [{ uri: 'file:///first' }] });
    await expect(first).resolves.toMatchObject({ ownerAnswer: { roots: [{ uri: 'file:///first' }] } });
    expect(request.mock.calls.map(([message]) => (message.params as { name: string }).name)).toEqual([
      'first',
      'second',
      'second',
      'first',
    ]);
  });
  it('keeps the original cancellation reservation when a duplicate modern request is rejected', async () => {
    const client = new Client({ name: 'configured-client', version: '2' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    const request = vi.spyOn(client, 'request').mockResolvedValue({
      resultType: 'input_required',
      inputRequests: { roots: { method: 'roots/list' } },
    } as never);
    const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
    let answer!: (value: unknown) => void;
    adapter.registerRequestHandler(
      { shape: { method: { value: 'roots/list' } } },
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const frame = { id: 'same-owner' as never, method: 'tools/call', params: { name: 'act' } };
    const original = withLegacyInteractionLease(adapter, () => adapter.request(frame), undefined, undefined, {
      roots: {},
    });
    const rejected = expect(original).rejects.toMatchObject({ code: 'interaction_expired' });
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
    await expect(adapter.request(frame)).rejects.toMatchObject({ code: 'modern_outbound_duplicate_request' });
    await adapter.cancel(frame.id);
    answer({ roots: [] });
    await rejected;
    expect(request).toHaveBeenCalledOnce();
  });

  it('rechecks the selected provider immediately before a modern continuation dispatch', async () => {
    const client = new Client({ name: 'configured-client', version: '2' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    const request = vi.spyOn(client, 'request').mockResolvedValue({
      resultType: 'input_required',
      inputRequests: { roots: { method: 'roots/list' } },
    } as never);
    const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
    adapter.registerRequestHandler({ shape: { method: { value: 'roots/list' } } }, async () => ({ roots: [] }));
    let current = true;
    const validate = vi.spyOn(validation, 'validateInteractionResponse').mockImplementationOnce(async () => {
      current = false;
    });
    try {
      await expect(
        withLegacyInteractionLease(
          adapter,
          () =>
            adapter.request({
              id: 'provider-fence' as never,
              method: 'tools/call',
              params: { name: 'act' },
            }),
          undefined,
          undefined,
          { roots: {} },
          () => {
            if (!current) throw new Error('selected provider invalidated');
          },
        ),
      ).rejects.toBeDefined();
      expect(request).toHaveBeenCalledOnce();
    } finally {
      validate.mockRestore();
    }
  });
  it('retains only an actual SDK missing-capability rejection, not foreign numeric failures', async () => {
    const client = new Client({ name: 'configured-client', version: '2' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    const request = vi.spyOn(client, 'request');
    const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
    const errors = [
      new MissingRequiredClientCapabilityError({ requiredCapabilities: { sampling: {} } }),
      { code: -32021, message: 'foreign', data: { requiredCapabilities: { sampling: {} } } },
      new Error('network failed'),
      new ProtocolError(-32603, 'ambiguous failure'),
    ];
    for (const [index, error] of errors.entries()) {
      request.mockRejectedValueOnce(error);
      const caught = await adapter
        .request({ id: `missing-${index}` as never, method: 'tools/call', params: { name: 'write' } })
        .catch((failure: unknown) => failure);
      const failure = gatewayFailureFromUnknown(caught, 'transport');
      if (index === 0) expect(gatewayFailureToMcp(failure).code).toBe(-32021);
      else {
        expect(failure.kind).toBe('transport');
        expect(gatewayFailureToMcp(failure).code).not.toBe(-32021);
      }
    }
    expect(request).toHaveBeenCalledTimes(errors.length);
  });

  it('uses a request-owned SDK progress callback and preserves the native demultiplexer', async () => {
    const client = new Client({ name: 'configured-client', version: '2' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    const register = vi.spyOn(client, 'setNotificationHandler');
    const adapter = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
    register.mockClear();
    const raw = vi.fn();
    adapter.registerNotificationHandler({ shape: { method: { value: 'notifications/progress' } } }, raw);
    expect(register).not.toHaveBeenCalled();
    const send = vi.fn(async () => {});
    vi.spyOn(client, 'request').mockImplementation(async (_message, options) => {
      expect(options).toMatchObject({ onprogress: expect.any(Function) });
      if (options && 'onprogress' in options && typeof options.onprogress === 'function')
        options.onprogress({ progress: 3 });
      return { content: [] } as never;
    });
    expect(
      await withRequestProgress('caller', send, () =>
        adapter.request({
          id: 'progress' as never,
          method: 'tools/call',
          params: { name: 'write', _meta: { progressToken: 'forged' } },
        }),
      ),
    ).toEqual({ content: [] });
    expect(send).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'caller', progress: 3 },
    });
    expect(raw).not.toHaveBeenCalled();
  });
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

describe('ModernSdkClientAdapter custom HTTP headers', () => {
  const tool = {
    name: 'act',
    inputSchema: { type: 'object', properties: { region: { type: 'string', 'x-mcp-header': 'Region' } } },
  };
  function mockedHttpAdapter() {
    const client = new Client({ name: 'header-client', version: '1' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    const notifications = vi.spyOn(client, 'setNotificationHandler');
    const request = vi.spyOn(client, 'request').mockResolvedValue({ content: [] } as never);
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'));
    vi.spyOn(transport, 'send').mockResolvedValue(undefined);
    const adapter = new ModernSdkClientAdapter(client, transport as unknown as AuthProviderTransport);
    return { client, adapter, request, notifications, transport };
  }
  let nextListId = 0;
  const list = (adapter: ModernSdkClientAdapter, cursor?: string) =>
    adapter.request({
      id: `list-${nextListId++}` as never,
      method: 'tools/list',
      ...(cursor === undefined ? {} : { params: { cursor } }),
    });
  const call = (adapter: ModernSdkClientAdapter) =>
    adapter.request({
      id: 'call' as never,
      method: 'tools/call',
      params: { name: 'act', arguments: { region: 'west' } },
    });

  it('sends only provider schema-derived headers and preserves SDK-managed header precedence on the real HTTP wire', async () => {
    const wire: Array<{ method: string; headers: Headers; body: Record<string, unknown> }> = [];
    const invalidSuffixTools = ['Bad\n', 'Bad\r\n'].map((suffix, index) => ({
      name: `invalid-${index}`,
      inputSchema: { type: 'object', properties: { region: { type: 'string', 'x-mcp-header': suffix } } },
    }));
    const handler = createMcpHandler(
      () => {
        const server = new Server({ name: 'header-peer', version: '1' }, { capabilities: { tools: {} } });
        server.setRequestHandler('tools/list', async () => ({ tools: [tool, ...invalidSuffixTools] }) as never);
        server.setRequestHandler('tools/call', async () => ({ content: [{ type: 'text', text: 'done' }] }));
        return server;
      },
      { legacy: 'reject' },
    );
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      requestInit: {
        headers: {
          'Mcp-Method': 'spoof',
          'Mcp-Name': 'spoof',
          'MCP-Protocol-Version': 'spoof',
          'Mcp-Param-Region': 'configured',
          'X-Configured': 'retained',
        },
      },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const body = JSON.parse(await request.clone().text());
        wire.push({ method: body.method, headers: request.headers, body });
        return handler.fetch(request);
      },
    });
    const client = new Client(
      { name: 'header-client', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    await client.connect(transport);
    const adapter = new ModernSdkClientAdapter(client, transport as unknown as AuthProviderTransport);
    try {
      await expect(list(adapter)).resolves.toHaveProperty('tools', [tool]);
      expect(wire.filter((entry) => entry.method === 'tools/call')).toHaveLength(0);
      await adapter.request({
        id: 'call' as never,
        method: 'tools/call',
        params: {
          name: 'act',
          arguments: { region: 'west', query: 'secret' },
          _meta: { headers: { Authorization: 'spoof', 'Mcp-Param-Region': 'spoof', 'X-Inbound': 'spoof' } },
        },
      });
      const sent = wire.filter((entry) => entry.method === 'tools/call');
      expect(sent).toHaveLength(1);
      const headers = sent[0].headers;
      expect(headers.get('mcp-param-region')).toBe('west');
      expect(headers.get('mcp-param-query')).toBeNull();
      expect(headers.get('authorization')).toBeNull();
      expect(headers.get('x-inbound')).toBeNull();
      expect(headers.get('mcp-method')).toBe('tools/call');
      expect(headers.get('mcp-name')).toBe('act');
      expect(headers.get('mcp-protocol-version')).toBe('2026-07-28');
      expect(headers.get('x-configured')).toBe('retained');
      expect(JSON.stringify(sent[0].body)).not.toContain('spoof');
    } finally {
      await adapter.close();
      await handler.close();
    }
  });

  it('keeps raw upstream name declarations separate between providers', async () => {
    const first = mockedHttpAdapter();
    const second = mockedHttpAdapter();
    first.request.mockResolvedValueOnce({ tools: [tool] } as never);
    second.request.mockResolvedValueOnce({
      tools: [{ ...tool, inputSchema: { properties: { region: { type: 'string', 'x-mcp-header': 'Place' } } } }],
    } as never);
    await Promise.all([list(first.adapter), list(second.adapter)]);
    await Promise.all([call(first.adapter), call(second.adapter)]);
    expect(first.request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: { 'Mcp-Param-Region': 'west' } });
    expect(second.request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: { 'Mcp-Param-Place': 'west' } });
  });

  it('retains declarations across explicit catalog pages without fetching extra pages', async () => {
    const { adapter, request } = mockedHttpAdapter();
    request.mockResolvedValueOnce({ tools: [tool], nextCursor: 'next' } as never);
    request.mockResolvedValueOnce({ tools: [{ ...tool, name: 'second' }] } as never);
    await list(adapter);
    await list(adapter, 'next');
    for (const name of ['act', 'second']) {
      await adapter.request({
        id: name as never,
        method: 'tools/call',
        params: { name, arguments: { region: 'west' } },
      });
      expect(request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: { 'Mcp-Param-Region': 'west' } });
    }
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('excludes invalid annotations while retaining healthy tools and opaque malformed siblings', async () => {
    const { adapter, request } = mockedHttpAdapter();
    const invalid = [
      { name: 'unsafe', inputSchema: { properties: { value: { type: 'string', 'x-mcp-header': 'Bad Name' } } } },
      {
        name: 'duplicate',
        inputSchema: {
          properties: { one: { type: 'string', 'x-mcp-header': 'X' }, two: { type: 'string', 'x-mcp-header': 'x' } },
        },
      },
    ];
    request.mockResolvedValueOnce({ tools: [tool, ...invalid, null, { name: 42 }], nextCursor: 'next' } as never);
    await expect(list(adapter)).resolves.toEqual({ tools: [tool, null, { name: 42 }], nextCursor: 'next' });
    for (const name of ['unsafe', 'duplicate']) {
      await adapter.request({
        id: name as never,
        method: 'tools/call',
        params: { name, arguments: { value: 'secret' } },
      });
      expect(request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: {} });
    }
  });

  it.each([
    ['contentSchema', 'https://json-schema.org/draft/2020-12/schema'],
    ['additionalItems', 'http://json-schema.org/draft-07/schema#'],
    ['dependencies', 'http://json-schema.org/draft-06/schema#'],
  ] as const)(
    'excludes annotations beneath schema-valued %s while retaining healthy tools',
    async (keyword, dialect) => {
      const { adapter, request } = mockedHttpAdapter();
      const annotation = { properties: { value: { type: 'string', 'x-mcp-header': 'Value' } } };
      const invalid = {
        name: 'unreachable',
        inputSchema: {
          type: 'object',
          $schema: dialect,
          [keyword]: keyword === 'dependencies' ? { trigger: annotation, other: ['trigger'] } : annotation,
        },
      };
      request.mockResolvedValueOnce({ tools: [invalid, tool] } as never);
      await expect(list(adapter)).resolves.toEqual({ tools: [tool] });
      await adapter.request({
        id: 'unreachable' as never,
        method: 'tools/call',
        params: { name: 'unreachable', arguments: { value: 'private' } },
      });
      expect(request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: {} });
      await call(adapter);
      expect(request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: { 'Mcp-Param-Region': 'west' } });
    },
  );

  it('excludes number annotations', async () => {
    const { adapter, request } = mockedHttpAdapter();
    request.mockResolvedValueOnce({
      tools: [
        { name: 'fractional', inputSchema: { properties: { value: { type: 'number', 'x-mcp-header': 'Value' } } } },
        { name: 'integer', inputSchema: { properties: { value: { type: 'integer', 'x-mcp-header': 'Value' } } } },
      ],
    } as never);
    await expect(list(adapter)).resolves.toMatchObject({ tools: [{ name: 'integer' }] });
  });

  it.each([Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])(
    'dispatches safe integer bound %s once',
    async (value) => {
      const { adapter, request } = mockedHttpAdapter();
      request.mockResolvedValueOnce({
        tools: [
          { name: 'integer', inputSchema: { properties: { value: { type: 'integer', 'x-mcp-header': 'Value' } } } },
        ],
      } as never);
      await list(adapter);
      await adapter.request({
        id: 'safe-integer' as never,
        method: 'tools/call',
        params: { name: 'integer', arguments: { value } },
      });
      expect(request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: { 'Mcp-Param-Value': String(value) } });
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it.each([3.14, Number.MIN_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe integer %s locally without dispatch or replay',
    async (value) => {
      const { adapter, request } = mockedHttpAdapter();
      request.mockResolvedValueOnce({
        tools: [
          { name: 'integer', inputSchema: { properties: { value: { type: 'integer', 'x-mcp-header': 'Value' } } } },
        ],
      } as never);
      await list(adapter);
      await expect(
        adapter.request({
          id: 'unsafe-integer' as never,
          method: 'tools/call',
          params: { name: 'integer', arguments: { value } },
        }),
      ).rejects.toMatchObject({
        kind: 'protocol',
        code: '-32602',
        message: 'Header integer parameter must be a safe integer',
      });
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it('does not replay a HEADER_MISMATCH or fetch a replacement catalog', async () => {
    const { adapter, request, client } = mockedHttpAdapter();
    const convenience = vi.spyOn(client, 'callTool');
    request.mockResolvedValueOnce({ tools: [tool] } as never);
    await list(adapter);
    request.mockRejectedValueOnce(new ProtocolError(-32020, 'header mismatch'));
    await expect(call(adapter)).rejects.toBeDefined();
    expect(request).toHaveBeenCalledTimes(2);
    expect(convenience).not.toHaveBeenCalled();
  });

  it.each(['new listing', 'list changed', 'transport replacement', 'close'] as const)(
    'does not restore an invalidated catalog from a late page after %s',
    async (change) => {
      const { adapter, request, notifications, client } = mockedHttpAdapter();
      let finish!: (value: never) => void;
      request.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)) as never);
      const pending = list(adapter);
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      if (change === 'new listing') {
        request.mockResolvedValueOnce({ tools: [] } as never);
        await list(adapter);
      }
      if (change === 'list changed') {
        const notification = notifications.mock.calls.find(([method]) => method === 'notifications/tools/list_changed');
        const callback = notification?.[1] as unknown as (message: { method: string }) => Promise<void>;
        await callback({ method: 'notifications/tools/list_changed' });
      }
      if (change === 'close') {
        vi.spyOn(client, 'close').mockResolvedValueOnce();
        await adapter.close();
      }
      if (change === 'transport replacement') {
        const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'));
        setModernSdkTransport(adapter, transport as unknown as AuthProviderTransport);
      }
      finish({ tools: [tool] } as never);
      await pending;
      if (change === 'close') await expect(call(adapter)).rejects.toBeDefined();
      else {
        await call(adapter);
        expect(request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: {} });
      }
    },
  );

  it('invalidates declarations when a registered catalog notification handler replaces the initial handler', async () => {
    const { adapter, request, notifications } = mockedHttpAdapter();
    request.mockResolvedValueOnce({ tools: [tool] } as never);
    await list(adapter);
    adapter.registerNotificationHandler({ shape: { method: { value: 'notifications/tools/list_changed' } } }, vi.fn());
    const callback = notifications.mock.calls.at(-1)?.[1] as unknown as (message: { method: string }) => Promise<void>;
    await callback({ method: 'notifications/tools/list_changed' });
    await call(adapter);
    expect(request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: {} });
  });

  it('invalidates declarations when the owned catalog subscription is lost', async () => {
    const { adapter, client, transport, request } = mockedHttpAdapter();
    vi.spyOn(client, 'getServerCapabilities').mockReturnValue({ tools: { listChanged: true } });
    let finish!: (cause: 'remote') => void;
    const closed = new Promise<'remote'>((resolve) => (finish = resolve));
    vi.spyOn(client, 'listen').mockImplementation(async (filter) => {
      await transport.send({
        jsonrpc: '2.0',
        id: 'catalog',
        method: 'subscriptions/listen',
        params: { notifications: filter },
      } as never);
      return { honoredFilter: filter, closed, close: async () => {} };
    });
    await adapter.start();
    request.mockResolvedValueOnce({ tools: [tool] } as never);
    await list(adapter);
    finish('remote');
    await expect(adapter.nextEvent()).resolves.toMatchObject({
      notification: { method: 'notifications/1mcp/subscription_lost', params: { catalog: true } },
    });
    await call(adapter);
    expect(request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: {} });
  });

  it('invalidates every observing map before an installed catalog-loss callback runs', async () => {
    const { adapter, client, transport } = mockedHttpAdapter();
    const unrelated = mockedHttpAdapter();
    vi.spyOn(client, 'getServerCapabilities').mockReturnValue({ tools: { listChanged: true } });
    let finish!: (cause: 'remote') => void;
    const closed = new Promise<'remote'>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(client, 'listen').mockImplementation(async (filter) => {
      await transport.send({
        jsonrpc: '2.0',
        id: 'catalog',
        method: 'subscriptions/listen',
        params: { notifications: filter },
      } as never);
      return { honoredFilter: filter, closed, close: async () => {} };
    });
    const source = { name: 'source', adapter, status: ClientStatus.Connected, tags: [], requiresOAuth: false };
    const maps: OutboundConnections[] = [new Map([['source', source]]), new Map([['source', source]])];
    const other: OutboundConnections = new Map([
      [
        'other',
        { name: 'other', adapter: unrelated.adapter, status: ClientStatus.Connected, tags: [], requiresOAuth: false },
      ],
    ]);
    for (const map of maps) registerCapabilityPaginationNotifications(map, source);
    registerCapabilityPaginationNotifications(other, other.get('other')!);
    const detached: OutboundConnections = new Map([['source', source]]);
    registerCapabilityPaginationNotifications(detached, source);
    const kinds = ['tools', 'resources', 'resourceTemplates', 'prompts'] as const;
    unregisterCapabilityPaginationConnections(detached);
    const detachedBefore = kinds.map((kind) => getCapabilityPaginationGeneration(detached, kind));
    const before = maps.map((map) => kinds.map((kind) => getCapabilityPaginationGeneration(map, kind)));
    const otherBefore = kinds.map((kind) => getCapabilityPaginationGeneration(other, kind));
    let invalidatedInCallback = false;
    const checked = vi.fn(() => {
      invalidatedInCallback =
        maps.every((map, index) =>
          kinds.every((kind, kindIndex) => getCapabilityPaginationGeneration(map, kind) !== before[index][kindIndex]),
        ) &&
        kinds.every((kind, index) => getCapabilityPaginationGeneration(other, kind) === otherBefore[index]) &&
        kinds.every((kind, index) => getCapabilityPaginationGeneration(detached, kind) === detachedBefore[index]);
    });
    adapter.registerNotificationHandler(
      { shape: { method: { value: 'notifications/1mcp/subscription_lost' } } },
      checked,
    );
    try {
      await adapter.start();
      // This private loss notice is never accepted from a public subscription frame.
      transport.onmessage?.({
        jsonrpc: '2.0',
        method: 'notifications/1mcp/subscription_lost',
        params: { catalog: true, _meta: { 'io.modelcontextprotocol/subscriptionId': 'catalog' } },
      } as never);
      expect(checked).not.toHaveBeenCalled();
      for (const [index, map] of maps.entries())
        for (const [kindIndex, kind] of kinds.entries())
          expect(getCapabilityPaginationGeneration(map, kind)).toBe(before[index][kindIndex]);
      finish('remote');
      await vi.waitFor(() => expect(checked).toHaveBeenCalledOnce());
      expect(invalidatedInCallback).toBe(true);
      // Check the captured synchronous verdict because owner callback errors are swallowed.
      for (const [index, map] of maps.entries())
        for (const [kindIndex, kind] of kinds.entries())
          expect(getCapabilityPaginationGeneration(map, kind)).not.toBe(before[index][kindIndex]);
    } finally {
      for (const map of [...maps, other]) unregisterCapabilityPaginationConnections(map);
      await adapter.close();
      await unrelated.adapter.close();
    }
  });

  it('does not invalidate catalog epochs when only a resource URI subscription is lost', async () => {
    const { adapter, client, transport } = mockedHttpAdapter();
    vi.spyOn(client, 'getServerCapabilities').mockReturnValue({
      tools: { listChanged: true },
      resources: { subscribe: true },
    });
    const endings: Array<(cause: 'remote') => void> = [];
    vi.spyOn(client, 'listen').mockImplementation(async (filter) => {
      const id = `subscription-${endings.length}`;
      const closed = new Promise<'remote'>((resolve) => {
        endings.push(resolve);
      });
      await transport.send({
        jsonrpc: '2.0',
        id,
        method: 'subscriptions/listen',
        params: { notifications: filter },
      } as never);
      return { honoredFilter: filter, closed, close: async () => {} };
    });
    const source = { name: 'source', adapter, status: ClientStatus.Connected, tags: [], requiresOAuth: false };
    const map: OutboundConnections = new Map([['source', source]]);
    registerCapabilityPaginationNotifications(map, source);
    const kinds = ['tools', 'resources', 'resourceTemplates', 'prompts'] as const;
    const before = kinds.map((kind) => getCapabilityPaginationGeneration(map, kind));
    const lost = vi.fn();
    adapter.registerNotificationHandler({ shape: { method: { value: 'notifications/1mcp/subscription_lost' } } }, lost);
    try {
      await adapter.start();
      await adapter.request({
        id: 'resource-subscription' as never,
        method: 'resources/subscribe',
        params: { uri: 'urn:owned:resource' },
      });
      endings[1]('remote');
      await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce());
      expect(lost).toHaveBeenCalledWith({
        method: 'notifications/1mcp/subscription_lost',
        params: { uri: 'urn:owned:resource' },
      });
      for (const [index, kind] of kinds.entries())
        expect(getCapabilityPaginationGeneration(map, kind)).toBe(before[index]);
    } finally {
      unregisterCapabilityPaginationConnections(map);
      await adapter.close();
    }
  });

  it('caps retained declarations across individually bounded catalog pages', async () => {
    const { adapter, request } = mockedHttpAdapter();
    for (let index = 0; index < 4; index++) {
      request.mockResolvedValueOnce({
        tools: [
          { ...tool, name: `tool-${index}`, inputSchema: { ...tool.inputSchema, description: 'x'.repeat(300_000) } },
        ],
        nextCursor: String(index + 1),
      } as never);
      const pending = list(adapter, index === 0 ? undefined : String(index));
      if (index === 3) await expect(pending).rejects.toBeDefined();
      else await expect(pending).resolves.toHaveProperty('tools');
    }
    expect(request).toHaveBeenCalledTimes(4);
  });

  it.each(['new listing', 'list changed', 'transport replacement', 'close'] as const)(
    'does not trust an old cursor continuation started after %s',
    async (change) => {
      const { adapter, request, notifications, client } = mockedHttpAdapter();
      request.mockResolvedValueOnce({ tools: [], nextCursor: 'old' } as never);
      await list(adapter);
      if (change === 'new listing') {
        request.mockResolvedValueOnce({ tools: [] } as never);
        await list(adapter);
      }
      if (change === 'list changed') {
        const notification = notifications.mock.calls.find(([method]) => method === 'notifications/tools/list_changed');
        const callback = notification?.[1] as unknown as (message: { method: string }) => Promise<void>;
        await callback({ method: 'notifications/tools/list_changed' });
      }
      if (change === 'transport replacement') {
        const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'));
        setModernSdkTransport(adapter, transport as unknown as AuthProviderTransport);
      }
      if (change === 'close') {
        vi.spyOn(client, 'close').mockResolvedValueOnce();
        await adapter.close();
        const count = request.mock.calls.length;
        await expect(list(adapter, 'old')).rejects.toBeDefined();
        expect(request).toHaveBeenCalledTimes(count);
        return;
      }
      request.mockResolvedValueOnce({ tools: [tool], nextCursor: 'untrusted-child' } as never);
      await list(adapter, 'old');
      await call(adapter);
      expect(request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: {} });
      request.mockResolvedValueOnce({ tools: [tool] } as never);
      await list(adapter, 'untrusted-child');
      await call(adapter);
      expect(request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: {} });
    },
  );

  it('does not populate declarations from an unknown continuation cursor', async () => {
    const { adapter, request } = mockedHttpAdapter();
    request.mockResolvedValueOnce({ tools: [tool] } as never);
    await list(adapter, 'never-issued');
    await call(adapter);
    expect(request.mock.calls.at(-1)?.at(-1)).toMatchObject({ headers: {} });
  });

  it('charges issued continuation cursors to the retained catalog JSON budget', async () => {
    const { adapter, request } = mockedHttpAdapter();
    let cursor: string | undefined;
    for (let index = 0; index < 3; index++) {
      const nextCursor = String(index).repeat(400_000);
      request.mockResolvedValueOnce({ tools: [], nextCursor } as never);
      const pending = list(adapter, cursor);
      if (index === 2) await expect(pending).rejects.toBeDefined();
      else await expect(pending).resolves.toHaveProperty('nextCursor', nextCursor);
      cursor = nextCursor;
    }
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('retains derived headers on MRTR continuations without validating unfinished output as complete', async () => {
    const { adapter, request } = mockedHttpAdapter();
    request.mockResolvedValueOnce({
      tools: [{ ...tool, outputSchema: { type: 'object', required: ['done'] } }],
    } as never);
    await list(adapter);
    request.mockResolvedValueOnce({
      resultType: 'input_required',
      requestState: 'private-state',
      inputRequests: { roots: { method: 'roots/list' } },
    } as never);
    request.mockResolvedValueOnce({ content: [] } as never);
    adapter.registerRequestHandler({ shape: { method: { value: 'roots/list' } } }, async () => ({ roots: [] }));
    await expect(
      withLegacyInteractionLease(adapter, () => call(adapter), undefined, undefined, { roots: {} }),
    ).resolves.toEqual({ content: [] });
    expect(request).toHaveBeenCalledTimes(3);
    for (const sent of request.mock.calls.slice(1)) {
      expect(sent.at(-1)).toMatchObject({ headers: { 'Mcp-Param-Region': 'west' }, allowInputRequired: true });
    }
    expect(request.mock.calls[2][0]).toMatchObject({
      params: { requestState: 'private-state', inputResponses: { roots: { roots: [] } } },
    });
  });

  it('keeps stdio catalogs and legacy HTTP requests outside modern HTTP mirroring', async () => {
    const { client, adapter, request } = mockedHttpAdapter();
    const stdio = new ModernSdkClientAdapter(client, {} as AuthProviderTransport);
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('legacy');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2025-11-25');
    // Era is pinned by construction, so use a new adapter after changing the SDK verdict.
    const legacy = new ModernSdkClientAdapter(
      client,
      new StreamableHTTPClientTransport(new URL('http://localhost/mcp')) as unknown as AuthProviderTransport,
    );
    for (const connection of [legacy, stdio]) {
      request.mockResolvedValueOnce({ tools: [tool] } as never);
      await list(connection);
      await call(connection);
      expect(request.mock.calls.at(-1)?.at(-1)).not.toHaveProperty('headers');
    }
    expect(adapter.protocol.era).toBe('modern');
  });
});
