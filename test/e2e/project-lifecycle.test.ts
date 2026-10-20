import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createHookProjectOwner } from '@src/commands/shared/projectOwnerStore.js';

import { expect, it } from 'vitest';

const execute = promisify(execFile);
const entry = path.resolve('build/index.js');
const fixture = path.resolve('test/e2e/fixtures/project-lifecycle-server.js');

it('isolates owners, verifies backend exit, and persists drain through restart and checkout recreation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), '1mcp-project-lifecycle-'));
  const configDirectory = path.join(directory, 'runtime');
  const checkout = path.join(directory, 'checkout');
  let runtime: ChildProcess | undefined;
  let diagnostics = '';
  try {
    await mkdir(configDirectory, { mode: 0o700 });
    await mkdir(checkout);
    await writeFile(path.join(checkout, 'source.txt'), 'owner-isolation-source');
    const config = path.join(configDirectory, 'mcp.json');
    await writeFile(
      config,
      JSON.stringify({
        mcpServers: {},
        mcpTemplates: {
          fixture: { command: process.execPath, args: [fixture, '{{{project.path}}}'], template: { shareable: true } },
        },
      }),
    );
    const port = await new Promise<number>((resolve, reject) => {
      const listener = createServer();
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', () => {
        const address = listener.address();
        if (!address || typeof address === 'string') return reject(new Error('No port'));
        listener.close((error) => (error ? reject(error) : resolve(address.port)));
      });
    });
    const url = `http://127.0.0.1:${port}/mcp`;
    const start = async () => {
      runtime = spawn(
        process.execPath,
        [
          entry,
          'serve',
          '--transport',
          'http',
          '--port',
          String(port),
          '--config',
          config,
          '--config-dir',
          configDirectory,
          '--no-enable-config-reload',
          '--log-level',
          'error',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      runtime.stdout?.resume();
      runtime.stderr?.on('data', (chunk: Buffer) => {
        diagnostics = (diagnostics + chunk.toString()).slice(-8192);
      });
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (runtime.exitCode !== null) throw new Error(`Runtime exited: ${diagnostics}`);
        try {
          if ((await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(300) })).ok) return;
        } catch {
          /* startup */
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Runtime startup timed out: ${diagnostics}`);
    };
    const stop = async () => {
      if (!runtime || runtime.exitCode !== null) return;
      const closed = new Promise<void>((resolve) => runtime!.once('exit', () => resolve()));
      runtime.kill('SIGTERM');
      await closed;
      runtime = undefined;
    };
    const cli = async (args: string[], owner?: string) => {
      const argv = [
        entry,
        ...args,
        '--config-dir',
        configDirectory,
        '--url',
        url,
        '--project',
        checkout,
        '--cli-session-cache-path',
        path.join(directory, 'session-{scope}.json'),
      ];
      if (owner) argv.push('--project-owner', owner);
      try {
        const result = await execute(process.execPath, argv, { timeout: 15000 });
        return { code: 0, output: JSON.parse(result.stdout) };
      } catch (error) {
        const result = error as Error & { code: number; stdout: string; stderr: string };
        if (typeof result.code !== 'number') throw error;
        return { code: result.code, output: result.stdout.trim() ? JSON.parse(result.stdout) : result.stderr };
      }
    };
    const ownerA = await createHookProjectOwner(directory, { client: 'codex', sessionId: 'parent' });
    const ownerB = await createHookProjectOwner(directory, { client: 'codex', sessionId: 'parent', agentId: 'worker' });
    await start();
    for (const owner of [ownerA, ownerB]) {
      const call = await cli(['run', 'fixture/source', '--args', '{}', '--format', 'json'], owner);
      expect(call.code, JSON.stringify(call.output)).toBe(0);
      expect(JSON.stringify(call.output)).toContain('owner-isolation-source');
    }
    const releaseA = await cli(['project', 'release', '--format', 'json'], ownerA);
    expect(releaseA.output.results[0].complete).toBe(false);
    const stillWorks = await cli(['run', 'fixture/source', '--args', '{}', '--format', 'json'], ownerB);
    expect(stillWorks.code, JSON.stringify(stillWorks.output)).toBe(0);
    const blocked = await cli(['project', 'drain', '--wait-ms', '100', '--format', 'json']);
    expect(blocked.code).not.toBe(0);
    expect(blocked.output.results[0]).toMatchObject({ admission: 'draining', complete: false });
    const denied = await cli(['run', 'fixture/source', '--args', '{}', '--format', 'json'], ownerB);
    expect(denied.code).not.toBe(0);
    const releaseB = await cli(['project', 'release', '--format', 'json'], ownerB);
    expect(releaseB.code, JSON.stringify(releaseB.output)).toBe(0);
    expect(releaseB.output.results[0].complete).toBe(true);
    const pids = (await readFile(path.join(checkout, 'backend-pids.log'), 'utf8')).trim().split('\n').map(Number);
    for (const pid of pids) {
      let exitEvidence: unknown;
      try {
        process.kill(pid, 0);
      } catch (error) {
        exitEvidence = error;
      }
      expect(exitEvidence).toMatchObject({ code: 'ESRCH' });
    }
    await stop();
    await rm(checkout, { recursive: true });
    await mkdir(checkout);
    await writeFile(path.join(checkout, 'source.txt'), 'recreated-source');
    await start();
    const restarted = await cli(['project', 'status', '--format', 'json']);
    expect(restarted.code, JSON.stringify(restarted.output)).toBe(0);
    expect(restarted.output.results[0]).toMatchObject({ admission: 'draining', complete: true });
    expect((await cli(['run', 'fixture/source', '--args', '{}', '--format', 'json'], ownerA)).code).not.toBe(0);
    const resumed = await cli(['project', 'resume', '--format', 'json']);
    expect(resumed.output.results[0].admission).toBe('open');
    await expect(readFile(path.join(checkout, 'backend-pids.log'))).rejects.toThrow();
    expect((await cli(['run', 'fixture/source', '--args', '{}', '--format', 'json'], ownerA)).code).toBe(0);
    await cli(['project', 'release', '--format', 'json'], ownerA);
    await stop();
  } finally {
    if (runtime && runtime.exitCode === null) {
      const closed = new Promise<void>((resolve) => runtime!.once('exit', () => resolve()));
      runtime.kill('SIGTERM');
      await closed;
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
