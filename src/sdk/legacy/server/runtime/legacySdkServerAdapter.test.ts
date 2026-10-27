import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { LegacyConnectionId } from '@src/sdk/contracts/legacySdkAdapter.js';
import { OneMcpProtocolError } from '@src/sdk/contracts/oneMcpProtocolError.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import { SSEServerTransport } from '@src/sdk/legacy/server/sse.js';
import { StdioServerTransport } from '@src/sdk/legacy/server/stdio.js';
import { StreamableHTTPServerTransport } from '@src/sdk/legacy/server/streamableHttp.js';
import type { Transport } from '@src/sdk/legacy/shared/transport.js';
import {
  CallToolRequestSchema,
  ListRootsRequestSchema,
  LoggingMessageNotificationSchema,
  McpError,
} from '@src/sdk/legacy/types.js';

import { describe, expect, it, vi } from 'vitest';

import {
  getLegacyServerHandle,
  getLegacyServerTransportHandle,
  LegacySdkServerAdapter,
} from './legacySdkServerAdapter.js';

const facts = vi.hoisted(() => ({ begin: vi.fn((..._args: unknown[]) => ({ finish: vi.fn() })) }));
vi.mock('@src/productTelemetry/index.js', () => ({ beginProductOperation: facts.begin }));

function createAdapter() {
  const transport = {
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  } as unknown as Transport;
  const server = {
    connect: vi.fn(async () => {
      (server as { transport?: Transport }).transport = transport;
    }),
    notification: vi.fn().mockResolvedValue(undefined),
    transport: undefined as Transport | undefined,
  } as unknown as Server;
  const adapter = new LegacySdkServerAdapter('session-1' as LegacyConnectionId, server, transport);
  return { adapter, server, transport };
}

