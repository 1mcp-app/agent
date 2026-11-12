import { mkdtempSync, rmSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { FileStorageService } from '@src/auth/storage/fileStorageService.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import type { LegacyConnectionId } from '@src/sdk/contracts/legacySdkAdapter.js';
import {
  installLegacyRequestTracing,
  LegacySdkServerAdapter,
} from '@src/sdk/legacy/server/runtime/legacySdkServerAdapter.js';
import type { StreamableHTTPServerTransport } from '@src/sdk/legacy/server/streamableHttp.js';
import { setupStreamableHttpRoutes } from '@src/transport/http/routes/streamableHttpRoutes.js';
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import { StreamableSessionLifecycle } from '@src/transport/http/streamableSessionLifecycle.js';

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe.each([false, true])('real SDK request lifetime (persistence=%s)', (sessionPersistence) => {
  let directory: string;
  let repository: StreamableSessionRepository;
  let listener: HttpServer;
  let client: Client;
  let finishHandler: (() => void) | undefined;
  const adapters = new Map<string, LegacySdkServerAdapter>();

  afterEach(async () => {
    finishHandler?.();
    await client?.close();
    await Promise.all([...adapters.values()].map((adapter) => adapter.close()));
    adapters.clear();
    repository?.stopPeriodicFlush();
    if (listener) {
      listener.closeAllConnections();
      await new Promise<void>((done) => listener.close(() => done()));
    }
    vi.restoreAllMocks();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('retains a deferred protocol handler after SDK HTTP handling and its response have ended', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(AgentConfigManager.getInstance(), 'getSessionTtlMinutes').mockReturnValue(1);
    const originalGet = AgentConfigManager.getInstance().get.bind(AgentConfigManager.getInstance());
    vi.spyOn(AgentConfigManager.getInstance(), 'get').mockImplementation((key) => {
      if (key === 'features') return { ...originalGet('features'), auth: false, sessionPersistence };
      return originalGet(key);
    });
    directory = mkdtempSync(join(tmpdir(), '1mcp-sdk-activity-'));
    repository = new StreamableSessionRepository(
      new FileStorageService(directory, 'transport', { manageLifecycle: false }),
    );
    let leases = 0;
    const protect = repository.protectSession.bind(repository);
    vi.spyOn(repository, 'protectSession').mockImplementation((id) => {
      const release = protect(id);
      leases++;
      let released = false;
      return (accepted) => {
        if (released) return;
        released = true;
        leases--;
        release(accepted);
      };
    });
    const transports = new Map<string, StreamableHTTPServerTransport>();
    let handlerPending = false;
    let httpHandlingFinished = false;
    const disconnect = vi.fn(async (id: string) => {
      const adapter = adapters.get(id);
      adapters.delete(id);
      transports.delete(id);
      await adapter?.close();
    });
    const manager = {
      getTransport: (id: string) => transports.get(id),
      getServer: (id: string) => (adapters.has(id) ? { adapter: adapters.get(id) } : undefined),
      connectTransport: async (transport: StreamableHTTPServerTransport, id: string) => {
        const server = new SdkServer({ name: 'lifetime-test', version: '1' }, { capabilities: { tools: {} } });
        const adapter = new LegacySdkServerAdapter(id as LegacyConnectionId, server, transport);
        installLegacyRequestTracing(server, () => adapter.retainRequestActivity());
        server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
        server.setRequestHandler(CallToolRequestSchema, async () => {
          handlerPending = true;
          await new Promise<void>((done) => {
            finishHandler = done;
          });
          handlerPending = false;
          return { content: [{ type: 'text', text: 'finished' }] };
        });
        const handle = transport.handleRequest.bind(transport);
        vi.spyOn(transport, 'handleRequest').mockImplementation(async (req, res, body) => {
          await handle(req, res, body);
          if ((body as { method?: string })?.method === 'tools/call') httpHandlingFinished = true;
        });
        adapters.set(id, adapter);
        transports.set(id, transport);
        await adapter.start();
      },
      disconnectTransport: disconnect,
    } as unknown as ServerManager;
    const lifecycle = new StreamableSessionLifecycle(manager, repository);
    const app = express();
    app.use(express.json());
    const responses = new Set<express.Response>();
    app.use((req, res, next) => {
      responses.add(res);
      res.on('finish', () => responses.delete(res));
      res.on('close', () => responses.delete(res));
      next();
    });
    setupStreamableHttpRoutes(
      app,
      manager,
      repository,
      (_req, _res, next) => next(),
      undefined,
      undefined,
      undefined,
      lifecycle,
    );
    listener = app.listen(0, '127.0.0.1');
    await new Promise<void>((done) => listener.once('listening', done));
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Loopback listener not bound');
    client = new Client({ name: 'lifetime-test', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
    await client.connect(transport);
    const sessionId = transport.sessionId!;
    const call = client.callTool({ name: 'deferred', arguments: {} }).catch(() => undefined);
    await vi.waitFor(() => expect(handlerPending).toBe(true));
    await client.close();
    await vi.waitFor(() => expect(httpHandlingFinished).toBe(true));
    await vi.waitFor(() => expect(responses.size).toBe(0));
    expect(handlerPending).toBe(true);
    expect(leases).toBe(1); // Only the real protocol handler remains, after all HTTP responses closed.
    now += 120_000;
    await lifecycle.expireIdleSessions();
    expect(disconnect).not.toHaveBeenCalled();
    expect(repository.getSessionData(sessionId)).not.toBeNull();
    finishHandler!();
    await vi.waitFor(() => expect(leases).toBe(0));
    await call;
    now += 60_000;
    await lifecycle.expireIdleSessions();
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(sessionId, true);
    expect(repository.getSessionData(sessionId)).toBeNull();
  });
});
