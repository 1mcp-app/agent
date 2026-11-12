import { CommandTestEnvironment } from '@test/e2e/utils/CommandTestEnvironment.js';
import { McpTestClient } from '@test/e2e/utils/McpTestClient.js';
import { TestProcessManager } from '@test/e2e/utils/TestProcessManager.js';

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  CallToolResultSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

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

describe('Backend Sleep through the built runtime', () => {
  it('wakes resource, prompt and subscription handlers while leaving an independent daemon alive', async () => {
    const environment = new CommandTestEnvironment({ name: 'backend-sleep-capabilities' });
    await environment.setup();
    const directory = environment.getTempDir();
    const processManager = new TestProcessManager();
    const daemonRecord = join(directory, 'daemon.json');
    const env = { ...environment.getEnvironmentVariables(), HOME: directory, USERPROFILE: directory };
    const names = ['reader', 'prompter', 'watcher', 'wrapper'];
    const eventsPath = (name: string) => join(directory, `${name}.jsonl`);
    let client: McpTestClient | undefined;
    let daemonPid: number | undefined;
    try {
      const daemon = await processManager.startProcess('independent-daemon', {
        command: process.execPath,
        args: [resolve('test/e2e/fixtures/backend-sleep-daemon.mjs'), daemonRecord],
        env,
      });
      daemonPid = daemon.pid;
      let daemonUrl = '';
      await vi.waitFor(async () => {
        const address = JSON.parse(await readFile(daemonRecord, 'utf8')) as { pid: number; port: number };
        expect(address.pid).toBe(daemonPid);
        daemonUrl = `http://127.0.0.1:${address.port}`;
      });
      const config = join(environment.getConfigDir(), 'mcp.json');
      await writeFile(
        config,
        JSON.stringify({
          mcpServers: Object.fromEntries(
            names.map((name) => [
              name,
              {
                command: process.execPath,
                args: [resolve('test/e2e/fixtures/backend-sleep-capabilities.mjs'), eventsPath(name), name, daemonUrl],
                protocolVersion: 'legacy',
                sleep: { enabled: true, idleTimeoutMs: 30_000 },
              },
            ]),
          ),
        }),
      );
      client = new McpTestClient({
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
            '--log-file',
            join(directory, 'runtime.log'),
            '--log-level',
            'debug',
          ],
          env,
        },
      });
      const sdk = client.getClient();
      const updates: string[] = [];
      sdk.setNotificationHandler(ResourceUpdatedNotificationSchema, (note) => {
        updates.push(note.params.uri);
      });
      await client.connect();
      const resources = await sdk.listResources();
      const prompts = await sdk.listPrompts();
      const resource = (name: string) => {
        const result = resources.resources.find((entry) => entry.name === name);
        if (!result) throw new Error(`Missing resource for ${name}`);
        return result.uri;
      };
      const prompt = prompts.prompts.find((entry) => entry.description === 'prompter');
      expect(prompt).toBeDefined();
      await sdk.subscribeResource({ uri: resource('watcher') });
      expect((await client.callTool('watcher_1mcp_notify')).isError).not.toBe(true);
      await vi.waitFor(() => expect(updates).toContain(resource('watcher')), { timeout: 5_000, interval: 50 });
      await sdk.unsubscribeResource({ uri: resource('watcher') });
      updates.length = 0;
      const initialPids = await Promise.all(names.map(async (name) => (await readEvents(eventsPath(name)))[0].pid));
      await vi.waitFor(
        async () => {
          expect(await sdk.listResources()).toEqual(resources);
          expect(await sdk.listPrompts()).toEqual(prompts);
          expect(initialPids.filter(isAlive)).toEqual([]);
        },
        { timeout: 75_000, interval: 500 },
      );
      // The daemon belongs to this test, not to a wrapper. Releasing the runtime's
      // wrappers must leave that independent service alive and responsive.
      expect(isAlive(daemonPid)).toBe(true);
      expect(await (await fetch(daemonUrl)).json()).toEqual({ pid: daemonPid });
      for (const name of names) {
        expect((await readEvents(eventsPath(name))).filter((event) => event.event === 'start')).toHaveLength(1);
      }
      const [read, greeting, subscription, shared] = await Promise.all([
        sdk.readResource({ uri: resource('reader') }),
        sdk.getPrompt({ name: prompt!.name }),
        sdk.subscribeResource({ uri: resource('watcher') }),
        client.callTool('wrapper_1mcp_daemon'),
      ]);
      expect(subscription).toEqual({});
      expect(shared.isError).not.toBe(true);
      expect(shared.content).toEqual([{ type: 'text', text: JSON.stringify({ pid: daemonPid }) }]);
      expect((await client.callTool('watcher_1mcp_notify')).isError).not.toBe(true);
      await vi.waitFor(() => expect(updates).toContain(resource('watcher')), { timeout: 5_000, interval: 50 });
      await sdk.unsubscribeResource({ uri: resource('watcher') });
      const expected = new Map([
        ['reader', ['resources/read']],
        ['prompter', ['prompts/get']],
        ['watcher', ['resources/subscribe', 'tools/call', 'resources/unsubscribe']],
        ['wrapper', ['tools/call']],
      ]);
      for (const [index, name] of names.entries()) {
        const events = await readEvents(eventsPath(name));
        const starts = events.filter((event) => event.event === 'start');
        expect(starts).toHaveLength(2);
        expect(starts[1].pid).not.toBe(initialPids[index]);
        expect(isAlive(starts[1].pid)).toBe(true);
        expect(
          events
            .filter((event) => event.event === 'dispatch' && event.pid === starts[1].pid)
            .map((event) => event.message),
        ).toEqual(expected.get(name));
        if (name === 'reader') {
          expect(read.contents).toEqual([{ uri: resource('reader'), text: `reader from ${starts[1].pid}` }]);
        }
        if (name === 'prompter') {
          expect(greeting.messages).toEqual([
            { role: 'user', content: { type: 'text', text: `prompter from ${starts[1].pid}` } },
          ]);
        }
      }
      expect(isAlive(daemonPid)).toBe(true);
    } catch (error) {
      const logs = await readFile(join(directory, 'runtime.log'), 'utf8').catch(() => 'No runtime log');
      const events = await Promise.all(names.map(async (name) => [name, await readEvents(eventsPath(name))]));
      throw new Error(`Backend capability wake failed: ${JSON.stringify(events)}\n${logs.slice(-12_000)}`, {
        cause: error,
      });
    } finally {
      try {
        await client?.disconnect();
        const events = (await Promise.all(names.map((name) => readEvents(eventsPath(name))))).flat();
        const ownedPids = events.filter((event) => event.event === 'start').map((event) => event.pid);
        await vi.waitFor(() => expect(ownedPids.filter(isAlive)).toEqual([]), { timeout: 5_000, interval: 50 });
        if (daemonPid) expect(isAlive(daemonPid)).toBe(true);
      } finally {
        await processManager.cleanup();
        if (daemonPid) expect(isAlive(daemonPid)).toBe(false);
        await environment.cleanup();
      }
    }
  }, 100_000);

  it.each([false, true])(
    'keeps default-off backends alive and wakes opted-in backends once (lazy=%s)',
    async (lazy) => {
      const environment = new CommandTestEnvironment({ name: 'backend-sleep' });
      await environment.setup();
      const directory = environment.getTempDir();
      const gate = join(directory, 'allow-wake');
      const sleeperEvents = join(directory, 'sleeper.jsonl');
      const residentEvents = join(directory, 'resident.jsonl');
      const fixture = resolve('test/e2e/fixtures/backend-sleep-server.mjs');
      const config = join(environment.getConfigDir(), 'mcp.json');
      const backend = (events: string) => ({
        command: process.execPath,
        args: [fixture, events, gate],
        protocolVersion: 'legacy',
        disabledTools: ['forbidden'],
        restartOnExit: true,
        restartDelay: 10,
      });
      await writeFile(
        config,
        JSON.stringify({
          mcpServers: {
            sleeper: { ...backend(sleeperEvents), sleep: { enabled: true, idleTimeoutMs: 30_000 } },
            resident: backend(residentEvents),
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
            '--log-file',
            join(directory, 'runtime.log'),
            '--log-level',
            'debug',
            '--enable-lazy-loading',
            String(lazy),
            '--enable-client-notifications',
            'true',
          ],
          env: { ...environment.getEnvironmentVariables(), HOME: directory, USERPROFILE: directory },
        },
      });
      const changes: string[] = [];
      client.getClient().setNotificationHandler(ToolListChangedNotificationSchema, (note) => {
        changes.push(note.method);
      });
      const call = (server: string, message: string, signal?: AbortSignal) =>
        client.getClient().request(
          {
            method: 'tools/call',
            params: lazy
              ? { name: 'tool_invoke', arguments: { server, toolName: 'record', args: { message } } }
              : { name: `${server}_1mcp_record`, arguments: { message } },
          },
          CallToolResultSchema,
          { timeout: 15_000, signal },
        );
      try {
        try {
          await client.connect();
        } catch (error) {
          const logs = await readFile(join(directory, 'runtime.log'), 'utf8').catch(() => 'No runtime log');
          throw new Error(`SDK connection failed: ${logs.slice(-8_000)}`, { cause: error });
        }
        const listed = await client.listTools();
        const names = listed.tools.map((tool) => tool.name);
        if (lazy) {
          expect(names).toEqual(expect.arrayContaining(['tool_list', 'tool_schema', 'tool_invoke']));
          expect(names).not.toContain('sleeper_1mcp_record');
        } else {
          expect(names).toEqual(expect.arrayContaining(['sleeper_1mcp_record', 'resident_1mcp_record']));
          expect(names).not.toContain('sleeper_1mcp_forbidden');
        }
        const initialPid = (await readEvents(sleeperEvents))[0].pid;
        const residentPid = (await readEvents(residentEvents))[0].pid;
        expect(isAlive(initialPid)).toBe(true);
        expect(isAlive(residentPid)).toBe(true);
        changes.length = 0;

        // The production 30-second sweep and timeout are unchanged. Discovery throughout
        // expiry must neither reset the idle baseline nor wake the process after exit.
        await vi.waitFor(
          async () => {
            expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(names);
            expect(isAlive(initialPid)).toBe(false);
          },
          { timeout: 75_000, interval: 500 },
        );
        expect(isAlive(residentPid)).toBe(true);
        expect(changes).toEqual([]);
        expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(names);
        if (lazy) {
          const listed = await client.callTool('tool_list');
          expect(JSON.stringify(listed)).toContain('record');
          expect(JSON.stringify(listed)).not.toContain('forbidden');
          const schema = await client.callTool('tool_schema', { server: 'sleeper', toolName: 'record' });
          expect(schema.isError).not.toBe(true);
          expect(JSON.stringify(schema)).toContain('message');
        }
        const forbidden = await client
          .callTool(
            lazy ? 'tool_invoke' : 'sleeper_1mcp_forbidden',
            lazy
              ? { server: 'sleeper', toolName: 'forbidden', args: { message: 'forbidden' } }
              : { message: 'forbidden' },
          )
          .then(
            (result) => {
              if (!lazy) return result.isError;
              const content = result.content[0];
              if (content.type !== 'text') throw new Error('Expected a meta-tool JSON response');
              return JSON.parse(content.text).error;
            },
            (error: unknown) => error,
          );
        expect(forbidden).toBeTruthy();
        expect((await readEvents(sleeperEvents)).filter((event) => event.event === 'start')).toHaveLength(1);

        const canceled = new AbortController();
        const canceledCall = call('sleeper', 'canceled', canceled.signal).catch((error: unknown) => error);
        const first = call('sleeper', 'first');
        const second = call('sleeper', 'second');
        await vi.waitFor(
          async () => {
            expect((await readEvents(sleeperEvents)).filter((event) => event.event === 'start')).toHaveLength(2);
          },
          { timeout: 10_000, interval: 50 },
        );
        canceled.abort();
        expect(await canceledCall).toBeInstanceOf(Error);
        await writeFile(gate, 'ready');
        const results = await Promise.all([first, second]);
        for (const result of results) expect(result.isError).not.toBe(true);
        expect(JSON.stringify(results[0])).toContain('first');
        expect(JSON.stringify(results[1])).toContain('second');
        const events = await readEvents(sleeperEvents);
        const starts = events.filter((event) => event.event === 'start');
        expect(starts).toHaveLength(2);
        expect(starts[1].pid).not.toBe(initialPid);
        expect(isAlive(starts[1].pid)).toBe(true);
        expect(
          events
            .filter((event) => event.event === 'dispatch')
            .map((event) => event.message)
            .sort(),
        ).toEqual(['first', 'second']);
        expect((await call('resident', 'still-connected')).isError).not.toBe(true);
        expect((await readEvents(residentEvents)).filter((event) => event.event === 'start')).toEqual([
          { pid: residentPid, event: 'start' },
        ]);
      } catch (error) {
        const logs = await readFile(join(directory, 'runtime.log'), 'utf8').catch(() => 'No runtime log');
        const events = await readEvents(sleeperEvents);
        throw new Error(`Backend Sleep journey failed: ${JSON.stringify(events)}\n${logs.slice(-12_000)}`, {
          cause: error,
        });
      } finally {
        try {
          await client.disconnect();
          const owned = [...(await readEvents(sleeperEvents)), ...(await readEvents(residentEvents))]
            .filter((event) => event.event === 'start')
            .map((event) => event.pid);
          await vi.waitFor(() => expect(owned.filter(isAlive)).toEqual([]), { timeout: 5_000, interval: 50 });
        } finally {
          await environment.cleanup();
        }
      }
    },
    100_000,
  );
});
