import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';

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
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2025-11-25',
            'io.modelcontextprotocol/clientInfo': { name: 'inbound', version: '1' },
          },
        },
      });
      expect(notify).toHaveBeenCalledWith({ method, params: { progressToken: 'one', progress: 1 } });
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
