import { Client, StreamableHTTPClientTransport, UnsupportedProtocolVersionError } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { CommandTestEnvironment, TestProcessManager } from '@test/e2e/utils/index.js';

import { readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

describe('built runtime inbound HTTP era', () => {
  let environment: CommandTestEnvironment;
  let processes: TestProcessManager;
  const clients: Client[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await processes?.cleanup();
    await environment?.cleanup();
  });

  async function launch(config: string, env: string | undefined, cli: string | undefined, modernUrl?: string) {
    environment = new CommandTestEnvironment({
      name: 'inbound-http-era',
      createConfigFile: true,
      mockMcpServers: [
        {
          name: 'stateful',
          command: process.execPath,
          type: 'stdio',
          args: [join(process.cwd(), 'test/e2e/fixtures/stateful-legacy-server.mjs')],
        },
      ],
      envOverrides: { ONE_MCP_INBOUND_HTTP_ERA: env ?? '' },
    });
    await environment.setup();
    await writeFile(join(environment.getConfigDir(), 'config.toml'), config);
    if (modernUrl) {
      const inventory = JSON.parse(await readFile(environment.getConfigPath(), 'utf8'));
      inventory.mcpServers.modern = { type: 'http', url: modernUrl, protocolVersion: '2026-07-28' };
      await writeFile(environment.getConfigPath(), JSON.stringify(inventory));
    }
    processes = new TestProcessManager();
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const vars = environment.getEnvironmentVariables();
    if (env === undefined) delete vars.ONE_MCP_INBOUND_HTTP_ERA;
    await processes.startProcess('runtime', {
      command: process.execPath,
      cwd: process.cwd(),
      args: [
        'build/index.js',
        'serve',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--config-dir',
        environment.getConfigDir(),
        '--no-enable-config-reload',
        '--log-level',
        'error',
        ...(cli ? ['--inbound-http-era', cli] : []),
      ],
      env: vars,
    });
    const endpoint = new URL(`http://127.0.0.1:${port}/mcp`);
    const deadline = Date.now() + 15_000;
    while (true) {
      try {
        if ((await fetch(new URL('/health/ready', endpoint))).ok) break;
      } catch {
        /* Wait for owned listener. */
      }
      if (Date.now() > deadline) throw new Error('Owned runtime did not become ready');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return endpoint;
  }

  function client(mode: 'auto' | 'legacy' | { pin: string }) {
    const created = new Client({ name: 'inbound-era-e2e', version: '1' }, { versionNegotiation: { mode } });
    clients.push(created);
    return created;
  }

  it('keeps modern outbound protocolVersion working behind legacy-only inbound HTTP', async () => {
    const handler = createMcpHandler(
      () => {
        const upstream = new McpServer({ name: 'modern-upstream', version: '1' });
        upstream.registerTool('ping', { inputSchema: {} }, async () => ({
          content: [{ type: 'text' as const, text: 'modern outbound works' }],
        }));
        return upstream;
      },
      { legacy: 'reject' },
    );
    const server = createHttpServer(toNodeHandler(handler));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const upstreamUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
    try {
      const endpoint = await launch('inboundHttpEra = "legacy-only"', undefined, undefined, upstreamUrl);
      const inbound = client('auto');
      await inbound.connect(new StreamableHTTPClientTransport(endpoint));
      const result = await inbound.callTool({ name: 'modern_1mcp_ping', arguments: {} });
      expect(result.content).toEqual([{ type: 'text', text: 'modern outbound works' }]);
      const inventory = JSON.parse(await readFile(environment.getConfigPath(), 'utf8'));
      expect(inventory.mcpServers.modern.protocolVersion).toBe('2026-07-28');
    } finally {
      await processes?.cleanup();
      await handler.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each([
    ['', undefined, undefined],
    ['inboundHttpEra = "legacy-only"', 'dual', undefined],
  ])('preserves dual-era default and environment override (%s)', async (config, env, cli) => {
    const endpoint = await launch(config ?? '', env, cli);
    const modern = client({ pin: '2026-07-28' });
    await modern.connect(new StreamableHTTPClientTransport(endpoint));
    expect((await modern.listTools()).tools.map((tool) => tool.name)).toContain('stateful_1mcp_remember');
  });

  it.each([
    ['inboundHttpEra = "legacy-only"', undefined, undefined],
    ['inboundHttpEra = "dual"', 'dual', 'legacy-only'],
  ])(
    'retains an opaque legacy backend handle with SDK auto fallback and legacy pinning (%s)',
    async (config, env, cli) => {
      const endpoint = await launch(config ?? '', env, cli);
      const pinnedModern = client({ pin: '2026-07-28' });
      await expect(pinnedModern.connect(new StreamableHTTPClientTransport(endpoint))).rejects.toBeInstanceOf(
        UnsupportedProtocolVersionError,
      );
      for (const mode of ['auto', 'legacy'] as const) {
        const legacy = client(mode);
        const transport = new StreamableHTTPClientTransport(endpoint);
        await legacy.connect(transport);
        expect(transport.sessionId).toBeTruthy();
        const remembered = await legacy.callTool({ name: 'stateful_1mcp_remember', arguments: {} });
        const first = JSON.parse((remembered.content[0] as { text: string }).text);
        const recalled = await legacy.callTool({ name: 'stateful_1mcp_recall', arguments: { handle: first.handle } });
        expect(JSON.parse((recalled.content[0] as { text: string }).text)).toEqual({ ...first, retained: true });
        await transport.terminateSession();
      }
      const configAfter = await readFile(environment.getConfigPath(), 'utf8');
      expect(configAfter).not.toContain('protocolVersion');
    },
  );
});
