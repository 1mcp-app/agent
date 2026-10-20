import { Client as ModernClient, StreamableHTTPClientTransport as ModernTransport } from '@modelcontextprotocol/client';

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { test } from 'vitest';

import { createCollector } from './fake-collector.mjs';
import { assertPrivatePayloads, privacyCorpus } from './privacy-corpus.mjs';
import { createModernBackend } from './workload-modern-backend.mjs';

test.each([
  ['legacy', 'legacy'],
  ['legacy', 'modern'],
  ['modern', 'legacy'],
  ['modern', 'modern'],
])(
  '%s-%s CLI runtime exports private MCP operations and survives Collector outage',
  async (inboundEra, outboundEra) => {
    const collector = await createCollector();
    const directory = await mkdtemp(join(tmpdir(), '1mcp-telemetry-runtime-'));
    const port = 14320;
    const config = join(directory, 'mcp.json');
    const backend = outboundEra === 'modern' ? await createModernBackend() : undefined;
    await writeFile(
      config,
      JSON.stringify({
        mcpServers: {
          [privacyCorpus.backendName]: backend
            ? { type: 'http', url: backend.url, protocolVersion: '2026-07-28' }
            : {
                command: process.execPath,
                args: [resolve('test/telemetry/workload-backend.mjs')],
                protocolVersion: 'legacy',
              },
        },
      }),
    );
    const child = spawn(
      process.execPath,
      [
        resolve('build/index.js'),
        'serve',
        '--transport',
        'http',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--config',
        config,
        '--config-dir',
        directory,
        '--no-enable-auth',
        '--no-enable-async-loading',
        '--log-level',
        'error',
      ],
      {
        env: {
          ...process.env,
          OTEL_SDK_DISABLED: 'false',
          OTEL_TRACES_EXPORTER: 'otlp',
          OTEL_METRICS_EXPORTER: 'otlp',
          OTEL_LOGS_EXPORTER: 'none',
          OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
          OTEL_TRACES_SAMPLER: 'always_on',
          OTEL_BSP_SCHEDULE_DELAY: '10',
          OTEL_METRIC_EXPORT_INTERVAL: '5000',
          OTEL_EXPORTER_OTLP_TIMEOUT: '1000',
          OTEL_EXPORTER_OTLP_HEADERS: `x-acceptance=${privacyCorpus.authorization}`,
        },
        cwd: directory,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let diagnostic = '';
    let spawnError;
    child.stderr.on('data', (chunk) => {
      diagnostic = (diagnostic + chunk).slice(-8192);
    });
    child.once('error', (error) => {
      spawnError = error;
    });
    const client =
      inboundEra === 'modern'
        ? new ModernClient(
            { name: privacyCorpus.client, version: '1.0.0' },
            {
              capabilities: { roots: {} },
              inputRequired: { autoFulfill: true },
              versionNegotiation: { mode: { pin: '2026-07-28' } },
            },
          )
        : new Client({ name: privacyCorpus.client, version: '1.0.0' }, { capabilities: { roots: {} } });
    let reverseRequests = 0;
    client.setRequestHandler(inboundEra === 'modern' ? 'roots/list' : ListRootsRequestSchema, async () => {
      reverseRequests++;
      return { roots: [{ uri: 'file:///PRIVACY_URI_489', name: privacyCorpus.prompt }] };
    });
    try {
      for (let attempt = 0; ; attempt++) {
        if (spawnError) throw spawnError;
        assert(child.exitCode === null, `Runtime exited before readiness: ${diagnostic}`);
        try {
          if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(300) })).ok) break;
        } catch {
          /* Retry until the bounded readiness deadline. */
        }
        assert(attempt < 100, `Runtime readiness timeout: ${diagnostic}`);
        await delay(100);
      }
      const Transport = inboundEra === 'modern' ? ModernTransport : StreamableHTTPClientTransport;
      await client.connect(new Transport(new URL(`http://127.0.0.1:${port}/mcp`)));
      const listed = await client.listTools();
      const echo = listed.tools.find((tool) => tool.name.endsWith('echo'));
      const error = listed.tools.find((tool) => tool.name.endsWith('error'));
      assert(echo && error, 'Fixture tools not discoverable');
      if (inboundEra === 'legacy') {
        const reverse = listed.tools.find((tool) => tool.name.endsWith('reverse'));
        assert(reverse, 'Reverse fixture missing');
        const reversed = await client.callTool({
          name: reverse.name,
          arguments: {},
          _meta: {
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            'io.modelcontextprotocol/clientCapabilities': { roots: {} },
          },
        });
        assert.equal(reversed.content[0].text, 'reverse-ok');
        assert.equal(reverseRequests, 1, 'Owned reverse operation must be answered exactly once');
      }
      const call = () =>
        client.callTool({
          name: echo.name,
          arguments: { message: JSON.stringify(privacyCorpus) },
          _meta: {
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            baggage: privacyCorpus.baggage,
            secret: privacyCorpus.metadata,
          },
        });
      const healthy = await call();
      assert.equal(healthy.content[0].text, JSON.stringify(privacyCorpus));
      collector.respond({ status: 503 });
      for (let attempt = 0; attempt < 4; attempt++) {
        assert.deepEqual(await call(), healthy);
        await delay(100);
      }
      assert((await fetch(`http://127.0.0.1:${port}/health`)).ok, 'Collector outage changed readiness');
      collector.respond({ status: 200 });
      assert.deepEqual(await call(), healthy);
      assert.equal((await client.callTool({ name: error.name, arguments: {} })).isError, true);
      await delay(5500);
      await client.close();
      child.kill('SIGTERM');
      for (let attempt = 0; child.exitCode === null && attempt < 70; attempt++) await delay(100);
      assert.equal(child.exitCode, 0, 'Orderly runtime shutdown must preserve exit result');
      assert(
        collector.requests.some((request) => request.path === '/v1/traces'),
        'CLI runtime did not export traces',
      );
      assert(
        collector.requests.some((request) => request.path === '/v1/metrics'),
        'CLI runtime did not export metrics',
      );
      assertPrivatePayloads(collector.requests.map((request) => request.body));
      assert(collector.requests.some((request) => request.body.includes(Buffer.from('tools/call'))));
    } catch (error) {
      throw new Error(JSON.stringify({ message: error.message, data: error.data, diagnostic }), { cause: error });
    } finally {
      await client.close().catch(() => {});
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await new Promise((resolve) => child.once('exit', resolve));
      }
      await backend?.close();
      await collector.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
