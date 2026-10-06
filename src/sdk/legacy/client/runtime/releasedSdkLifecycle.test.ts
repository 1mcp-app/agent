import { type BaseContext, Client, InMemoryTransport, Protocol } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createMcpHandler, McpServer, readRequestBody } from '@modelcontextprotocol/server';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

class WireProtocol extends Protocol<BaseContext> {
  protected buildContext(context: BaseContext): BaseContext {
    return context;
  }
  protected assertCapabilityForMethod(): void {}
  protected assertNotificationCapability(): void {}
  protected assertRequestHandlerCapability(): void {}
}

describe('released SDK lifecycle and parser contracts', () => {
  it('cancels the first request with id zero without cancelling another request', async () => {
    const [local, remote] = InMemoryTransport.createLinkedPair();
    const sender = new WireProtocol();
    const receiver = new WireProtocol();
    const signals: AbortSignal[] = [];
    receiver.setRequestHandler('ping', async (_request, context) => {
      signals.push(context.mcpReq.signal);
      await new Promise<void>((resolve) =>
        context.mcpReq.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return {};
    });
    const send = vi.spyOn(local, 'send');
    await receiver.connect(remote);
    await sender.connect(local);
    const controller = new AbortController();
    const first = sender.request({ method: 'ping' }, { signal: controller.signal }).catch((error) => error);
    const secondController = new AbortController();
    const second = sender.request({ method: 'ping' }, { signal: secondController.signal }).catch((error) => error);
    try {
      await vi.waitFor(() => expect(signals).toHaveLength(2));
      expect(send.mock.calls[0][0]).toMatchObject({ id: 0 });
      controller.abort();
      await first;
      await vi.waitFor(() => expect(signals[0].aborted).toBe(true));
      expect(signals[1].aborted).toBe(false);
      expect(
        send.mock.calls.some(
          ([frame]) => 'method' in frame && frame.method === 'notifications/cancelled' && frame.params?.requestId === 0,
        ),
      ).toBe(true);
    } finally {
      secondController.abort();
      await second;
      await sender.close();
      await receiver.close();
    }
  });

  it('suppresses forbidden initialize cancellation', async () => {
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await remote.start();
    const send = vi.spyOn(local, 'send');
    const controller = new AbortController();
    const client = new Client({ name: 'initializing', version: '1' });
    const connecting = client.connect(local, { signal: controller.signal }).catch((error) => error);
    try {
      await vi.waitFor(() => expect(send).toHaveBeenCalled());
      expect(send.mock.calls[0][0]).toMatchObject({ id: 0, method: 'initialize' });
      controller.abort();
      await connecting;
      expect(send.mock.calls.some(([frame]) => 'method' in frame && frame.method === 'notifications/cancelled')).toBe(
        false,
      );
    } finally {
      await client.close();
      await remote.close();
    }
  });

  it('rejects declared and streamed bodies beyond the SDK byte bound', async () => {
    const declared = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-length': '9' },
      body: '123456789',
    });
    const streamed = new Request('http://localhost/mcp', { method: 'POST', body: '123456789' });
    for (const request of [declared, streamed]) {
      expect(await readRequestBody(request, 8)).toMatchObject({ tooLarge: true });
    }
    for (const headers of [{ 'content-length': '8' }, undefined]) {
      const result = await readRequestBody(
        new Request('http://localhost/mcp', { method: 'POST', headers, body: '12345678' }),
        8,
      );
      expect(result).toMatchObject({ text: '12345678' });
    }
  });

  it('applies optional prompt defaults when arguments are omitted', async () => {
    const handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: 'prompts', version: '1' });
        server.registerPrompt('greet', { argsSchema: z.object({ name: z.string().default('world') }) }, ({ name }) => ({
          messages: [{ role: 'user', content: { type: 'text', text: name } }],
        }));
        return server;
      },
      { legacy: 'reject' },
    );
    try {
      const response = await handler.fetch(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'prompts/get',
            'mcp-name': 'greet',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 0,
            method: 'prompts/get',
            params: {
              name: 'greet',
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ result: { messages: [{ content: { text: 'world' } }] } });
    } finally {
      await handler.close();
    }
  });

  it('closes a real stdio subprocess on EOF and preserves supported inherited environment', async () => {
    const environment = getDefaultEnvironment();
    if (process.platform === 'win32') {
      expect(environment.SYSTEMROOT).toBeTruthy();
      expect(environment.SYSTEMDRIVE).toBeTruthy();
      expect(environment.COMSPEC).toBeTruthy();
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      stderr: 'pipe',
      args: [
        '--input-type=module',
        '-e',
        `import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
const transport = new StdioServerTransport();
transport.onclose = () => process.stderr.write('EOF-CLOSED');
await transport.start();
process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { platform: process.platform, root: process.env.SYSTEMROOT ?? '' } }) + '\\n');`,
      ],
    });
    let diagnostics = '';
    transport.stderr!.on('data', (chunk) => {
      diagnostics += chunk.toString();
    });
    const message = vi.fn();
    const close = vi.fn();
    transport.onmessage = message;
    transport.onclose = close;
    try {
      await transport.start();
      await vi.waitFor(() => expect(message).toHaveBeenCalledOnce());
      if (process.platform === 'win32') expect(message.mock.calls[0][0].result.root).toBe(environment.SYSTEMROOT);
      await transport.close();
      expect(close).toHaveBeenCalledOnce();
      expect(diagnostics).toContain('EOF-CLOSED');
      expect(transport.pid).toBeNull();
    } finally {
      await transport.close();
    }
  });
});