describe('LegacySdkServerAdapter', () => {
  it('preserves terminal send failure and records it once', async () => {
    facts.begin.mockClear();
    const { adapter, transport } = createAdapter();
    Object.setPrototypeOf(transport, StdioServerTransport.prototype);
    const failure = new Error('send unavailable');
    vi.mocked(transport.send).mockRejectedValue(failure);
    await adapter.start();
    transport.onmessage?.({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await expect(transport.send({ jsonrpc: '2.0', id: 1, result: { tools: [] } })).rejects.toBe(failure);
    transport.onclose?.();
    expect(facts.begin.mock.calls).toEqual([['tools_list', 'stdio', 'other']]);
    expect(facts.begin.mock.results[0].value.finish.mock.calls).toEqual([['failure']]);
  });

  it.each([
    [SSEServerTransport.prototype, 'sse'],
    [StreamableHTTPServerTransport.prototype, 'http'],
  ] as const)('retains transport attribution at the runtime adapter: %s', async (prototype, kind) => {
    facts.begin.mockClear();
    const { adapter, transport } = createAdapter();
    Object.setPrototypeOf(transport, prototype);
    Object.defineProperties(transport, {
      onmessage: { value: undefined, writable: true },
      onclose: { value: undefined, writable: true },
    });
    await adapter.start();
    transport.onmessage?.({ jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: 'private-uri' } });
    await transport.send({ jsonrpc: '2.0', id: 9, error: { code: -32602, message: 'private-error' } });
    transport.onclose?.();
    expect(facts.begin.mock.calls).toEqual([['resources_read', kind, 'other']]);
    expect(facts.begin.mock.results[0].value.finish.mock.calls).toEqual([['failure']]);
  });
  it('does not count private bridge/REST adapter requests or notifications', async () => {
    facts.begin.mockClear();
    const { server, transport } = createAdapter();
    Object.setPrototypeOf(transport, StdioServerTransport.prototype);
    const adapter = new LegacySdkServerAdapter('bridge' as LegacyConnectionId, server, transport, true);
    await adapter.start();
    transport.onmessage?.({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await transport.send({ jsonrpc: '2.0', id: 1, result: {} });
    transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized' });
    transport.onclose?.();
    expect(facts.begin).not.toHaveBeenCalled();
  });

  it('owns one fact per admitted initialize/call, cancellation and cleanup', async () => {
    facts.begin.mockClear();
    const { adapter, transport } = createAdapter();
    Object.setPrototypeOf(transport, StdioServerTransport.prototype);
    await adapter.start();
    transport.onmessage?.({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'codex', version: 'secret' } },
    });
    await transport.send({ jsonrpc: '2.0', id: 1, result: {} });
    await transport.send({ jsonrpc: '2.0', id: 1, result: {} });
    transport.onmessage?.({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'private-tool' } });
    transport.onmessage?.({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'duplicate' } });
    transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } });
    await transport.send({ jsonrpc: '2.0', id: 2, result: { content: [] } });
    transport.onclose?.();
    expect(facts.begin.mock.calls).toEqual([
      ['initialize', 'stdio', 'codex'],
      ['tools_call', 'stdio', 'other'],
    ]);
    expect(facts.begin.mock.results[0].value.finish.mock.calls).toEqual([['success']]);
    expect(facts.begin.mock.results[1].value.finish.mock.calls).toEqual([['failure']]);
  });

  it('flushes an admitted tool result before retirement closes transport and rejects new calls', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new Server({ name: 'server', version: '1' }, { capabilities: { tools: {} } });
    const client = new Client({ name: 'client', version: '1' }, { capabilities: { roots: {} } });
    let finish!: () => void;
    let signal: AbortSignal | undefined;
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    client.setRequestHandler(ListRootsRequestSchema, async () => {
      await blocked;
      return { roots: [] };
    });
    server.setRequestHandler(CallToolRequestSchema, async (_request, extra) => {
      signal = extra.signal;
      await server.listRoots();
      return { content: [{ type: 'text', text: 'completed' }] };
    });
    const adapter = new LegacySdkServerAdapter('draining' as LegacyConnectionId, server, serverTransport);
    await adapter.start();
    await client.connect(clientTransport);
    const result = client.callTool({ name: 'pending' });
    await vi.waitFor(() => expect(signal).toBeDefined());
    const draining = adapter.closeWhenIdle();
    expect(signal?.aborted).toBe(false);
    await expect(client.callTool({ name: 'new' })).rejects.toThrow('reconnect required');
    expect(signal?.aborted).toBe(false);
    finish();
    await expect(result).resolves.toMatchObject({ content: [{ text: 'completed' }] });
    await draining;
    expect(adapter.state).toBe('stopped');
    await client.close();
  });

  it('bounds admitted interactions and releases cancelled requests during retirement', async () => {
    const { adapter, transport } = createAdapter();
    const send = transport.send;
    await adapter.start();
    for (let id = 0; id < 129; id++)
      transport.onmessage?.({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'pending' } });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ id: 128, error: expect.objectContaining({ code: -32000 }) }),
      { relatedRequestId: 128 },
    );
    const draining = adapter.closeWhenIdle();
    expect(transport.close).not.toHaveBeenCalled();
    for (let requestId = 0; requestId < 128; requestId++)
      transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId } });
    await draining;
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('resolves retirement after an external transport close', async () => {
    const { adapter, transport } = createAdapter();
    await adapter.start();
    transport.onclose?.();
    await expect(adapter.closeWhenIdle()).resolves.toBeUndefined();
    expect(transport.close).not.toHaveBeenCalled();
  });

  it('rejects duplicate IDs without releasing the original admitted interaction', async () => {
    const { adapter, transport } = createAdapter();
    const send = transport.send;
    await adapter.start();
    transport.onmessage?.({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'first' } });
    transport.onmessage?.({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'duplicate' } });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, error: expect.objectContaining({ message: 'Duplicate active request ID' }) }),
      { relatedRequestId: 1 },
    );
    let drained = false;
    const retirement = adapter.closeWhenIdle().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(transport.close).not.toHaveBeenCalled();
    await transport.send({ jsonrpc: '2.0', id: 1, result: { content: [] } });
    await retirement;
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('keeps live SDK handles off the adapter surface', () => {
    const { adapter, server } = createAdapter();

    expect(adapter).not.toHaveProperty('server');
    expect(adapter).not.toHaveProperty('transport');
    expect(getLegacyServerHandle(adapter)).toBe(server);
    expect(getLegacyServerTransportHandle(adapter)).toBeUndefined();
  });

  it('owns start, notification, and close lifecycle operations', async () => {
    const { adapter, server, transport } = createAdapter();
    const params = { nested: { value: 'original' } };

    await adapter.start();
    await adapter.notify({ method: 'notifications/tools/list_changed', params });
    params.nested.value = 'changed';
    await adapter.close();

    expect(adapter.state).toBe('stopped');
    expect(getLegacyServerTransportHandle(adapter)).toBe(transport);
    expect(server.notification).toHaveBeenCalledWith({
      method: 'notifications/tools/list_changed',
      params: { nested: { value: 'original' } },
    });
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('strips only reserved baggage from raw SDK notifications at the transport boundary', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new Server({ name: 'server', version: '1' }, { capabilities: { logging: {} } });
    const client = new Client({ name: 'client', version: '1' });
    const delivered = vi.fn();
    client.setNotificationHandler(LoggingMessageNotificationSchema, delivered);
    const adapter = new LegacySdkServerAdapter('notification' as LegacyConnectionId, server, serverTransport);
    const params = {
      level: 'info' as const,
      data: { baggage: 'business' },
      _meta: { baggage: 'private-carrier', other: 'preserved', traceparent: 'unchanged' },
    };
    try {
      await adapter.start();
      await client.connect(clientTransport);
      await server.notification({ method: 'notifications/message', params });
      await vi.waitFor(() => expect(delivered).toHaveBeenCalledOnce());
      expect(delivered.mock.calls[0][0]).toEqual({
        method: 'notifications/message',
        params: {
          level: 'info',
          data: { baggage: 'business' },
          _meta: { other: 'preserved', traceparent: 'unchanged' },
        },
      });
      expect(params._meta.baggage).toBe('private-carrier');
    } finally {
      await client.close();
      await adapter.close();
    }
  });

  it('rejects notification params that are not JSON objects', async () => {
    const { adapter } = createAdapter();

    await expect(adapter.notify({ method: 'notifications/test', params: null })).rejects.toThrow(
      'Legacy server notification params must be a JSON object',
    );
  });

  it.each(['start', 'notify', 'close'] as const)('converts foreign %s failures', async (operation) => {
    const { adapter, server, transport } = createAdapter();
    const foreign = new McpError(-32_603, `${operation} failed`, { operation });
    if (operation === 'start') vi.mocked(server.connect).mockRejectedValueOnce(foreign);
    if (operation === 'notify') vi.mocked(server.notification).mockRejectedValueOnce(foreign);
    if (operation === 'close') vi.mocked(transport.close).mockRejectedValueOnce(foreign);

    const pending =
      operation === 'start'
        ? adapter.start()
        : operation === 'notify'
          ? adapter.notify({ method: 'notifications/test' })
          : adapter.close();

    await expect(pending).rejects.toMatchObject({
      code: -32_603,
      data: { operation },
    });
    await expect(pending).rejects.toBeInstanceOf(OneMcpProtocolError);
    await expect(pending).rejects.not.toBe(foreign);
  });
});
