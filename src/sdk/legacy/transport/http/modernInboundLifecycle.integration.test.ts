import type { AddressInfo } from 'node:net';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { ClientStatus } from '@src/core/types/index.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import { ConnectionManager } from '@src/sdk/legacy/server/runtime/connectionManager.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  LoggingMessageNotificationSchema,
} from '@src/sdk/legacy/types.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';

import express from 'express';
import { expect, it, vi } from 'vitest';

it('does not dispatch a call cancelled while the bridge is connecting', async () => {
  // Admit a real selected, annotated tool before exercising the delayed bridge.
  // An empty catalog would correctly reject before the cancellation boundary.
  const backend = new Server({ name: 'cancel-peer', version: '1' }, { capabilities: { tools: {} } });
  const listed = vi.fn(async () => ({
    tools: [
      {
        name: 'echo',
        inputSchema: {
          type: 'object' as const,
          properties: { region: { type: 'string', 'x-mcp-header': 'Region' } },
          required: ['region'],
        },
      },
    ],
  }));
  const backendCall = vi.fn(async () => ({ content: [] }));
  backend.setRequestHandler(ListToolsRequestSchema, listed);
  backend.setRequestHandler(CallToolRequestSchema, backendCall);
  const client = new Client({ name: 'cancel-gateway', version: '1' }, { capabilities: {} });
  const [clientTransport, backendTransport] = InMemoryTransport.createLinkedPair();
  await backend.connect(backendTransport);
  await client.connect(clientTransport);
  const connection = createLegacyOutboundConnection({
    name: 'cancel-peer',
    client,
    transport: clientTransport,
    status: ClientStatus.Connected,
    capabilities: { tools: {} },
  });
  const connections = new Map([['cancel-peer', connection]]);
  const manager = ServerManager.getOrCreateInstance(
    { name: 'cancel-gateway', version: '1' },
    { capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} } },
    connections,
    {},
  );
  let release!: () => void;
  let sawClose!: () => void;
  const closed = new Promise<void>((resolve) => {
    sawClose = resolve;
  });
  const request = vi.fn(async () => ({ content: [] }));
  const close = vi.fn(async () => undefined);
  const createBridge = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      targetConnectionId: 'delayed',
      outbound: {
        role: 'outbound' as const,
        pin: { era: 'legacy' as const, revision: '2025-11-25' as const },
        request,
        cancel: vi.fn(async () => undefined),
        close,
      },
      close,
    };
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.socket.once('close', sawClose);
    next();
  });
  setupModernHttpRoutes(app as never, manager as never, [], createBridge, {
    allowsHost: () => true,
    allowsOrigin: () => true,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const controller = new AbortController();
  let unexpectedResponse: { status: number; contentType: string | null; text: string } | undefined;
  const pending = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': 'tools/call',
      'Mcp-Name': 'cancel-peer_1mcp_echo',
      'Mcp-Param-Region': 'west',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'cancel-peer_1mcp_echo',
        arguments: { region: 'west' },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
        },
      },
    }),
  })
    .then(async (response) => {
      unexpectedResponse = {
        status: response.status,
        contentType: response.headers.get('content-type'),
        text: await response.text(),
      };
    })
    .catch(() => {});
  try {
    await vi.waitFor(() => expect(createBridge, JSON.stringify(unexpectedResponse)).toHaveBeenCalledOnce(), {
      timeout: 3000,
    });
    expect(listed).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(backendCall).not.toHaveBeenCalled();
    controller.abort();
    await pending;
    await closed;
    release();
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(request).not.toHaveBeenCalled();
    expect(backendCall).not.toHaveBeenCalled();
  } finally {
    release?.();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await ServerManager.resetInstance();
    await connection.adapter.close();
    await backend.close();
  }
});

it('retains legacy notification delivery after a modern bridge closes', async () => {
  const backend = new Server({ name: 'backend', version: '1' }, { capabilities: { logging: {} } });
  const backendClient = new Client({ name: 'upstream', version: '1' }, { capabilities: {} });
  const [upClientTransport, upServerTransport] = InMemoryTransport.createLinkedPair();
  await backend.connect(upServerTransport);
  await backendClient.connect(upClientTransport);
  const connection = createLegacyOutboundConnection({
    name: 'backend',
    client: backendClient,
    transport: upClientTransport,
    status: ClientStatus.Connected,
    capabilities: { logging: {} },
  });
  const manager = new ConnectionManager(
    { name: 'aggregate', version: '1' },
    { capabilities: { logging: {}, tools: {}, resources: {}, prompts: {}, completions: {} } },
    new Map([['backend', connection]]),
  );
  const existing = new Client({ name: 'existing', version: '1' }, { capabilities: {} });
  const [inClient, inServer] = InMemoryTransport.createLinkedPair();
  const received = vi.fn();
  const registerNotification = vi.spyOn(backendClient, 'setNotificationHandler');
  const registerRequest = vi.spyOn(backendClient, 'setRequestHandler');
  existing.setNotificationHandler(LoggingMessageNotificationSchema, received);
  try {
    await manager.connectTransport(inServer, 'existing', {});
    await existing.connect(inClient);
    await backend.notification({ method: 'notifications/message', params: { level: 'info', data: 'before' } });
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1));
    const second = new Client({ name: 'second', version: '1' }, { capabilities: {} });
    const [secondClient, secondServer] = InMemoryTransport.createLinkedPair();
    const secondReceived = vi.fn();
    second.setNotificationHandler(LoggingMessageNotificationSchema, secondReceived);
    try {
      await manager.connectTransport(secondServer, 'second', {});
      await second.connect(secondClient);
      await backend.notification({ method: 'notifications/message', params: { level: 'info', data: 'ambiguous' } });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(received).toHaveBeenCalledTimes(1);
      expect(secondReceived).not.toHaveBeenCalled();
    } finally {
      await manager.disconnectTransport('second', true);
      await second.close();
    }
    registerNotification.mockClear();
    registerRequest.mockClear();
    const bridge = await createModernInboundLegacyBridge(manager as never, {});
    expect(registerNotification).not.toHaveBeenCalled();
    expect(registerRequest).not.toHaveBeenCalled();
    await bridge.close();
    await backend.notification({ method: 'notifications/message', params: { level: 'info', data: 'after' } });
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2), { timeout: 300 });
  } finally {
    await manager.disconnectTransport('existing', true);
    await existing.close();
    await connection.adapter.close();
    await backend.close();
  }
});
