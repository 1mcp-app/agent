import { Client as ModernClient } from '@modelcontextprotocol/client';

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { test } from 'vitest';

import { createCollector } from './fake-collector.mjs';
import { assertPrivatePayloads } from './privacy-corpus.mjs';

test.each(['sse', 'stdio', 'legacy-proxy', 'modern-proxy'])(
  '%s transport exports a request only after the upstream reply',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), '1mcp-telemetry-transport-'));
    const collector = await createCollector();
    const config = join(directory, 'mcp.json');
    await writeFile(
      config,
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: [resolve('test/telemetry/workload-backend.mjs')],
            protocolVersion: 'legacy',
          },
        },
      }),
    );
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OTEL_'))),
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_LOGS_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
      OTEL_TRACES_SAMPLER: 'always_on',
      OTEL_BSP_SCHEDULE_DELAY: '10',
    };
    const serveArgs = [
      resolve('build/index.js'),
      'serve',
      '--transport',
      mode === 'stdio' ? 'stdio' : 'http',
      '--host',
      '127.0.0.1',
      '--port',
      '14322',
      '--config',
      config,
      '--config-dir',
      directory,
      '--no-enable-auth',
      '--no-enable-async-loading',
      '--log-level',
      'error',
    ];
    const modern = mode === 'modern-proxy';
    const client = modern
      ? new ModernClient(
          { name: 'telemetry-acceptance', version: '1' },
          { versionNegotiation: { mode: { pin: '2026-07-28' } } },
        )
      : new Client({ name: 'telemetry-acceptance', version: '1' });
    let runtime;
    let spawnError;
    let diagnostic = '';
    try {
      if (mode !== 'stdio') {
        // Proxy tests isolate proxy spans by disabling export in its upstream runtime.
        runtime = spawn(process.execPath, serveArgs, {
          env: { ...env, OTEL_TRACES_EXPORTER: mode === 'sse' ? 'otlp' : 'none' },
          cwd: directory,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        runtime.on('error', (error) => {
          spawnError = error;
        });
        runtime.stderr.on('data', (chunk) => {
          diagnostic = (diagnostic + chunk).slice(-8192);
        });
        for (let attempt = 0; ; attempt++) {
          if (spawnError) throw spawnError;
          assert(runtime.exitCode === null, `Runtime startup failed: ${diagnostic}`);
          try {
            if ((await fetch('http://127.0.0.1:14322/health', { signal: AbortSignal.timeout(300) })).ok) break;
          } catch {
            /* bounded readiness polling */
          }
          assert(attempt < 100, `Runtime readiness timeout: ${diagnostic}`);
          await delay(100);
        }
      }
      const transport =
        mode === 'sse'
          ? new SSEClientTransport(new URL('http://127.0.0.1:14322/sse'))
          : new StdioClientTransport({
              command: process.execPath,
              args:
                mode === 'stdio'
                  ? serveArgs
                  : [
                      resolve('build/index.js'),
                      'proxy',
                      '--url',
                      'http://127.0.0.1:14322/mcp',
                      '--config-dir',
                      directory,
                      '--log-level',
                      'error',
                    ],
              env,
              cwd: directory,
              stderr: 'pipe',
            });
      transport.stderr?.on('data', (chunk) => {
        diagnostic = (diagnostic + chunk).slice(-8192);
      });
      let timer;
      try {
        await Promise.race([
          client.connect(transport),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Client initialization timeout: ${diagnostic}`)), 8000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      const tools = await client.listTools();
      const slow = tools.tools.find((tool) => tool.name.endsWith('slow'));
      assert(slow, 'Delayed fixture missing');
      const pending = client.callTool({
        name: slow.name,
        arguments: {},
        _meta: {
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        },
      });
      // This checks reply lifetime, not the send/HTTP acknowledgement boundary.
      await delay(100);
      assert(
        !collector.requests.some((request) => request.body.includes(Buffer.from('tools/call'))),
        'Request span exported before delayed upstream response',
      );
      assert.equal((await pending).content[0].text, 'slow-ok');
      await delay(200);
      assert(
        collector.requests.some((request) => request.body.includes(Buffer.from('tools/call'))),
        'Completed operation span missing',
      );
      assertPrivatePayloads(collector.requests.map((request) => request.body));
    } finally {
      await client.close().catch(() => {});
      if (runtime && runtime.exitCode === null) {
        runtime.kill('SIGTERM');
        for (let attempt = 0; runtime.exitCode === null && attempt < 70; attempt++) await delay(100);
        if (runtime.exitCode === null) {
          runtime.kill('SIGKILL');
          await new Promise((resolve) => runtime.once('exit', resolve));
        }
      }
      await collector.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
