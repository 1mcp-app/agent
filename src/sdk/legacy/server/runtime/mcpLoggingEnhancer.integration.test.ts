import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Server } from '@src/sdk/legacy/server/index.js';
import { StreamableHTTPServerTransport } from '@src/sdk/legacy/server/streamableHttp.js';
import { CallToolRequestSchema, type JSONRPCMessage, JSONRPCMessageSchema } from '@src/sdk/legacy/types.js';

import express from 'express';
import { expect, it, vi } from 'vitest';

import { enhanceServerWithLogging } from './mcpLoggingEnhancer.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function collectFrames(response: Response, frames: JSONRPCMessage[], signal?: AbortSignal): Promise<void> {
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
      let end;
      while ((end = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) frames.push(JSONRPCMessageSchema.parse(JSON.parse(data)));
      }
    }
    expect(pending.trim()).toBe('');
  } catch (error) {
    if (!signal?.aborted) throw error;
  } finally {
    reader.releaseLock();
  }
}

it('delivers owned progress on the legacy HTTP POST before its result without leaking to the concurrent GET stream', async () => {
  const backend = new Server(
    { name: 'owned-progress-http', version: '1' },
    { capabilities: { tools: {}, logging: {} } },
  );
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => 'owned-progress-session' });
  const progressSent = deferred();
  const finish = deferred();
  let executions = 0;
  enhanceServerWithLogging(backend);
  backend.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    executions++;
    for (const progress of [0, 50, 100]) {
      await extra.sendNotification({
        method: 'notifications/progress',
        params: { progressToken: request.params._meta!.progressToken!, progress, total: 100 },
      });
    }
    progressSent.resolve();
    await finish.promise;
    return { content: [{ type: 'text', text: 'actual-http-completion' }] };
  });
  await backend.connect(transport);
  const app = express();
  app.use(express.json());
  app.all('/mcp', async (request, response) => {
    await transport.handleRequest(request, response, request.body);
  });
  const http = createServer(app);
  const getStarted = deferred();
  http.on('request', (request) => {
    if (request.method === 'GET') getStarted.resolve();
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
  const revision = '2025-11-25';
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': revision,
    'mcp-session-id': 'owned-progress-session',
  };
  const getController = new AbortController();
  const getFrames: JSONRPCMessage[] = [];
  const postFrames: JSONRPCMessage[] = [];
  let getDone: Promise<void> | undefined;
  let postResponse: Promise<Response> | undefined;
  let postDone: Promise<void> | undefined;
  try {
    const initialized = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: headers.accept },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: revision, capabilities: {}, clientInfo: { name: 'raw-http-owner', version: '1' } },
      }),
    });
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get('mcp-session-id')).toBe(headers['mcp-session-id']);
    await collectFrames(initialized, []);
    const ready = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(ready.status).toBe(202);
    await ready.body?.cancel();

    const getResponse = fetch(url, {
      headers: { ...headers, accept: 'text/event-stream' },
      signal: getController.signal,
    });
    await getStarted.promise;
    // A real standalone notification proves the concurrent GET is receiving frames.
    await backend.notification({ method: 'notifications/message', params: { level: 'info', data: 'GET-ready' } });
    getDone = collectFrames(await getResponse, getFrames, getController.signal);
    await vi.waitFor(() => expect(getFrames).toHaveLength(1));
    postResponse = fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'owner-post',
        method: 'tools/call',
        params: { name: 'progress', arguments: {}, _meta: { progressToken: 'opaque-public-token' } },
      }),
    });
    await progressSent.promise;
    await backend.notification({
      method: 'notifications/message',
      params: { level: 'info', data: 'GET-progress-barrier' },
    });
    await vi.waitFor(() =>
      expect(getFrames.some((frame) => 'method' in frame && frame.params?.data === 'GET-progress-barrier')).toBe(true),
    );
    expect(getFrames.filter((frame) => 'method' in frame && frame.method === 'notifications/progress')).toEqual([]);
    const response = await postResponse;
    expect(response.status).toBe(200);
    postDone = collectFrames(response, postFrames);
    await vi.waitFor(() => expect(postFrames).toHaveLength(3));
    expect(postFrames).toEqual(
      [0, 50, 100].map((progress) => ({
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { progressToken: 'opaque-public-token', progress, total: 100 },
      })),
    );
    expect(executions).toBe(1);
    finish.resolve();
    await postDone;
    expect(postFrames[3]).toEqual({
      jsonrpc: '2.0',
      id: 'owner-post',
      result: { content: [{ type: 'text', text: 'actual-http-completion' }] },
    });
    expect(postFrames).toHaveLength(4);
    // This later standalone frame is a delivery barrier, avoiding a timed absence check.
    await backend.notification({
      method: 'notifications/message',
      params: { level: 'info', data: 'GET-after-result' },
    });
    await vi.waitFor(() => expect(getFrames).toHaveLength(3));
    expect(getFrames.map((frame) => ('method' in frame ? frame.method : undefined))).toEqual([
      'notifications/message',
      'notifications/message',
      'notifications/message',
    ]);
  } finally {
    finish.resolve();
    if (postDone) await postDone;
    else if (postResponse) await (await postResponse).body?.cancel();
    getController.abort();
    await getDone;
    await backend.close();
    http.closeAllConnections();
    await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
  }
});
