import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createTestProcessEnvironment } from '../../../scripts/test-process-environment.mjs';

const nodeCli = path.resolve('build/index.js');
const binary = process.env.ONE_MCP_TEST_BINARY;
const fixture = path.resolve('test/e2e/fixtures/contextual-capabilities-server.mjs');
const directories: string[] = [];
const processes = new Set<ChildProcessWithoutNullStreams>();
const cleanup: Array<() => Promise<void>> = [];
const clientInfo = { name: 'modern-context-fixture', version: '2.3.4', title: 'Context Fixture' };
const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': clientInfo,
  'io.modelcontextprotocol/clientCapabilities': {},
};
type Result = Record<string, any>;

function environment(): Record<string, string> {
  return createTestProcessEnvironment(
    {},
    Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith('ONE_MCP_'),
      ),
    ),
  ) as Record<string, string>;
}

function launch(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  const child = spawn(binary ? path.resolve(binary) : process.execPath, [...(binary ? [] : [nodeCli]), ...args], {
    cwd,
    env: environment(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  processes.add(child);
  child.once('close', () => processes.delete(child));
  return child;
}

async function cli(args: string[], cwd: string): Promise<{ code: number | null; output: string }> {
  const child = launch(args, cwd);
  let output = '';
  child.stdout.on('data', (data) => (output += String(data)));
  child.stderr.on('data', (data) => (output += String(data)));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out: ${output}`));
    }, 15000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No fixture port'));
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function runtime(): Promise<{ directory: string; project: string }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-modern-context-'));
  directories.push(directory);
  const project = path.join(directory, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(
    path.join(directory, 'mcp.json'),
    JSON.stringify({
      mcpServers: { static: { command: process.execPath, args: [fixture, 'static'], type: 'stdio' } },
      mcpTemplates: {
        contextual: {
          type: 'stdio',
          command: process.execPath,
          args: [
            fixture,
            '{{project.path}}',
            '{{transport.client.name}}',
            '{{transport.client.version}}',
            '{{transport.client.title}}',
          ],
          template: { perClient: true },
        },
      },
    }),
  );
  const started = await cli(
    ['serve', '--background', '--config-dir', directory, '--host', '127.0.0.1', '--port', String(await freePort())],
    directory,
  );
  cleanup.push(async () => {
    const stopped = await cli(['serve', '--stop', '--config-dir', directory], directory);
    expect(stopped.code, stopped.output).toBe(0);
  });
  expect(started.code, started.output).toBe(0);
  return { directory, project: fs.realpathSync(project) };
}

function proxy(directory: string, project: string, modern: boolean) {
  const child = launch(['proxy', '--config-dir', directory], project);
  let buffer = '';
  let stderr = '';
  let id = 0;
  const pending = new Map<
    number,
    { resolve: (value: Result) => void; reject: (error: Error) => void; method: string }
  >();
  child.stderr.on('data', (data) => (stderr += String(data)));
  child.stdout.on('data', (data) => {
    buffer += String(data);
    for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const response = JSON.parse(line) as Result;
      const waiter = pending.get(response.id);
      if (!waiter) continue;
      pending.delete(response.id);
      if (response.error) waiter.reject(new Error(`${waiter.method}: ${JSON.stringify(response.error)}`));
      else waiter.resolve(response.result);
    }
  });
  child.once('close', () => {
    for (const waiter of pending.values()) waiter.reject(new Error(`Proxy exited: ${stderr}`));
    pending.clear();
  });
  const request = (method: string, params: Result = {}): Promise<Result> => {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Proxy request timed out: ${method}: ${stderr}`));
      }, 12000);
      pending.set(requestId, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          method,
          params: modern ? { ...params, _meta: { ...params._meta, ...modernMeta } } : params,
        }) + '\n',
      );
    });
  };
  return {
    request,
    async connect() {
      if (modern) return request('server/discover');
      const result = await request('initialize', { protocolVersion: '2025-06-18', clientInfo, capabilities: {} });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      return result;
    },
  };
}

function toolName(list: Result, server: string): string {
  const tool = list.tools.find((entry: { name: string }) => entry.name.startsWith(`${server}_1mcp_`));
  expect(tool, `Missing ${server} tool`).toBeDefined();
  return tool.name;
}

function facts(result: Result): Result {
  return JSON.parse(result.content[0].text) as Result;
}

beforeAll(() => {
  expect(fs.existsSync(nodeCli), 'Build before template-context E2E').toBe(true);
  if (binary) expect(fs.existsSync(binary)).toBe(true);
});

afterEach(async () => {
  for (const child of processes) child.kill();
  for (const stop of cleanup.splice(0).reverse()) await stop();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('real proxy HTTP contextual templates', () => {
  it.each([true, false])('prepares and reuses contextual capabilities (modern: %s)', async (modern) => {
    const { directory, project } = await runtime();
    const client = proxy(directory, project, modern);
    const discovered = await client.connect();
    expect(discovered.instructions ?? '').toContain('contextual fixture instructions');
    const listed = await client.request('tools/list');
    toolName(listed, 'static');
    const name = toolName(listed, 'contextual');
    const first = facts(
      await client.request('tools/call', {
        name,
        arguments: {},
        _meta: {
          context: { caller: 'untrusted' },
          contextProof: { signature: 'caller-secret' },
          'caller/custom': 'private',
        },
      }),
    );
    expect(first).toMatchObject({
      project,
      clientName: clientInfo.name,
      clientVersion: clientInfo.version,
      clientTitle: clientInfo.title,
      calls: 1,
    });
    if (modern) {
      expect(first.meta).not.toHaveProperty('context');
      expect(first.meta).not.toHaveProperty('contextProof');
      expect(first.meta).not.toHaveProperty('caller/custom');
    }
    const concurrent = await Promise.all(Array.from({ length: 3 }, () => client.request('tools/list')));
    for (const result of concurrent) expect(toolName(result, 'contextual')).toBe(name);
    const second = facts(await client.request('tools/call', { name, arguments: {} }));
    expect(second).toMatchObject({ instance: first.instance, calls: 2 });
    const resources = await client.request('resources/list');
    const resource = resources.resources.find((entry: { name: string }) => entry.name === 'contextual-facts');
    expect(resource).toBeDefined();
    const read = await client.request('resources/read', { uri: resource.uri });
    expect(JSON.parse(read.contents[0].text)).toMatchObject({ instance: first.instance, project });
    const templates = await client.request('resources/templates/list');
    expect(
      templates.resourceTemplates.some((entry: { name: string }) => entry.name === 'contextual-dynamic-facts'),
    ).toBe(true);
    const prompts = await client.request('prompts/list');
    const prompt = prompts.prompts.find((entry: { name: string }) => entry.name.startsWith('contextual_1mcp_'));
    expect(prompt).toBeDefined();
    const rendered = await client.request('prompts/get', { name: prompt.name });
    expect(JSON.parse(rendered.messages[0].content.text)).toMatchObject({ instance: first.instance, project });
    const other = proxy(directory, project, modern);
    await other.connect();
    const otherName = toolName(await other.request('tools/list'), 'contextual');
    const independent = facts(await other.request('tools/call', { name: otherName, arguments: {} }));
    expect(independent).toMatchObject({ project, calls: 1 });
    expect(independent.instance).not.toBe(first.instance);
    expect(facts(await client.request('tools/call', { name, arguments: {} }))).toMatchObject({
      instance: first.instance,
      calls: 3,
    });
  });
});
