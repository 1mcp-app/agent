import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const entry = path.resolve('build/index.js');
const fixtureServer = path.resolve('test/e2e/fixtures/configured-preparation-server.js');

// Positive launch acceptance is limited to the implemented containment platforms.
// Configured-command unit tests cover rejection on unsupported platforms.
describe.skipIf(process.platform !== 'linux' && process.platform !== 'darwin').each(['inline', 'referenced'] as const)(
  'configured %s preparation runtime discovery',
  (kind) => {
    it('refreshes initially empty tools across checkouts without restart or replay', async () => {
      const backend = kind === 'referenced' ? path.resolve('examples/preparation/fixture.mjs') : fixtureServer;
      const literalLabel = "local ; & 'quoted' value";
      const directory = await mkdtemp(path.join(tmpdir(), '1mcp-configured-discovery-'));
      const configDirectory = path.join(directory, 'config');
      const main = path.join(directory, 'main');
      const linked = path.join(directory, 'linked checkout ;literal');
      const independent = path.join(directory, 'independent');
      const readyCheckout = path.join(directory, 'ready');
      let runtime: ChildProcess | undefined;
      let readyClient: Client | undefined;
      let diagnostics = '';
      try {
        await mkdir(configDirectory);
        await mkdir(main);
        await mkdir(independent);
        await mkdir(readyCheckout);
        await writeFile(path.join(readyCheckout, 'source.txt'), 'unrelated-ready-576');
        await writeFile(path.join(readyCheckout, 'prepared.marker'), 'ready');
        const git = (...args: string[]) => execute('git', ['-C', main, ...args]);
        await git('init', '-q');
        await writeFile(path.join(main, 'source.txt'), 'main-source');
        await writeFile(path.join(main, '.gitignore'), '.1mcprc\n*.log\n*.marker\n');
        await git('add', '.');
        await git(
          '-c',
          'user.name=Acceptance',
          '-c',
          'user.email=acceptance@example.invalid',
          'commit',
          '-qm',
          'fixture',
        );
        await git('worktree', 'add', '--detach', linked);
        await writeFile(path.join(linked, 'source.txt'), 'linked-dirty-unique-576');
        await writeFile(path.join(independent, 'source.txt'), 'independent-unique-576');
        await execute('git', ['-C', independent, 'init', '-q']);
        const preferences = JSON.stringify({ preparation: { fixture: { enabled: true } } });
        if (kind === 'inline') {
          await writeFile(path.join(main, '.1mcprc'), preferences);
          await writeFile(path.join(independent, '.1mcprc'), preferences);
        }
        const command = (mode: string) => ({ executable: process.execPath, args: [backend, mode, '{checkout}'] });
        const configuration = {
          mcpServers: { ready: { command: process.execPath, args: [fixtureServer, 'serve', readyCheckout] } },
          mcpTemplates: {
            fixture: {
              command: process.execPath,
              args: [backend, 'serve', '{{{project.path}}}'],
              preparation:
                kind === 'referenced'
                  ? {
                      adapter: 'configured-command',
                      definition: {
                        id: 'fixture-source',
                        file: path.resolve('examples/preparation/recipe.json'),
                        inputs: { label: literalLabel },
                      },
                      activation: 'setup',
                      allowedActions: ['initialize', 'sync'],
                    }
                  : {
                      adapter: 'configured-command',
                      affectedTools: 'all',
                      allowedActions: ['initialize'],
                      integration: {
                        probe: command('probe'),
                        actions: { initialize: command('initialize') },
                        containment: 'posix-process-group',
                        readinessExitCodes: {
                          0: { state: 'ready' },
                          10: { state: 'required', action: 'initialize', instructions: 'Initialize fixture' },
                        },
                      },
                    },
            },
          },
        };
        const config = path.join(configDirectory, 'mcp.json');
        await writeFile(config, JSON.stringify(configuration));
        const port = await new Promise<number>((resolve, reject) => {
          const listener = createServer();
          listener.once('error', reject);
          listener.listen(0, '127.0.0.1', () => {
            const address = listener.address();
            if (!address || typeof address === 'string') {
              reject(new Error('No port'));
              return;
            }
            listener.close((error) => (error ? reject(error) : resolve(address.port)));
          });
        });
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
        runtime.stderr?.on('data', (chunk: Buffer) => {
          diagnostics = (diagnostics + chunk.toString()).slice(-16384);
        });
        const startupDeadline = Date.now() + 15000;
        while (true) {
          if (runtime.exitCode !== null || runtime.signalCode !== null)
            throw new Error('Runtime exited: ' + diagnostics);
          try {
            if ((await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(500) })).ok) break;
          } catch {
            /* startup */
          }
          if (Date.now() > startupDeadline) throw new Error('Runtime startup failed: ' + diagnostics);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const cli = async (checkout: string, args: string[]) => {
          const result = await execute(
            process.execPath,
            [
              entry,
              ...args,
              '--config-dir',
              configDirectory,
              '--url',
              `http://127.0.0.1:${port}/mcp`,
              '--project',
              checkout,
              '--cli-session-cache-path',
              path.join(directory, 'session-{scope}.json'),
            ],
            { timeout: 15000 },
          );
          return JSON.parse(result.stdout);
        };
        readyClient = new Client(
          { name: 'configured-preparation-ready-acceptance', version: '1' },
          { capabilities: {} },
        );
        await readyClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
        const readyTool = async () => readyClient!.callTool({ name: 'ready_1mcp_source', arguments: {} });
        expect(JSON.stringify(await readyTool())).toContain('unrelated-ready-576');
        for (const checkout of [linked, independent]) {
          const initial = await cli(checkout, ['inspect', 'fixture', '--format', 'json']);
          expect(initial.tools).toEqual([]);
          const readiness = await cli(checkout, [
            'prepare',
            'inspect',
            'fixture',
            '--operation',
            'source',
            '--format',
            'json',
          ]);
          expect(JSON.stringify(readiness)).toContain('required');
          await expect(readFile(path.join(checkout, 'preparation-started.marker'), 'utf8')).rejects.toMatchObject({
            code: 'ENOENT',
          });
          const job = await cli(checkout, ['prepare', 'start', 'fixture', '--operation', 'source', '--format', 'json']);
          expect(job).toMatchObject({ state: 'job', status: { id: expect.any(String) } });
          await expect
            .poll(() => readFile(path.join(checkout, 'preparation-started.marker'), 'utf8'), { timeout: 5000 })
            .toBe('running');
          const readyStarted = performance.now();
          const readyResult = await readyTool();
          expect(JSON.stringify(readyResult)).toContain('unrelated-ready-576');
          const readyToolLatencyMs = performance.now() - readyStarted;
          console.info(
            'Configured preparation acceptance',
            JSON.stringify({
              platform: `${process.platform}-${process.arch}`,
              node: process.version,
              checkout: checkout === linked ? 'linked' : 'independent',
              readyToolLatencyMs,
            }),
          );
          expect(readyToolLatencyMs).toBeLessThan(2500);
          await expect(readFile(path.join(checkout, 'prepared.marker'), 'utf8')).rejects.toMatchObject({
            code: 'ENOENT',
          });
          await writeFile(path.join(checkout, 'preparation-release.marker'), 'release');
          let status = job.status;
          for (let attempt = 0; attempt < 20 && status.state !== 'ready'; attempt++) {
            status = await cli(checkout, [
              'prepare',
              'wait',
              'fixture',
              job.status.id,
              '--wait-ms',
              '500',
              '--format',
              'json',
            ]);
          }
          expect(status.state).toBe('ready');
          await expect(readFile(path.join(checkout, 'operations.log'), 'utf8')).rejects.toMatchObject({
            code: 'ENOENT',
          });
          const refreshed = await cli(checkout, ['inspect', 'fixture', '--format', 'json']);
          expect(refreshed.tools).toEqual(expect.arrayContaining([expect.objectContaining({ tool: 'source' })]));
          const result = await cli(checkout, ['run', 'fixture/source', '--args', '{}', '--format', 'json']);
          expect(JSON.stringify(result)).toContain(
            checkout === linked ? 'linked-dirty-unique-576' : 'independent-unique-576',
          );
          expect(await readFile(path.join(checkout, 'preparations.log'), 'utf8')).toBe('initialize\n');
          expect(await readFile(path.join(checkout, 'operations.log'), 'utf8')).toBe('source\n');
          if (kind === 'referenced') {
            await expect(readFile(path.join(checkout, '.1mcprc'))).rejects.toMatchObject({ code: 'ENOENT' });
            expect(await readFile(path.join(checkout, 'input.txt'), 'utf8')).toBe(literalLabel);
            await writeFile(path.join(checkout, 'source.txt'), 'changed source for ' + checkout);
            const inspection = await cli(checkout, [
              'prepare',
              'inspect',
              'fixture',
              '--operation',
              'source',
              '--format',
              'json',
            ]);
            expect(JSON.stringify(inspection)).toContain('sync');
            const admission = await cli(checkout, ['run', 'fixture/source', '--args', '{}', '--format', 'json']);
            const pending = admission.result ?? admission;
            expect(pending).toMatchObject({
              operationExecuted: false,
              operationQueued: false,
              preparation: { state: 'pending' },
            });
            const sync = pending.preparation;
            let synced = sync.status;
            for (let attempt = 0; attempt < 20 && synced.state !== 'ready'; attempt++) {
              synced = await cli(checkout, [
                'prepare',
                'wait',
                'fixture',
                sync.status.id,
                '--wait-ms',
                '500',
                '--format',
                'json',
              ]);
            }
            expect(synced.state).toBe('ready');
            expect(await readFile(path.join(checkout, 'operations.log'), 'utf8')).toBe('source\n');
            expect(await readFile(path.join(checkout, 'preparations.log'), 'utf8')).toBe('initialize\nsync\n');
            const updated = await cli(checkout, ['run', 'fixture/source', '--args', '{}', '--format', 'json']);
            expect(JSON.stringify(updated)).toContain('changed source for ' + checkout);
          }
        }
        await expect(readFile(path.join(main, 'prepared.marker'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        expect(runtime.exitCode).toBeNull();
      } finally {
        await readyClient?.close();
        if (runtime && runtime.exitCode === null && runtime.signalCode === null) {
          const owned = runtime;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => owned.kill('SIGKILL'), 5000);
            timer.unref();
            owned.once('exit', () => {
              clearTimeout(timer);
              resolve();
            });
            owned.kill('SIGTERM');
          });
        }
        await rm(directory, { recursive: true, force: true });
      }
    }, 60000);
  },
);
