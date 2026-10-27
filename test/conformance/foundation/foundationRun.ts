import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import {
  executeMatrixAssignment,
  type MatrixAssignmentDescriptor,
  type MatrixExecutionOptions,
  validateMatrixAssignments,
} from '../runtime/index.js';
import { reserveLoopbackPort } from '../runtime/loopbackPorts.js';
import { runConformanceTasks } from './concurrentTasks.js';

type OfficialConformanceRevision = '2025-11-25' | '2026-07-28';
const revisionByEra = { modern: '2026-07-28', legacy: '2025-11-25' } as const;
const streamableProfile = {
  inbound: {
    modern: 'inbound-streamable-http-modern',
    legacy: 'inbound-streamable-http-legacy',
  },
  upstream: {
    modern: 'upstream-streamable-http-modern',
    legacy: 'upstream-streamable-http-legacy',
  },
} as const;
type TransportProfile = string;
type Era = keyof typeof revisionByEra;
type Variant = 'typescript-baseline' | 'alternate-inbound' | 'alternate-upstream';
type Language = 'typescript' | 'python';

interface PeerCommand {
  command: string;
  args: string[];
  fixtureId: string;
}

interface MatrixPlanEntry {
  descriptor: MatrixAssignmentDescriptor;
  inboundLanguage: Language;
  upstreamLanguage: Language;
}

function matrixPlan(): MatrixPlanEntry[] {
  const cells = [
    ['modern', 'modern'],
    ['modern', 'legacy'],
    ['legacy', 'modern'],
    ['legacy', 'legacy'],
  ] as const;
  const variants: Variant[] = ['typescript-baseline', 'alternate-inbound', 'alternate-upstream'];
  return cells.flatMap(([inboundEra, upstreamEra]) =>
    variants.map((variant) => {
      const alternate: Language = 'python';
      const inboundLanguage = variant === 'alternate-inbound' ? alternate : 'typescript';
      const upstreamLanguage = variant === 'alternate-upstream' ? alternate : 'typescript';
      const assignmentId = `${inboundEra}-${upstreamEra}.${variant}`;
      const profiles: TransportProfile[] = [
        streamableProfile.inbound[inboundEra],
        streamableProfile.upstream[upstreamEra],
      ];
      return {
        inboundLanguage,
        upstreamLanguage,
        descriptor: {
          assignmentId,
          inboundEra,
          upstreamEra,
          variant,
          claimedProfiles: profiles,
          executedProfiles: profiles,
        },
      };
    }),
  );
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', exited);
      resolvePromise(false);
    }, timeoutMs);
    const exited = (): void => {
      clearTimeout(timeout);
      resolvePromise(true);
    };
    child.once('exit', exited);
  });
}

export async function stopChild(child: ChildProcess, graceMs = 3_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (await waitForChildExit(child, graceMs)) return;
  child.kill('SIGKILL');
  if (!(await waitForChildExit(child, graceMs))) throw new Error('child-cleanup-timeout');
}

async function waitForGatewayReady(child: ChildProcess, origin: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('gateway-exited');
    try {
      const response = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(500) });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch {
      // Readiness polling is not a conformance attempt.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error('gateway-readiness-timeout');
}

