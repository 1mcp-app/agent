import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { describe, expect, it, vi } from 'vitest';

const deadline = 3_000;

describe('backend loss preserves real client connections', () => {
  it.each([
    { inbound: 'stdio', restartOnExit: false },
    { inbound: 'stdio', restartOnExit: true },
    { inbound: 'http', restartOnExit: false },
    { inbound: 'proxy', restartOnExit: false },
    { inbound: 'stdio', restartOnExit: true, restartDelay: 0, notificationsEnabled: false },
  ])(
    'keeps $inbound responsive with restartOnExit=$restartOnExit (notifications=$notificationsEnabled)',
    async ({ inbound, restartOnExit, restartDelay = 5_000, notificationsEnabled = true }) => {
      const directory = await mkdtemp(join(tmpdir(), '1mcp-backend-loss-'));
      const config = join(directory, 'mcp.json');
      await writeFile(
        config,
        JSON.stringify({
          mcpServers: Object.fromEntries(
            ['healthy', 'flaky'].map((name) => [
              name,
              {
                command: process.execPath,
                args: [resolve('test/e2e/fixtures/backend-loss-server.mjs'), name],
                restartOnExit: name === 'flaky' && restartOnExit,
                restartDelay,
                maxRestarts: 3,
              },
            ]),
          ),
        }),
      );
      let runtime: ChildProcess | undefined;
      let runtimeError = '';
      let url: URL | undefined;
      if (inbound !== 'stdio') {
        const listener = createServer();
        await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
        const port = (listener.address() as AddressInfo).port;
        await new Promise<void>((done, reject) => listener.close((error) => (error ? reject(error) : done())));
        url = new URL(`http://127.0.0.1:${port}/mcp`);
        runtime = spawn(
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
            '--log-level',
            'debug',
            '--log-file',
            join(directory, 'runtime.log'),
          ],
          { cwd: directory, stdio: ['ignore', 'ignore', 'pipe'] },
        );
        runtime.stderr?.on('data', (data: Buffer) => {
          runtimeError = (runtimeError + data.toString()).slice(-8_000);
        });
      }
      const transport =
        inbound === 'http'
          ? new StreamableHTTPClientTransport(url!)
          : new StdioClientTransport({
              command: process.execPath,
              cwd: directory,
              args:
                inbound === 'proxy'
                  ? [
                      resolve('build/index.js'),
                      'proxy',
                      '--url',
                      url!.href,
                      '--config-dir',
                      directory,
                      '--log-level',
                      'debug',
                      '--log-file',
                      join(directory, 'proxy.log'),
                    ]
                  : [
                      resolve('build/index.js'),
                      'serve',
                      '--transport',
                      'stdio',
                      '--config',
                      config,
                      '--config-dir',
                      directory,
                      '--enable-client-notifications',
                      String(notificationsEnabled),
                    ],
              stderr: 'pipe',
            });
      const client = new Client({ name: 'backend-loss-regression', version: '1' });
      let clientError = '';
      if (transport instanceof StdioClientTransport) {
        transport.stderr?.on('data', (data: Buffer) => {
          clientError = (clientError + data.toString()).slice(-8_000);
        });
      }
      const catalogNotes: string[] = [];
      const updates: string[] = [];
      client.setNotificationHandler(ToolListChangedNotificationSchema, (note) => {
        catalogNotes.push(note.method);
      });
      client.setNotificationHandler(ResourceListChangedNotificationSchema, (note) => {
        catalogNotes.push(note.method);
      });
      client.setNotificationHandler(PromptListChangedNotificationSchema, (note) => {
        catalogNotes.push(note.method);
      });
      client.setNotificationHandler(ResourceUpdatedNotificationSchema, (note) => {
        updates.push(note.params.uri);
      });
      try {
        if (url) {
          await vi.waitFor(
            async () => {
              expect(runtime?.exitCode, runtimeError).toBeNull();
              const response = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(1_000) });
              expect(response.ok, runtimeError).toBe(true);
            },
            { timeout: 10_000, interval: 100 },
          );
        }
        try {
          await client.connect(transport, { timeout: 10_000 });
        } catch (error) {
          const proxyLog = await readFile(join(directory, 'proxy.log'), 'utf8').catch(() => '');
          const runtimeLog = await readFile(join(directory, 'runtime.log'), 'utf8').catch(() => '');
          throw new Error(
            `Client initialize failed: ${clientError}\nRuntime: ${runtimeError}\nRuntime log: ${runtimeLog.slice(-4_000)}\nProxy: ${proxyLog.slice(-4_000)}`,
            { cause: error },
          );
        }
        const resources = await client.listResources({}, { timeout: deadline });
        const healthyUri = resources.resources.find((resource) => resource.name === 'healthy')!.uri;
        const flakyUri = resources.resources.find((resource) => resource.name === 'flaky')!.uri;
        await client.subscribeResource({ uri: healthyUri }, { timeout: deadline });
        await client.subscribeResource({ uri: flakyUri }, { timeout: deadline });
        const pidResult = await client.callTool({ name: 'flaky_1mcp_pid' }, undefined, { timeout: deadline });
        const pidContent = pidResult.content as Array<{ type: string; text: string }>;
        const pid = Number(pidContent[0].text);
        expect(pid).toBeGreaterThan(0);
        await expect(client.ping({ timeout: deadline })).resolves.toEqual({});
        catalogNotes.length = 0;
        process.kill(pid, 'SIGTERM');
        // Allow the one-second catalog owner monitor to observe the lost source.
        await delay(1_500);
        await expect(client.ping({ timeout: deadline })).resolves.toEqual({});
        await expect(
          client.callTool({ name: 'healthy_1mcp_echo' }, undefined, { timeout: deadline }),
        ).resolves.toMatchObject({ content: [{ text: 'healthy' }] });
        const tools = await client.listTools({}, { timeout: deadline });
        expect(tools.tools.map((tool) => tool.name)).toContain('healthy_1mcp_echo');
        if (restartDelay === 0) {
          await vi.waitFor(
            async () => {
              expect((await client.listTools({}, { timeout: deadline })).tools.map((tool) => tool.name)).toContain(
                'flaky_1mcp_echo',
              );
            },
            { timeout: 10_000, interval: 100 },
          );
          const replacement = await client.callTool({ name: 'flaky_1mcp_pid' }, undefined, { timeout: deadline });
          expect(Number((replacement.content as Array<{ text: string }>)[0].text)).not.toBe(pid);
          await client.callTool({ name: 'flaky_1mcp_change' }, undefined, { timeout: deadline });
          await vi.waitFor(
            async () => {
              expect((await client.listTools({}, { timeout: deadline })).tools.map((tool) => tool.name)).toContain(
                'flaky_1mcp_added',
              );
            },
            { timeout: deadline },
          );
          await expect(
            client.callTool({ name: 'flaky_1mcp_added' }, undefined, { timeout: deadline }),
          ).resolves.toMatchObject({ content: [{ text: 'flaky' }] });
          await delay(150);
          expect(catalogNotes).toEqual([]);
          return;
        }
        expect(tools.tools.map((tool) => tool.name)).not.toContain('flaky_1mcp_echo');
        if (inbound !== 'stdio') return;
        expect(
          (await client.listResources({}, { timeout: deadline })).resources.map((resource) => resource.uri),
        ).not.toContain(flakyUri);
        expect(
          (await client.listPrompts({}, { timeout: deadline })).prompts.map((prompt) => prompt.name),
        ).not.toContain('flaky_1mcp_greeting');
        await expect(
          client.callTool({ name: 'flaky_1mcp_echo' }, undefined, { timeout: deadline }),
        ).rejects.toBeDefined();
        await expect(client.readResource({ uri: flakyUri }, { timeout: deadline })).rejects.toBeDefined();
        await expect(client.getPrompt({ name: 'flaky_1mcp_greeting' }, { timeout: deadline })).rejects.toBeDefined();
        for (const method of [
          'notifications/tools/list_changed',
          'notifications/resources/list_changed',
          'notifications/prompts/list_changed',
        ]) {
          await vi.waitFor(() => expect(catalogNotes).toContain(method), { timeout: deadline });
        }
        await client.callTool({ name: 'healthy_1mcp_update' }, undefined, { timeout: deadline });
        await vi.waitFor(() => expect(updates).toContain(healthyUri), { timeout: deadline });
        if (restartOnExit) {
          catalogNotes.length = 0;
          await vi.waitFor(
            async () => {
              const recovered = await client.listTools({}, { timeout: deadline });
              expect(recovered.tools.map((tool) => tool.name)).toContain('flaky_1mcp_echo');
            },
            { timeout: 10_000, interval: 100 },
          );
          await expect(
            client.callTool({ name: 'flaky_1mcp_echo' }, undefined, { timeout: deadline }),
          ).resolves.toMatchObject({ content: [{ text: 'flaky' }] });
          const replacement = await client.callTool({ name: 'flaky_1mcp_pid' }, undefined, { timeout: deadline });
          expect(Number((replacement.content as Array<{ text: string }>)[0].text)).not.toBe(pid);
          for (const method of [
            'notifications/tools/list_changed',
            'notifications/resources/list_changed',
            'notifications/prompts/list_changed',
          ]) {
            await vi.waitFor(() => expect(catalogNotes).toContain(method), { timeout: deadline });
          }
          catalogNotes.length = 0;
          await client.callTool({ name: 'flaky_1mcp_change' }, undefined, { timeout: deadline });
          await vi.waitFor(() => expect(catalogNotes).toContain('notifications/tools/list_changed'), {
            timeout: deadline,
          });
          expect((await client.listTools({}, { timeout: deadline })).tools.map((tool) => tool.name)).toContain(
            'flaky_1mcp_added',
          );
          updates.length = 0;
          await client.callTool({ name: 'flaky_1mcp_update' }, undefined, { timeout: deadline });
          await delay(150);
          expect(updates).not.toContain(flakyUri);
          await client.subscribeResource({ uri: flakyUri }, { timeout: deadline });
          await client.callTool({ name: 'flaky_1mcp_update' }, undefined, { timeout: deadline });
          await vi.waitFor(() => expect(updates).toContain(flakyUri), { timeout: deadline });
        }
      } finally {
        await client.close();
        if (runtime && runtime.exitCode === null && runtime.signalCode === null) {
          const exited = new Promise<void>((done) => runtime!.once('exit', () => done()));
          runtime.kill('SIGTERM');
          const killTimer = setTimeout(() => runtime!.kill('SIGKILL'), 3_000);
          try {
            await exited;
          } finally {
            clearTimeout(killTimer);
          }
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
