import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { test } from 'vitest';

import { createCollector } from './fake-collector.mjs';

test('endpoint-only stdio runtime and exporter-configured management command never connect to Collector', async () => {
  const collector = await createCollector();
  const directory = await mkdtemp(join(tmpdir(), '1mcp-telemetry-default-'));
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
    OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
  };
  const client = new Client({ name: 'default-acceptance', version: '1' });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          resolve('build/index.js'),
          'serve',
          '--transport',
          'stdio',
          '--config',
          config,
          '--config-dir',
          directory,
          '--log-level',
          'error',
        ],
        env,
        stderr: 'pipe',
      }),
    );
    const listed = await client.listTools();
    assert(listed.tools.some((tool) => tool.name.endsWith('echo')));
    await client.close();
    await promisify(execFile)(
      process.execPath,
      [resolve('build/index.js'), 'mcp', 'list', '--config', config, '--config-dir', directory],
      {
        env: { ...env, OTEL_TRACES_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'otlp' },
        timeout: 10000,
      },
    );
    await delay(300);
    assert.equal(collector.requests.length, 0, 'Default or one-shot command unexpectedly exported');
  } finally {
    await client.close().catch(() => {});
    await collector.close();
    await rm(directory, { recursive: true, force: true });
  }
});
