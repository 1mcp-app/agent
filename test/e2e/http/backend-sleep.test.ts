import { CommandTestEnvironment, TestProcessManager } from '@test/e2e/utils/index.js';

import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

interface FixtureEvent {
  pid: number;
  event: 'start' | 'ready' | 'dispatch';
  tool?: string;
  message?: string;
}

async function readEvents(path: string): Promise<FixtureEvent[]> {
  const text = await readFile(path, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  });
  return text.trim()
    ? text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
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

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a loopback port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

describe('Backend Sleep through the built HTTP API', () => {
  it.each([false, true])(
    'lists cached tools without waking and invokes once (lazy=%s)',
    async (lazy) => {
      const environment = new CommandTestEnvironment({ name: 'http-backend-sleep' });
      await environment.setup();
      const processManager = new TestProcessManager();
      const directory = environment.getTempDir();
      const eventsPath = join(directory, 'sleeper.jsonl');
      const gate = join(directory, 'allow-wake');
      const config = join(environment.getConfigDir(), 'mcp.json');
      try {
        await writeFile(
          config,
          JSON.stringify({
            mcpServers: {
              sleeper: {
                command: process.execPath,
                args: [resolve('test/e2e/fixtures/backend-sleep-server.mjs'), eventsPath, gate],
                protocolVersion: 'legacy',
                disabledTools: ['forbidden'],
                // Expire before the first normal 30-second sweep, without changing its cadence.
                sleep: { enabled: true, idleTimeoutMs: 1_000 },
              },
            },
          }),
        );
        const port = await getAvailablePort();
        const baseUrl = `http://127.0.0.1:${port}`;
        await processManager.startProcess('runtime', {
          command: process.execPath,
          args: [
            resolve('build/index.js'),
            'serve',
            '--transport',
            'http',
            '--port',
            String(port),
            '--config',
            config,
            '--config-dir',
            environment.getConfigDir(),
            '--no-enable-config-reload',
            '--enable-lazy-loading',
            String(lazy),
            '--log-file',
            join(directory, 'runtime.log'),
            '--log-level',
            'debug',
          ],
          env: { ...environment.getEnvironmentVariables(), HOME: directory, USERPROFILE: directory },
        });
        await vi.waitFor(
          async () => {
            const response = await fetch(`${baseUrl}/health/ready`, { signal: AbortSignal.timeout(1_000) });
            expect(response.ok).toBe(true);
          },
          { timeout: 15_000, interval: 100 },
        );
        const list = async () => {
          const response = await fetch(`${baseUrl}/api/v1/tools?server=sleeper`, {
            signal: AbortSignal.timeout(5_000),
          });
          expect(response.status).toBe(200);
          return response.json();
        };
        const initial = await list();
        expect(initial.tools).toHaveLength(1);
        expect(JSON.stringify(initial.tools)).toContain('record');
        expect(JSON.stringify(initial.tools)).not.toContain('forbidden');
        const initialPid = (await readEvents(eventsPath))[0].pid;
        expect(isAlive(initialPid)).toBe(true);

        // Poll only the owned PID: discovery work must not interfere with the idle sweep.
        await vi.waitFor(() => expect(isAlive(initialPid)).toBe(false), { timeout: 40_000, interval: 250 });
        const sleeping = await list();
        expect(sleeping.tools).toEqual(initial.tools);
        expect(sleeping.totalCount).toBe(initial.totalCount);
        expect((await readEvents(eventsPath)).filter((event) => event.event === 'start')).toHaveLength(1);
        expect(isAlive(initialPid)).toBe(false);

        await writeFile(gate, 'ready');
        const response = await fetch(`${baseUrl}/api/v1/tool-invocations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tool: 'sleeper/record', args: { message: 'http-wake' } }),
          signal: AbortSignal.timeout(10_000),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ result: { content: [{ type: 'text', text: 'http-wake' }] } });
        const events = await readEvents(eventsPath);
        const starts = events.filter((event) => event.event === 'start');
        expect(starts).toHaveLength(2);
        expect(starts[1].pid).not.toBe(initialPid);
        expect(isAlive(starts[1].pid)).toBe(true);
        expect(events.filter((event) => event.event === 'dispatch')).toEqual([
          { pid: starts[1].pid, event: 'dispatch', tool: 'record', message: 'http-wake' },
        ]);
      } catch (error) {
        const logs = await readFile(join(directory, 'runtime.log'), 'utf8').catch(() => 'No runtime log');
        throw new Error(
          `HTTP Backend Sleep failed: ${JSON.stringify(await readEvents(eventsPath))}\n${logs.slice(-12_000)}`,
          { cause: error },
        );
      } finally {
        try {
          await processManager.cleanup();
          const owned = (await readEvents(eventsPath))
            .filter((event) => event.event === 'start')
            .map((event) => event.pid);
          await vi.waitFor(() => expect(owned.filter(isAlive)).toEqual([]), { timeout: 5_000, interval: 50 });
        } finally {
          await environment.cleanup();
        }
      }
    },
    60_000,
  );
});
