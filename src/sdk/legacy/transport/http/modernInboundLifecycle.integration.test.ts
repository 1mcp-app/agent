import type { AddressInfo } from 'node:net';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { ClientStatus } from '@src/core/types/index.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import { ConnectionManager } from '@src/sdk/legacy/server/runtime/connectionManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import { LoggingMessageNotificationSchema } from '@src/sdk/legacy/types.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';

import express from 'express';
import { expect, it, vi } from 'vitest';

it('does not dispatch a call cancelled while the bridge is connecting', async () => {
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
  setupModernHttpRoutes(app as never, {} as never, [], createBridge, {
    allowsHost: () => true,
    allowsOrigin: () => true,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const controller = new AbortController();
  const pending = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': 'tools/call',
      'Mcp-Name': 'echo',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'echo',
        arguments: {},
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
        },
      },
    }),
  }).catch(() => {});
  try {
    await vi.waitFor(() => expect(createBridge).toHaveBeenCalledOnce());
    controller.abort();
    await pending;
    await closed;
    release();
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(request).not.toHaveBeenCalled();
  } finally {
    release?.();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
