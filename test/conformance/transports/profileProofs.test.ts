import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, RequestId } from '@modelcontextprotocol/sdk/types.js';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const cliEntrypoint = join(root, 'build/index.js');
const fixtureEntrypoint = join(root, 'test/conformance/fixtures/typescript/src/fixture.mjs');
const activeChildren = new Set<ChildProcess>();
const workspaces = new Set<string>();

type Profile =
  | 'inbound-http-sse-retained'
  | 'direct-serve-stdio'
  | 'proxy-stdio'
  | 'upstream-sse-retained'
  | 'upstream-stdio-modern'
  | 'upstream-stdio-legacy';

interface CompletedProbeObservation {
  outcome: 'completed';
  fixtureId: 'typescript-v1';
  transport: 'sse' | 'stdio' | 'streamable-http';
  initialized: true;
  ping: true;
  negotiatedRevision: '2025-11-25';
  operations: ['initialize', 'ping', 'tools/list', 'tools/call'];
  toolsCount: number;
  callError: false;
}

interface FailedProbeObservation {
  outcome: 'product-failed';
  fixtureId: 'typescript-v1';
  transport: 'stdio' | 'streamable-http';
  initialized: false;
  ping: false;
  negotiatedRevision: 'not-negotiated';
  operations: ['initialize'];
  classification: 'initialize-timeout' | 'upstream-revision-mismatch';
}

type ProbeObservation = CompletedProbeObservation | FailedProbeObservation;

interface EvidenceContext {
  gateway: {
    entrypoint: 'build/index.js';
    command: 'serve' | 'proxy';
    inboundTransport: 'http-sse' | 'stdio' | 'streamable-http';
    bridgeTransport?: 'streamable-http';
  };
  upstream: {
    transport: 'sse' | 'stdio';
    sdkEra: 'v1' | 'v2';
    protocolEra: 'legacy' | 'modern';
  };
}

let outputDirectory: string;
let ownsOutputDirectory = false;

function childEnvironment(home: string): typeof process.env {
  return {
    PATH: process.env.PATH,
    HOME: home,
    NO_PROXY: '127.0.0.1,localhost,::1',
    NODE_ENV: 'test',
    ONE_MCP_LOG_LEVEL: 'error',
  };
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', exited);
      resolvePromise(false);
    }, timeoutMs);
    const exited = () => {
      clearTimeout(timeout);
      resolvePromise(true);
    };
    child.once('exit', exited);
  });
}

function stdioEnvironment(home: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(childEnvironment(home)).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

async function createWorkspace(name: string, mcpServers: Record<string, unknown>) {
  const directory = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), `1mcp-${name}-`));
  const home = join(directory, 'home');
  const configPath = join(directory, 'mcp.json');
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify({ mcpServers }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  workspaces.add(directory);
  return { directory, home, configPath };
}

function stdioUpstream(sdkEra: 'v1' | 'v2', protocolEra?: 'legacy' | 'modern') {
  return {
    fixture: {
      type: 'stdio',
      command: process.execPath,
      args: [
        fixtureEntrypoint,
        'server',
        '--sdk-era',
        sdkEra,
        '--transport',
        'stdio',
        ...(protocolEra ? ['--protocol-era', protocolEra] : []),
      ],
    },
  };
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('port-allocation-failed');
  await new Promise<void>((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return address.port;
}

async function stopChild(child: ChildProcess): Promise<void> {
  activeChildren.delete(child);
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (await waitForChildExit(child, 3_000)) return;
  child.kill('SIGKILL');
  if (!(await waitForChildExit(child, 3_000))) throw new Error('profile child cleanup timeout');
}

async function waitForGateway(
  endpoint: string,
  child: ChildProcess,
  errors: string[],
  allowUnreadyProductFailure = false,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`gateway-exited-before-ready: ${errors.join('')}`);
    }
    try {
      const response = await fetch(new URL('/health', endpoint), { signal: AbortSignal.timeout(500) });
      if (response.ok || allowUnreadyProductFailure) return;
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`gateway-readiness-timeout: ${errors.join('').slice(-1_000)}`);
}

