import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { readProcessIdentity } from '@src/core/server/processIdentity.js';

import { expect, it } from 'vitest';

const binary = process.env.ONE_MCP_TEST_BINARY;
const nodeCli = process.env.ONE_MCP_TEST_NODE_CLI ?? path.resolve('build/index.js');
const executable = binary ? path.resolve(binary) : process.execPath;
const prefix = binary ? [] : [nodeCli];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function environment(): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('ONE_MCP_')) delete env[name];
  delete env.NODE_OPTIONS;
  return env;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port allocated');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function run(directory: string, args: string[]): Promise<{ code: number | null; output: string }> {
  const child = spawn(executable, [...prefix, ...args, '--config-dir', directory], {
    cwd: directory,
    env: environment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timeout: ${args.join(' ')}\n${output}`));
    }, 45_000);
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

it(
  'accepts cold 13-upstream automatic and explicit clients with five concurrent MCP initializations',
  { timeout: 180_000 },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-windows-acceptance-'));
    const journal = path.join(directory, 'calls.ndjson');
    const clients: Client[] = [];
    const evidence: Record<string, unknown> = {
      platform: process.platform,
      node: process.version,
      osRelease: os.release(),
      executableSha256: createHash('sha256')
        .update(fs.readFileSync(binary ? executable : nodeCli))
        .digest('hex'),
      artifact: binary ? 'SEA' : 'Node',
      sha: process.env.GITHUB_SHA ?? 'local-unverified-sha',
      prHead: process.env.ACCEPTANCE_PR_HEAD ?? 'local-unverified-head',
      packageSha256: process.env.ACCEPTANCE_PACKAGE_SHA256,
      synthetic: true,
      reporterSchemaAvailable: false,
      upstreams: 13,
      distinctSchemas: 156,
    };
    fs.writeFileSync(
      path.join(directory, 'mcp.json'),
      JSON.stringify({
        mcpServers: Object.fromEntries(
          Array.from({ length: 13 }, (_, index) => [
            `fixture${index}`,
            {
              type: 'stdio',
              command: process.execPath,
              args: [path.resolve('test/e2e/fixtures/windows-acceptance-server.mjs'), String(index), journal],
            },
          ]),
        ),
      }),
    );
    fs.writeFileSync(
      path.join(directory, 'config.toml'),
      '[lazyLoading]\nenabled = true\nmode = "metatool"\n[asyncLoading]\nminServers = 20\n',
    );
    evidence.reporterSettings = {
      lazyLoading: true,
      legacyMode: 'metatool (ignored by current CLI)',
      asyncMinServers: 20,
    };
    const identityStarted = performance.now();
    const diagnosticIdentity = readProcessIdentity(process.pid);
    evidence.osIdentityDiagnostic = {
      pid: process.pid,
      identity: diagnosticIdentity,
      elapsedMs: Math.round(performance.now() - identityStarted),
      path: 'test controller Node OS acquisition',
    };
    const port = await freePort();
    const started = performance.now();
    const launching = run(directory, [
      'serve',
      '--background',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--enable-lazy-loading',
    ]);
    void launching.catch(() => undefined);
    try {
      if (process.platform === 'win32') expect(diagnosticIdentity?.platform).toBe('win32');
      const deadline = Date.now() + 45_000;
      let ready = false;
      while (Date.now() < deadline) {
        try {
          ready = (await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(1000) })).ok;
        } catch {
          /* Runtime has not bound its endpoint yet. */
        }
        if (ready) break;
        await pause(50);
      }
      expect(ready).toBe(true);
      evidence.httpReadyMs = Math.round(performance.now() - started);
      const initialization = performance.now();
      const initializationResults = await Promise.allSettled(
        Array.from({ length: 5 }, async (_, index) => {
          const clientStarted = performance.now();
          const attempts: number[] = [];
          const until = Date.now() + 30_000;
          while (Date.now() < until) {
            const client = new Client({ name: `acceptance-${index}`, version: '1' }, { capabilities: {} });
            clients.push(client);
            try {
              await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)), {
                timeout: 30_000,
              });
              expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('tool_invoke');
              return { index, attempts, initializedMs: Math.round(performance.now() - clientStarted), client };
            } catch (error) {
              await client.close();
              const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
              if (code !== 503) throw error;
              attempts.push(503);
              await pause(100);
            }
          }
          throw new Error(`Client ${index} remained unavailable after ${attempts.length} startup 503 responses`);
        }),
      );
      evidence.initializations = initializationResults.map((result) =>
        result.status === 'fulfilled'
          ? {
              index: result.value.index,
              startup503s: result.value.attempts.length,
              initializedMs: result.value.initializedMs,
            }
          : { error: result.reason instanceof Error ? result.reason.message.slice(0, 500) : 'initialize failed' },
      );
      expect(initializationResults.every((result) => result.status === 'fulfilled')).toBe(true);
      const connected = initializationResults.find((result) => result.status === 'fulfilled');
      if (!connected || connected.status !== 'fulfilled') throw new Error('No initialized client');
      const activeClient = connected.value.client;
      evidence.fiveInitializeMs = Math.round(performance.now() - initialization);
      const launched = await launching;
      expect(launched.code, launched.output).toBe(0);
      const automatic = await run(directory, ['inspect', 'fixture0']);
      expect(automatic.code, automatic.output).toBe(0);
      expect(automatic.output).toContain('echo_0');
      const explicit = await run(directory, ['inspect', 'fixture0', '--url', `http://127.0.0.1:${port}`]);
      expect(explicit.code, explicit.output).toBe(0);
      expect(explicit.output).toContain('echo_0');
      for (const explicitUrl of [false, true]) {
        const proxyStarted = performance.now();
        const proxy = new Client(
          { name: explicitUrl ? 'explicit-proxy' : 'automatic-proxy', version: '1' },
          { capabilities: {} },
        );
        clients.push(proxy);
        await proxy.connect(
          new StdioClientTransport({
            command: executable,
            args: [
              ...prefix,
              'proxy',
              '--config-dir',
              directory,
              ...(explicitUrl ? ['--url', `http://127.0.0.1:${port}`] : []),
            ],
            cwd: directory,
            env: Object.fromEntries(
              Object.entries(environment()).filter((entry): entry is [string, string] => entry[1] !== undefined),
            ),
            stderr: 'pipe',
          }),
          { timeout: 30_000 },
        );
        expect((await proxy.listTools()).tools.map((tool) => tool.name)).toContain('tool_invoke');
        evidence[explicitUrl ? 'explicitProxyInitializeMs' : 'automaticProxyInitializeMs'] = Math.round(
          performance.now() - proxyStarted,
        );
      }
      const client = activeClient;
      const listed = await client.callTool({ name: 'tool_list', arguments: { limit: 200 } }, undefined, {
        timeout: 60_000,
      });
      expect(listed.isError).not.toBe(true);
      const content = listed.content as Array<{ type: string; text?: string }>;
      const tools = JSON.parse(content.find((item) => item.type === 'text')?.text ?? '{}') as { tools: unknown[] };
      expect(tools.tools).toHaveLength(156);
      const schema = await client.callTool({
        name: 'tool_schema',
        arguments: { server: 'fixture0', toolName: 'echo_0' },
      });
      expect(schema.isError).not.toBe(true);
      const invoked = await client.callTool({
        name: 'tool_invoke',
        arguments: { server: 'fixture0', toolName: 'echo_0', args: { message: 'acceptance' } },
      });
      expect(invoked.isError).not.toBe(true);
      expect(JSON.stringify(invoked)).toContain('0:acceptance');
      expect(fs.readFileSync(journal, 'utf8').trim().split('\n')).toHaveLength(1);
      const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'server.pid'), 'utf8')) as {
        pid: number;
        processIdentity?: unknown;
      };
      evidence.runtime = { pid: metadata.pid, processIdentity: metadata.processIdentity };
      const runtimeIdentityStarted = performance.now();
      const runtimeIdentity = readProcessIdentity(metadata.pid);
      evidence.runtimeOsIdentityDiagnostic = {
        pid: metadata.pid,
        identity: runtimeIdentity,
        elapsedMs: Math.round(performance.now() - runtimeIdentityStarted),
        path: 'current source OS acquisition against actual artifact runtime PID',
      };
      if (process.platform === 'win32') expect(runtimeIdentity?.platform).toBe('win32');
      const ownerFile = path.join(directory, 'runtime.owner', 'owner.json');
      const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8')) as {
        pid: number;
        kind: string;
        processIdentity?: unknown;
      };
      evidence.owner = {
        pid: owner.pid,
        kind: owner.kind,
        processIdentity: owner.processIdentity,
        identityFieldPresent: Object.hasOwn(owner, 'processIdentity'),
      };
      const originalOwner = fs.readFileSync(ownerFile, 'utf8');
      delete owner.processIdentity;
      fs.writeFileSync(ownerFile, JSON.stringify(owner));
      try {
        const missingIdentity = await run(directory, ['inspect', 'fixture0']);
        evidence.ownerIdentityRemovedAttachmentCode = missingIdentity.code;
        expect(missingIdentity.code, missingIdentity.output).toBe(0);
      } finally {
        fs.writeFileSync(ownerFile, originalOwner);
      }
      evidence.attachmentPath = 'authenticated cooperative control; legacy OS inspection not required';
      evidence.cliVersion = (await run(directory, ['--version'])).output.trim();
      evidence.totalMs = Math.round(performance.now() - started);
      evidence.testPassed = true;
    } finally {
      await Promise.allSettled(clients.map((client) => client.close()));
      await launching.catch(() => undefined);
      try {
        const stopped = await run(directory, ['serve', '--stop']);
        evidence.stopCode = stopped.code;
        expect(stopped.code, stopped.output).toBe(0);
        expect(fs.existsSync(path.join(directory, 'runtime.owner'))).toBe(false);
        fs.rmSync(directory, { recursive: true, force: true });
        evidence.cleanupPassed = true;
      } finally {
        evidence.passed = evidence.testPassed === true && evidence.cleanupPassed === true;
        evidence.scopeRetained = fs.existsSync(directory);
        const artifactDirectory = path.resolve('test-results/windows-acceptance');
        fs.mkdirSync(artifactDirectory, { recursive: true });
        fs.writeFileSync(
          path.join(artifactDirectory, `${process.platform}-${binary ? 'sea' : 'node'}.json`),
          JSON.stringify(evidence, null, 2),
        );
      }
    }
  },
);
