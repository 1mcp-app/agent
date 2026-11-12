import { CommandTestEnvironment } from '@test/e2e/utils/CommandTestEnvironment.js';
import { McpTestClient } from '@test/e2e/utils/McpTestClient.js';

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { expect, it, vi } from 'vitest';

interface Event {
  pid: number;
  event: 'start' | 'dispatch';
  message?: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

it('preserves modern outbound negotiation when waking an owned backend', async () => {
  const environment = new CommandTestEnvironment({ name: 'backend-sleep-modern' });
  await environment.setup();
  const directory = environment.getTempDir();
  const eventsPath = join(directory, 'events.jsonl');
  const events = async (): Promise<Event[]> => {
    const text = await readFile(eventsPath, 'utf8').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
      throw error;
    });
    return text.trim()
      ? text
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
  };
  const config = join(environment.getConfigDir(), 'mcp.json');
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: {
        modern: {
          command: process.execPath,
          args: [resolve('test/e2e/fixtures/backend-sleep-modern.mjs'), eventsPath],
          protocolVersion: '2026-07-28',
          connectionTimeout: 10_000,
          timeout: 10_000,
          tags: ['modern'],
          sleep: { enabled: true, idleTimeoutMs: 30_000 },
        },
      },
    }),
  );
  const client = new McpTestClient({
    transport: 'stdio',
    stdioConfig: {
      command: process.execPath,
      args: [
        resolve('build/index.js'),
        'serve',
        '--transport',
        'stdio',
        '--config',
        config,
        '--config-dir',
        environment.getConfigDir(),
        '--filter',
        'modern',
        '--log-file',
        join(directory, 'runtime.log'),
        '--log-level',
        'debug',
      ],
      env: { ...environment.getEnvironmentVariables(), HOME: directory, USERPROFILE: directory },
    },
  });
  const call = (message: string) =>
    client.getClient().callTool({ name: 'modern_1mcp_record', arguments: { message } }, undefined, { timeout: 15_000 });
  try {
    await client.connect();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('modern_1mcp_record');
    // The modern SDK reaps a disposable negotiation probe before starting its
    // session process. Count and verify both, so a probe exit cannot fake sleep.
    const initialStarts = (await events()).filter((event) => event.event === 'start');
    expect(initialStarts).toHaveLength(2);
    expect(isAlive(initialStarts[0].pid)).toBe(false);
    const initialPid = initialStarts[1].pid;
    expect(isAlive(initialPid)).toBe(true);
    expect((await call('before')).content).toEqual([{ type: 'text', text: `before from ${initialPid}` }]);
    await vi.waitFor(() => expect(isAlive(initialPid)).toBe(false), { timeout: 75_000, interval: 500 });
    expect(await client.getClient().listTools({}, { timeout: 5_000 })).toEqual(tools);
    expect(isAlive(initialPid)).toBe(false);
    expect((await events()).filter((event) => event.event === 'start')).toHaveLength(2);
    const result = await call('after');
    const recorded = await events();
    const starts = recorded.filter((event) => event.event === 'start');
    expect(starts).toHaveLength(4);
    expect(isAlive(starts[2].pid)).toBe(false);
    expect(starts[3].pid).not.toBe(initialPid);
    expect(isAlive(starts[3].pid)).toBe(true);
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: `after from ${starts[3].pid}` }]);
    expect(recorded.filter((event) => event.event === 'dispatch').map((event) => event.message)).toEqual([
      'before',
      'after',
    ]);
  } catch (error) {
    const log = await readFile(join(directory, 'runtime.log'), 'utf8').catch(() => 'No runtime log');
    throw new Error(`Modern wake failed: ${JSON.stringify(await events())}\n${log.slice(-12_000)}`, { cause: error });
  } finally {
    try {
      await client.disconnect();
      const pids = (await events()).filter((event) => event.event === 'start').map((event) => event.pid);
      await vi.waitFor(() => expect(pids.filter(isAlive)).toEqual([]), { timeout: 5_000, interval: 50 });
    } finally {
      await environment.cleanup();
    }
  }
}, 100_000);