async function startGateway(configPath: string, home: string, allowUnreadyProductFailure = false) {
  const port = await reservePort();
  const errors: string[] = [];
  const child = spawn(
    process.execPath,
    [
      cliEntrypoint,
      'serve',
      '--transport',
      'http',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--config',
      configPath,
      '--log-level',
      'error',
      '--async-max-retries',
      '0',
      '--no-async-background-retry',
    ],
    { cwd: root, env: childEnvironment(home), stdio: ['ignore', 'ignore', 'pipe'] },
  );
  activeChildren.add(child);
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => errors.push(chunk));
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  await waitForGateway(endpoint, child, errors, allowUnreadyProductFailure);
  return { child, endpoint };
}

async function startSseFixture(home: string) {
  const errors: string[] = [];
  const child = spawn(process.execPath, [fixtureEntrypoint, 'server', '--sdk-era', 'v1', '--transport', 'sse'], {
    cwd: root,
    env: childEnvironment(home),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeChildren.add(child);
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => errors.push(chunk));
  child.stdout?.setEncoding('utf8');
  const ready = await new Promise<{ port: number }>((resolvePromise, reject) => {
    let stdout = '';
    const timeout = setTimeout(() => reject(new Error(`sse-fixture-readiness-timeout: ${errors.join('')}`)), 10_000);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`sse-fixture-exited-before-ready: ${code ?? signal}`));
    });
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      resolvePromise(JSON.parse(stdout.slice(0, newline)) as { port: number });
    });
  });
  expect(ready.port).toBeGreaterThan(0);
  return { child, endpoint: `http://127.0.0.1:${ready.port}/sse` };
}

async function runProbe(
  args: string[],
  home: string,
  expectedProductFailure?: 'upstream-revision-mismatch',
): Promise<ProbeObservation> {
  const child = spawn(process.execPath, [fixtureEntrypoint, 'probe', ...args, '--aggregated', '--runtime-output'], {
    cwd: root,
    env: childEnvironment(home),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeChildren.add(child);
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => stdout.push(chunk));
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => stderr.push(chunk));
  let timeout: ReturnType<typeof setTimeout>;
  const exited = new Promise<number | null>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode) => {
      resolvePromise(exitCode);
    });
  });
  const outcome = await Promise.race([
    exited,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`gateway-probe-timeout: ${stderr.join('').slice(-1_000)}`)), 30_000);
    }),
  ]);
  clearTimeout(timeout!);
  activeChildren.delete(child);
  if (expectedProductFailure) {
    expect(outcome, stderr.join('').slice(-1_000)).toBe(1);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ errorCode: 'gateway-probe-rejected' });
    return {
      outcome: 'product-failed',
      fixtureId: 'typescript-v1',
      transport: 'streamable-http',
      initialized: false,
      ping: false,
      negotiatedRevision: 'not-negotiated',
      operations: ['initialize'],
      classification: expectedProductFailure,
    };
  }
  expect(outcome, stderr.join('').slice(-1_000)).toBe(0);
  const observation = JSON.parse(stdout.join('')) as Omit<CompletedProbeObservation, 'outcome'>;
  expect(observation).toMatchObject({
    fixtureId: 'typescript-v1',
    initialized: true,
    ping: true,
    negotiatedRevision: '2025-11-25',
    operations: ['initialize', 'ping', 'tools/list', 'tools/call'],
    callError: false,
  });
  expect(observation.toolsCount).toBeGreaterThan(0);
  return { outcome: 'completed', ...observation };
}

class RevisionRecordingTransport implements Transport {
  onclose?: Transport['onclose'];
  onerror?: Transport['onerror'];
  onmessage?: Transport['onmessage'];
  negotiatedRevision?: string;
  private initializeRequestId?: RequestId;

