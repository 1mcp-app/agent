import { createServer, type ServerResponse } from 'node:http';

import type { MCPServerParams } from '@src/core/types/index.js';
import { SSE_WIRE_LIMIT_BYTES, SseWireLimitError } from '@src/transport/sseWireLimit.js';

import { describe, expect, it, vi } from 'vitest';

import { createTransports } from './transportFactory.js';

vi.mock('@src/auth/sdkOAuthClientProvider.js', () => ({
  SDKOAuthClientProvider: class {
    fetch = globalThis.fetch;
    tokens = async () => undefined;
    token = async () => undefined;
  },
}));
vi.mock('@src/core/runtime/runtimeIdentityService.js', () => ({
  RuntimeIdentityService: class {
    getRuntimeScopeId() {
      return 'sse_wire_limit_test';
    }
  },
}));
vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: () => ({
      getUrl: () => 'http://localhost:3050',
      get: () => ({}),
      isEnvSubstitutionEnabled: () => false,
    }),
  },
}));

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve: () => resolve(),
  };
}

async function liveProof(protocolVersion: 'legacy' | '2026-07-28', scenario: 'post' | 'get' | 'sse' | 'pre-endpoint') {
  let getCount = 0;
  let toolCount = 0;
  let retained: ServerResponse | undefined;
  const ready = deferred();
  const cancelled = deferred();
  const overflowed = deferred();
  const responses: ServerResponse[] = [];
  const beginStream = (response: ServerResponse) => {
    responses.push(response);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.on('close', cancelled.resolve);
    // Prime a replayable event ID and shortest reconnect delay before overflow.
    response.write('id: replay-marker\nretry: 1\n\n');
  };
  const overflow = (response: ServerResponse) => {
    setImmediate(() => response.write('data:' + 'x'.repeat(SSE_WIRE_LIMIT_BYTES)));
  };
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      getCount++;
      beginStream(response);
      retained = response;
      if (scenario === 'sse') response.write('event: endpoint\ndata: /messages\n\n');
      if (scenario === 'pre-endpoint') overflow(response);
      ready.resolve();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body) as { method: string };
    if (message.method === 'tools/call') {
      toolCount++;
      if (scenario === 'post') {
        beginStream(response);
        overflow(response);
      } else {
        response.writeHead(202).end();
        overflow(retained!);
      }
      return;
    }
    response.writeHead(202).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected HTTP port');
  const config: MCPServerParams = {
    type: scenario === 'sse' || scenario === 'pre-endpoint' ? 'sse' : 'http',
    url: `http://127.0.0.1:${address.port}/mcp`,
    protocolVersion,
  };
  const transport = createTransports({ upstream: config }).upstream;
  const messages = vi.fn();
  const closed = vi.fn();
  transport.onmessage = messages;
  transport.onclose = closed;
  transport.onerror = (error) => {
    if (error instanceof SseWireLimitError) overflowed.resolve();
  };
  try {
    if (scenario === 'pre-endpoint') {
      await expect(transport.start()).rejects.toBeInstanceOf(SseWireLimitError);
      await cancelled.promise;
      await delay(100);
      expect(getCount).toBe(1);
      expect(toolCount).toBe(0);
      expect(closed).toHaveBeenCalledOnce();
      await expect(transport.start()).rejects.toBeInstanceOf(SseWireLimitError);
      expect(getCount).toBe(1);
      return;
    }
    await transport.start();
    if (scenario === 'get') await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    if (scenario !== 'post') await ready.promise;
    await transport.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'side_effect', arguments: {} },
    });
    await Promise.all([overflowed.promise, cancelled.promise]);
    await delay(100); // retry:1 has elapsed repeatedly; the SDK must not resume.
    expect(toolCount).toBe(1);
    expect(getCount).toBe(scenario === 'post' ? 0 : 1);
    expect(messages).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledOnce();
    await expect(
      transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'side_effect' } }),
    ).rejects.toBeDefined();
    expect(toolCount).toBe(1);
    expect(getCount).toBe(scenario === 'post' ? 0 : 1);
  } finally {
    await transport.close();
    for (const response of responses) response.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe.each(['legacy', '2026-07-28'] as const)('factory-owned SSE wire cancellation (%s)', (protocolVersion) => {
  it.each(['post', 'get', 'sse', 'pre-endpoint'] as const)(
    'cancels %s overflow without reconnecting or replaying a Tool',
    async (scenario) => {
      await liveProof(protocolVersion, scenario);
    },
    15_000,
  );
});