export async function startOfficialGateway(
  root: string,
  outputDirectory: string,
  upstreamEndpoint: string,
  revision: OfficialConformanceRevision,
): Promise<{ endpoint: string; accessToken?: string; close(): Promise<void> }> {
  const scratch = await mkdtemp(join(outputDirectory, 'official-gateway-'));
  const runtimeScope = join(scratch, 'runtime-scope');
  const home = join(scratch, 'home');
  await Promise.all([mkdir(runtimeScope), mkdir(home)]);
  await writeFile(
    join(runtimeScope, 'mcp.json'),
    `${JSON.stringify({
      mcpServers: { official_conformance: { type: 'streamableHttp', url: upstreamEndpoint } },
    })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  const port = await reserveLoopbackPort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      join(root, 'build/index.js'),
      'serve',
      '--transport',
      'http',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--config-dir',
      runtimeScope,
      '--async-max-retries',
      '0',
      '--no-async-background-retry',
      '--enable-auth',
      String(revision === '2026-07-28'),
      '--enable-scope-validation',
      'true',
      '--credential-store',
      'file',
    ],
    {
      cwd: runtimeScope,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        NODE_ENV: 'test',
        ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED: 'true',
        ONE_MCP_CONFIG_DIR: runtimeScope,
        ONE_MCP_LOG_LEVEL: 'error',
        NO_PROXY: '127.0.0.1,localhost,::1',
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  let accessToken: string | undefined;
  try {
    await waitForGatewayReady(child, origin);
    if (revision === '2026-07-28') {
      // Provision exactly once through the real localhost route; credentials never enter args or evidence.
      const response = await fetch(`${origin}/api/auth/cli-token`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status !== 200) throw new Error('official-gateway-credential-rejected');
      const minted = z
        .object({ authRequired: z.literal(true), token: z.string().min(1).max(4096) })
        .safeParse(await response.json());
      if (!minted.success) throw new Error('official-gateway-credential-invalid');
      accessToken = minted.data.token;
      const admitted = await fetch(`${origin}/api/v1/inspect`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
      await admitted.body?.cancel();
      if (admitted.status !== 200) throw new Error(`official-gateway-auth-admission-rejected:${admitted.status}`);
    }
  } catch (error) {
    try {
      await stopChild(child);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    throw error;
  }
  return {
    endpoint: `${origin}/mcp`,
    accessToken,
    close: async () => {
      await stopChild(child);
      await rm(scratch, { recursive: true, force: true });
    },
  };
}

async function startTypescriptServer(
  root: string,
  era: Era,
  home: string,
): Promise<{ endpoint: string; close(): Promise<void> }> {
  const fixture = join(root, 'test/conformance/fixtures/typescript/src/fixture.mjs');
  const child = spawn(
    process.execPath,
    [fixture, 'server', '--sdk-era', era === 'modern' ? 'v2' : 'v1', '--transport', 'streamable-http'],
    {
      cwd: join(root, 'test/conformance/fixtures/typescript'),
      env: {
        PATH: process.env.PATH,
        HOME: home,
        NODE_ENV: 'test',
        ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED: 'true',
        NO_PROXY: '127.0.0.1,localhost,::1',
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  try {
    const ready = await new Promise<unknown>((resolvePromise, reject) => {
      let settled = false;
      const finish = (result: { value: unknown } | { error: Error }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if ('error' in result) reject(result.error);
        else resolvePromise(result.value);
      };
      const timeout = setTimeout(() => finish({ error: new Error('fixture-readiness-timeout') }), 15_000);
      let output = '';
      child.once('exit', () => finish({ error: new Error('fixture-exited') }));
      child.stdout?.on('data', (chunk: Buffer | string) => {
        output += String(chunk);
        const lineEnd = output.indexOf('\n');
        if (lineEnd < 0) return;
        try {
          finish({ value: JSON.parse(output.slice(0, lineEnd)) });
        } catch {
          finish({ error: new Error('fixture-readiness-invalid') });
        }
      });
    });
    const parsed = z
      .object({
        ready: z.literal(true),
        fixtureId: z.enum(['typescript-v1', 'typescript-v2']),
        endpoint: z.string().url(),
      })
      .passthrough()
      .parse(ready);
    return { endpoint: parsed.endpoint, close: () => stopChild(child) };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

export async function runRetainedRevisionProbes(root: string, outputDirectory: string) {
  const revisions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'] as const;
  const server = await startTypescriptServer(root, 'legacy', outputDirectory);
  try {
    return await Promise.all(
      revisions.map(async (revision) => {
        const response = await fetch(server.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: revision,
              capabilities: {},
              clientInfo: { name: 'revision-probe', version: '1' },
            },
          }),
        });
        if (!response.ok) throw new Error('legacy-revision-http-failed');
        const dataLine = (await response.text()).split(/\r?\n/u).find((line) => line.startsWith('data: '));
        if (!dataLine) throw new Error('legacy-revision-response-missing');
        const negotiated = z
          .object({ result: z.object({ protocolVersion: z.literal(revision) }).passthrough() })
          .passthrough()
          .parse(JSON.parse(dataLine.slice('data: '.length)));
        return negotiated.result.protocolVersion;
      }),
    );
  } finally {
    await server.close();
  }
}

function typescriptPeer(root: string, era: Era, role: 'inbound' | 'upstream'): PeerCommand {
  const fixture = join(root, 'test/conformance/fixtures/typescript/src/fixture.mjs');
  const sdkEra = era === 'modern' ? 'v2' : 'v1';
  return role === 'upstream'
    ? {
        fixtureId: `typescript-${sdkEra}`,
        command: process.execPath,
        args: [fixture, 'server', '--sdk-era', sdkEra, '--transport', 'streamable-http'],
      }
    : {
        fixtureId: `typescript-${sdkEra}`,
        command: process.execPath,
        args: [
          fixture,
          'probe',
          '--sdk-era',
          sdkEra,
          '--protocol-era',
          era,
          '--transport',
          'streamable-http',
          '--endpoint',
          '{{gatewayEndpoint}}',
          '--aggregated',
          '--runtime-output',
        ],
      };
}

function pythonPeer(root: string, era: Era, role: 'inbound' | 'upstream'): PeerCommand {
  const fixtureRoot = join(root, 'test/conformance/fixtures/python');
  const python = join(fixtureRoot, '.venv', 'bin', 'python');
  const driver = join(fixtureRoot, 'driver.py');
  return role === 'upstream'
    ? {
        fixtureId: 'python-sdk',
        command: python,
        args: [driver, 'server', '--transport', 'streamable-http', '--protocol-era', era],
      }
    : {
        fixtureId: 'python-sdk',
        command: python,
        args: [
          driver,
          'probe',
          '--transport',
          'streamable-http',
          '--protocol-era',
          era,
          '--endpoint',
          '{{gatewayEndpoint}}',
          '--aggregated',
        ],
      };
}

function peer(root: string, language: Language, era: Era, role: 'inbound' | 'upstream'): PeerCommand {
  if (language === 'typescript') return typescriptPeer(root, era, role);
  return pythonPeer(root, era, role);
}

export async function runMatrix(root: string) {
  const entries = matrixPlan();
  const plan = validateMatrixAssignments(entries.map((entry) => entry.descriptor));
  const results = await runConformanceTasks(entries, async (entry) => {
    const { descriptor } = entry;
    const inbound = peer(root, entry.inboundLanguage, descriptor.inboundEra, 'inbound');
    const upstream = peer(root, entry.upstreamLanguage, descriptor.upstreamEra, 'upstream');
    const options: MatrixExecutionOptions = {
      assignmentId: descriptor.assignmentId,
      inboundProbe: { command: inbound.command, args: inbound.args },
      upstreamPeer: {
        command: upstream.command,
        args: upstream.args,
        readiness: { kind: 'stdout-json', fixtureId: upstream.fixtureId },
      },
      upstreamTransport: { type: 'streamableHttp' },
      eras: { inbound: descriptor.inboundEra, upstream: descriptor.upstreamEra },
      revisions: { inbound: revisionByEra[descriptor.inboundEra], upstream: revisionByEra[descriptor.upstreamEra] },
      captureContexts: {
        inbound: { id: `${descriptor.assignmentId}.inbound`, negotiatedRevision: revisionByEra[descriptor.inboundEra] },
        upstream: {
          id: `${descriptor.assignmentId}.upstream`,
          negotiatedRevision: revisionByEra[descriptor.upstreamEra],
        },
      },
      builtEntryPath: join(root, 'build/index.js'),
      timeouts: { startupMs: 20_000, probeMs: 20_000, shutdownMs: 3_000 },
    };
    const result = await executeMatrixAssignment(options);
    return result;
  });
  return { plan, results };
}