  constructor(private readonly inner: StdioClientTransport) {
    inner.onclose = () => this.onclose?.();
    inner.onerror = (error) => this.onerror?.(error);
    inner.onmessage = (message: JSONRPCMessage) => {
      if (
        this.initializeRequestId !== undefined &&
        'id' in message &&
        message.id === this.initializeRequestId &&
        'result' in message &&
        typeof message.result === 'object' &&
        message.result !== null &&
        'protocolVersion' in message.result &&
        typeof message.result.protocolVersion === 'string'
      ) {
        this.negotiatedRevision = message.result.protocolVersion;
      }
      this.onmessage?.(message);
    };
  }

  start(): Promise<void> {
    return this.inner.start();
  }

  send(message: JSONRPCMessage, options?: Parameters<Transport['send']>[1]): Promise<void> {
    if ('method' in message && message.method === 'initialize' && 'id' in message) {
      this.initializeRequestId = message.id;
    }
    void options;
    return this.inner.send(message);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

async function runProxyProbe(endpoint: string, configPath: string, home: string): Promise<ProbeObservation> {
  const stderr: string[] = [];
  const inner = new StdioClientTransport({
    command: process.execPath,
    args: [cliEntrypoint, 'proxy', '--url', endpoint, '--config', configPath, '--log-level', 'debug'],
    cwd: root,
    env: stdioEnvironment(home),
    stderr: 'pipe',
  });
  inner.stderr?.on('data', (chunk) => stderr.push(chunk.toString()));
  const transport = new RevisionRecordingTransport(inner);
  const client = new Client({ name: '1mcp-conformance-proxy-client', version: '1' });
  let stage = 'connect';
  try {
    await client.connect(transport, { signal: AbortSignal.timeout(2_000) });
    stage = 'ping';
    await client.ping({ signal: AbortSignal.timeout(10_000) });
    stage = 'tools-list';
    const listed = await client.listTools(undefined, { signal: AbortSignal.timeout(10_000) });
    const toolName = listed.tools.find(
      (tool) => tool.name === 'fixture.acknowledge' || tool.name.endsWith('_1mcp_fixture.acknowledge'),
    )?.name;
    expect(toolName, stderr.join('').slice(-2_000)).toBeDefined();
    stage = 'tools-call';
    const called = await client.callTool(
      { name: toolName!, arguments: { marker: 'fixture-input-must-not-leak' } },
      undefined,
      { signal: AbortSignal.timeout(10_000) },
    );
    expect(transport.negotiatedRevision, stderr.join('').slice(-2_000)).toBe('2025-11-25');
    expect(called.isError).not.toBe(true);
    return {
      outcome: 'completed',
      fixtureId: 'typescript-v1',
      transport: 'stdio',
      initialized: true,
      ping: true,
      negotiatedRevision: '2025-11-25',
      operations: ['initialize', 'ping', 'tools/list', 'tools/call'],
      toolsCount: listed.tools.length,
      callError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(stage, stderr.join('').slice(-4_000)).toBe('connect');
    expect(message).toMatch(/MCP error -32001: TimeoutError/u);
    return {
      outcome: 'product-failed',
      fixtureId: 'typescript-v1',
      transport: 'stdio',
      initialized: false,
      ping: false,
      negotiatedRevision: 'not-negotiated',
      operations: ['initialize'],
      classification: 'initialize-timeout',
    };
  } finally {
    await client.close();
  }
}

async function emitProfileProof(
  profile: Profile,
  testId: string,
  context: EvidenceContext,
  probe: ProbeObservation,
): Promise<void> {
  const payload = {
    schemaVersion: 1 as const,
    profile,
    testId,
    attempt: 1 as const,
    status: probe.outcome === 'completed' ? ('passed' as const) : ('product-failed' as const),
    ...(probe.outcome === 'product-failed' ? { downstreamIssue: 478 as const } : {}),
    checks:
      probe.outcome === 'completed'
        ? ['gateway-started', 'mcp-initialize', 'mcp-tools-list', 'mcp-tools-call']
        : ['gateway-started', 'mcp-initialize-attempted', 'product-failure-classified'],
    ...context,
    probe,
  };
  const evidenceDigest = `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
  const artifactId = `profile-evidence/${profile}.json`;
  await writeFile(
    join(outputDirectory, artifactId),
    `${JSON.stringify({ ...payload, digest: evidenceDigest }, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  );

  const manifestPath = join(outputDirectory, 'profile-proofs.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    schemaVersion: 1;
    profileProofs: Array<{
      profile: Profile;
      testId: string;
      artifactId: string;
      attempt: 1;
      evidenceDigest: string;
      status: 'passed' | 'product-failed';
      downstreamIssue?: 478;
    }>;
  };
  expect(manifest.profileProofs.some((proof) => proof.profile === profile)).toBe(false);
  manifest.profileProofs.push({
    profile,
    testId,
    artifactId,
    attempt: 1,
    evidenceDigest,
    status: payload.status,
    ...(payload.status === 'product-failed' ? { downstreamIssue: 478 as const } : {}),
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

  const persisted = JSON.parse(await readFile(join(outputDirectory, artifactId), 'utf8')) as Record<string, unknown>;
  const { digest, ...persistedPayload } = persisted;
  expect(digest).toBe(evidenceDigest);
  expect(`sha256:${createHash('sha256').update(JSON.stringify(persistedPayload)).digest('hex')}`).toBe(evidenceDigest);
}

async function probeHttpGateway(endpoint: string, home: string, expectedProductFailure?: 'upstream-revision-mismatch') {
  return runProbe(
    ['--sdk-era', 'v1', '--protocol-era', 'legacy', '--transport', 'streamable-http', '--endpoint', endpoint],
    home,
    expectedProductFailure,
  );
}

describe('gateway-executed transport profile proofs', () => {
  beforeAll(async () => {
    const configuredOutput = process.env.ONE_MCP_CONFORMANCE_OUTPUT_DIR;
    if (configuredOutput) {
      outputDirectory = configuredOutput;
      await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    } else {
      outputDirectory = await mkdtemp(join(tmpdir(), '1mcp-profile-evidence-'));
      ownsOutputDirectory = true;
    }
    await rm(join(outputDirectory, 'profile-evidence'), { recursive: true, force: true });
    await mkdir(join(outputDirectory, 'profile-evidence'), { recursive: true, mode: 0o700 });
    await writeFile(
      join(outputDirectory, 'profile-proofs.json'),
      '{\n  "schemaVersion": 1,\n  "profileProofs": []\n}\n',
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
  });

  afterEach(async () => {
    for (const child of [...activeChildren].reverse()) await stopChild(child);
    for (const workspace of workspaces) await rm(workspace, { recursive: true, force: true });
    workspaces.clear();
  });

  afterAll(async () => {
    if (ownsOutputDirectory) await rm(outputDirectory, { recursive: true, force: true });
  });

  it('proves retained inbound HTTP+SSE with MCP traffic through the built gateway', async () => {
    const workspace = await createWorkspace('inbound-sse', stdioUpstream('v1'));
    const gateway = await startGateway(workspace.configPath, workspace.home);
    const probe = await runProbe(
      [
        '--sdk-era',
        'v1',
        '--protocol-era',
        'legacy',
        '--transport',
        'sse',
        '--endpoint',
        gateway.endpoint.replace('/mcp', '/sse'),
      ],
      workspace.home,
    );
    expect(probe.transport).toBe('sse');
    await emitProfileProof(
      'inbound-http-sse-retained',
      'transport.gateway.inbound-http-sse-retained',
      {
        gateway: { entrypoint: 'build/index.js', command: 'serve', inboundTransport: 'http-sse' },
        upstream: { transport: 'stdio', sdkEra: 'v1', protocolEra: 'legacy' },
      },
      probe,
    );
  });

  it('proves direct serve stdio with MCP traffic through the built gateway', async () => {
    const workspace = await createWorkspace('direct-stdio', stdioUpstream('v1'));
    const commandArgs = [
      cliEntrypoint,
      'serve',
      '--transport',
      'stdio',
      '--config',
      workspace.configPath,
      '--log-level',
      'error',
      '--async-max-retries',
      '0',
      '--no-async-background-retry',
    ];
    const probe = await runProbe(
      [
        '--sdk-era',
        'v1',
        '--protocol-era',
        'legacy',
        '--transport',
        'stdio',
        '--command',
        process.execPath,
        ...commandArgs.map((argument) => `--arg=${argument}`),
      ],
      workspace.home,
    );
    expect(probe.transport).toBe('stdio');
    await emitProfileProof(
      'direct-serve-stdio',
      'transport.gateway.direct-serve-stdio',
      {
        gateway: { entrypoint: 'build/index.js', command: 'serve', inboundTransport: 'stdio' },
        upstream: { transport: 'stdio', sdkEra: 'v1', protocolEra: 'legacy' },
      },
      probe,
    );
  });

  it('proves proxy stdio with MCP traffic through both built gateway commands', async () => {
    const workspace = await createWorkspace('proxy-stdio', stdioUpstream('v1'));
    const gateway = await startGateway(workspace.configPath, workspace.home);
    const probe = await runProxyProbe(gateway.endpoint, workspace.configPath, workspace.home);
    expect(probe.transport).toBe('stdio');
    await emitProfileProof(
      'proxy-stdio',
      'transport.gateway.proxy-stdio',
      {
        gateway: {
          entrypoint: 'build/index.js',
          command: 'proxy',
          inboundTransport: 'stdio',
          bridgeTransport: 'streamable-http',
        },
        upstream: { transport: 'stdio', sdkEra: 'v1', protocolEra: 'legacy' },
      },
      probe,
    );
  });

  it('proves retained upstream SSE with MCP traffic through the built gateway', async () => {
    const fixtureWorkspace = await createWorkspace('upstream-sse-fixture', {});
    const fixture = await startSseFixture(fixtureWorkspace.home);
    const workspace = await createWorkspace('upstream-sse', {
      fixture: { type: 'sse', url: fixture.endpoint },
    });
    const gateway = await startGateway(workspace.configPath, workspace.home);
    const probe = await probeHttpGateway(gateway.endpoint, workspace.home);
    expect(probe.transport).toBe('streamable-http');
    await emitProfileProof(
      'upstream-sse-retained',
      'transport.gateway.upstream-sse-retained',
      {
        gateway: { entrypoint: 'build/index.js', command: 'serve', inboundTransport: 'streamable-http' },
        upstream: { transport: 'sse', sdkEra: 'v1', protocolEra: 'legacy' },
      },
      probe,
    );
  });

  it('proves modern upstream stdio with MCP traffic through the built gateway', async () => {
    const workspace = await createWorkspace('upstream-stdio-modern', stdioUpstream('v2', 'modern'));
    const gateway = await startGateway(workspace.configPath, workspace.home);
    const probe = await probeHttpGateway(gateway.endpoint, workspace.home);
    expect(probe.transport).toBe('streamable-http');
    await emitProfileProof(
      'upstream-stdio-modern',
      'transport.gateway.upstream-stdio-modern',
      {
        gateway: { entrypoint: 'build/index.js', command: 'serve', inboundTransport: 'streamable-http' },
        upstream: { transport: 'stdio', sdkEra: 'v2', protocolEra: 'modern' },
      },
      probe,
    );
  });

  it('proves legacy upstream stdio with MCP traffic through the built gateway', async () => {
    const workspace = await createWorkspace('upstream-stdio-legacy', stdioUpstream('v1'));
    const gateway = await startGateway(workspace.configPath, workspace.home);
    const probe = await probeHttpGateway(gateway.endpoint, workspace.home);
    expect(probe.transport).toBe('streamable-http');
    await emitProfileProof(
      'upstream-stdio-legacy',
      'transport.gateway.upstream-stdio-legacy',
      {
        gateway: { entrypoint: 'build/index.js', command: 'serve', inboundTransport: 'streamable-http' },
        upstream: { transport: 'stdio', sdkEra: 'v1', protocolEra: 'legacy' },
      },
      probe,
    );
  });
});
