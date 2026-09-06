import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import {
  buildConformanceBaseline,
  type ConformanceBaseline,
  type ConformanceBaselineInput,
  validateConformanceBaseline,
} from '../baseline/baseline.js';
import { generateSdkBoundaryProof, readSdkBoundaryProof } from '../boundary/sdkBoundaryProof.js';
import { SanitizedWireEvidenceFileSchema, writeEvidence } from '../capture/index.js';
import { verifyConformanceIntegrity } from '../integrity/index.js';
import {
  type OfficialConformanceResult,
  readOfficialEvidenceArtifact,
  runOfficialConformance,
} from '../official/officialRunner.js';
import {
  executeMatrixAssignment,
  type MatrixAssignmentDescriptor,
  type MatrixExecutionOptions,
  type MatrixExecutionResult,
  validateMatrixAssignments,
} from '../runtime/index.js';

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
const PROFILE_TEST_REGISTRY: Record<string, readonly { path: string; needle: string }[]> = {
  'transport.gateway.inbound-http-sse-retained': [
    { path: 'test/conformance/transports/profileProofs.test.ts', needle: "it('proves retained inbound HTTP+SSE" },
  ],
  'transport.gateway.direct-serve-stdio': [
    { path: 'test/conformance/transports/profileProofs.test.ts', needle: "it('proves direct serve stdio" },
  ],
  'transport.gateway.proxy-stdio': [
    { path: 'test/conformance/transports/profileProofs.test.ts', needle: "it('proves proxy stdio" },
  ],
  'transport.gateway.upstream-sse-retained': [
    { path: 'test/conformance/transports/profileProofs.test.ts', needle: "it('proves retained upstream SSE" },
  ],
  'transport.gateway.upstream-stdio-modern': [
    {
      path: 'test/conformance/transports/profileProofs.test.ts',
      needle: "it('records product-red evidence for modern upstream stdio",
    },
  ],
  'transport.gateway.upstream-stdio-legacy': [
    { path: 'test/conformance/transports/profileProofs.test.ts', needle: "it('proves legacy upstream stdio" },
  ],
};
export const REQUIRED_TRANSPORT_PROFILES = [
  'inbound-streamable-http-modern',
  'inbound-streamable-http-legacy',
  'inbound-http-sse-retained',
  'direct-serve-stdio',
  'proxy-stdio',
  'upstream-streamable-http-modern',
  'upstream-streamable-http-legacy',
  'upstream-sse-retained',
  'upstream-stdio-modern',
  'upstream-stdio-legacy',
] as const;
const transportProfilesSchema = z.array(z.enum(REQUIRED_TRANSPORT_PROFILES));
const canonicalRevisionSchema = z.enum(['2025-11-25', '2026-07-28']);
const canonicalOperationsSchema = z.array(
  z.enum(['transport/connect', 'server/discover', 'initialize', 'ping', 'tools/list', 'tools/call']),
);
type TransportProfile = (typeof REQUIRED_TRANSPORT_PROFILES)[number];

const foundationLockSchema = z
  .object({
    schemaVersion: z.literal(1),
    artifacts: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u),
          path: z.string().regex(/^[A-Za-z0-9._/-]+$/u),
          digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        })
        .strict(),
    ),
  })
  .strict();

const profileProofFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    profileProofs: z.array(
      z
        .object({
          profile: z.enum(REQUIRED_TRANSPORT_PROFILES),
          testId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]+$/u),
          artifactId: z.string().regex(/^profile-evidence\/[a-z0-9][a-z0-9.-]+\.json$/u),
          evidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
          attempt: z.literal(1),
          status: z.enum(['passed', 'product-failed']),
          downstreamIssue: z.literal(478).optional(),
        })
        .strict(),
    ),
  })
  .strict();

const profileEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: z.enum(REQUIRED_TRANSPORT_PROFILES),
    testId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]+$/u),
    attempt: z.literal(1),
    status: z.enum(['passed', 'product-failed']),
    downstreamIssue: z.literal(478).optional(),
    checks: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]+$/u)).min(1),
    gateway: z
      .object({
        entrypoint: z.literal('build/index.js'),
        command: z.enum(['serve', 'proxy']),
        inboundTransport: z.enum(['http-sse', 'stdio', 'streamable-http']),
        bridgeTransport: z.literal('streamable-http').optional(),
      })
      .strict(),
    upstream: z
      .object({
        transport: z.enum(['sse', 'stdio']),
        sdkEra: z.enum(['v1', 'v2']),
        protocolEra: z.enum(['legacy', 'modern']),
      })
      .strict(),
    probe: z.discriminatedUnion('outcome', [
      z
        .object({
          outcome: z.literal('completed'),
          fixtureId: z.literal('typescript-v1'),
          transport: z.enum(['sse', 'stdio', 'streamable-http']),
          initialized: z.literal(true),
          ping: z.literal(true),
          negotiatedRevision: z.literal('2025-11-25'),
          operations: z.tuple([
            z.literal('initialize'),
            z.literal('ping'),
            z.literal('tools/list'),
            z.literal('tools/call'),
          ]),
          toolsCount: z.number().int().positive(),
          callError: z.literal(false),
        })
        .strict(),
      z
        .object({
          outcome: z.literal('product-failed'),
          fixtureId: z.literal('typescript-v1'),
          transport: z.enum(['stdio', 'streamable-http']),
          initialized: z.literal(false),
          ping: z.literal(false),
          negotiatedRevision: z.literal('not-negotiated'),
          operations: z.tuple([z.literal('initialize')]),
          classification: z.enum(['initialize-timeout', 'upstream-revision-mismatch']),
        })
        .strict(),
    ]),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      (evidence.status === 'passed' && evidence.probe.outcome !== 'completed') ||
      (evidence.status === 'product-failed' && evidence.probe.outcome !== 'product-failed') ||
      (evidence.status === 'product-failed' && evidence.downstreamIssue !== 478) ||
      (evidence.status === 'passed' && evidence.downstreamIssue !== undefined) ||
      (evidence.probe.outcome === 'product-failed' &&
        ((evidence.probe.classification === 'initialize-timeout' && evidence.probe.transport !== 'stdio') ||
          (evidence.probe.classification === 'upstream-revision-mismatch' &&
            evidence.probe.transport !== 'streamable-http')))
    ) {
      context.addIssue({ code: 'custom', message: 'profile evidence status does not match the observed outcome' });
    }
  });

const legacyRevisionEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.enum(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']),
    negotiatedRevision: z.enum(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']),
    fixtureId: z.literal('typescript-v1-1.30.0'),
    transportProfile: z.literal('inbound-streamable-http-legacy'),
    testId: z.string().min(1),
    attempt: z.literal(1),
    status: z.literal('passed'),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();

const frozenRequirementFileSchema = z
  .object({
    server: z.array(z.string().min(1)),
    client: z.array(z.string().min(1)),
    not_scored: z
      .array(
        z
          .object({
            scenario: z.string().min(1),
            leg: z.enum(['client', 'server']),
            reason: z.enum(['extension', 'added-after-release', 'pending']),
            note: z.string().optional(),
          })
          .strip(),
      )
      .default([]),
  })
  .strip();

type Era = keyof typeof revisionByEra;
type Variant = 'typescript-baseline' | 'alternate-inbound' | 'alternate-upstream';
type Language = 'typescript' | 'python';

interface FoundationRunOptions {
  root: string;
  mode: 'baseline' | 'gate';
  outputDirectory: string;
}

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

function packageManifestPath(root: string, packageName: string): string {
  return join(root, 'node_modules', ...packageName.split('/'), 'package.json');
}

async function integrityReport(root: string, expectedSourceSha: string) {
  const lockPath = join(root, 'test/conformance/foundation/foundation-lock.json');
  const lock = foundationLockSchema.parse(JSON.parse(await readFile(lockPath, 'utf8')));
  const packageRoot = dirname(packageManifestPath(root, '@modelcontextprotocol/conformance'));
  return verifyConformanceIntegrity({
    sourceRoot: root,
    expectedSourceSha,
    artifacts: lock.artifacts.map((artifact) => ({
      id: artifact.id,
      path: join(root, artifact.path),
      expectedDigest: artifact.digest as `sha256:${string}`,
    })),
    npm: {
      packageManifestPath: join(root, 'package.json'),
      pnpmLockPath: join(root, 'pnpm-lock.yaml'),
      parseYaml,
      installedPackages: Object.fromEntries(
        [
          '@modelcontextprotocol/client',
          '@modelcontextprotocol/conformance',
          '@modelcontextprotocol/core',
          '@modelcontextprotocol/node',
          '@modelcontextprotocol/sdk',
          '@modelcontextprotocol/server',
          '@modelcontextprotocol/server-legacy',
        ].map((name) => [name, packageManifestPath(root, name)]),
      ),
      manifestSpecifiers: { '@modelcontextprotocol/sdk': '1.30.0' },
    },
    requirements: {
      '2025-11-25': join(packageRoot, 'requirements', '2025-11-25.yaml'),
      '2026-07-28': join(packageRoot, 'requirements', '2026-07-28.yaml'),
    },
    python: {
      pyprojectPath: join(root, 'test/conformance/fixtures/python/pyproject.toml'),
      uvLockPath: join(root, 'test/conformance/fixtures/python/uv.lock'),
    },
  });
}

async function requirementCatalog(root: string, integrity: Awaited<ReturnType<typeof integrityReport>>) {
  const packageRoot = dirname(packageManifestPath(root, '@modelcontextprotocol/conformance'));
  return (
    await Promise.all(
      (['2025-11-25', '2026-07-28'] as const).map(async (revision) => {
        const requirements = frozenRequirementFileSchema.parse(
          parseYaml(await readFile(join(packageRoot, 'requirements', `${revision}.yaml`), 'utf8')),
        );
        const era: Era = revision === '2026-07-28' ? 'modern' : 'legacy';
        const sourceDigest = integrity.requirements.find((entry) => entry.revision === revision)?.digest;
        if (!sourceDigest) throw new Error('requirement-digest-missing');
        const excluded = new Map(
          requirements.not_scored.map((entry) => [`${entry.leg}.${entry.scenario}`, entry.reason]),
        );
        return (['server', 'client'] as const).flatMap((role) =>
          [
            ...requirements[role],
            ...requirements.not_scored.filter((entry) => entry.leg === role).map((entry) => entry.scenario),
          ].map((scenarioId) => {
            const reason = excluded.get(`${role}.${scenarioId}`);
            const matrixCellIds = [
              ...new Set(
                matrixPlan()
                  .filter(({ descriptor }) =>
                    role === 'server' ? descriptor.inboundEra === era : descriptor.upstreamEra === era,
                  )
                  .map(({ descriptor }) => `${descriptor.inboundEra}-${descriptor.upstreamEra}`),
              ),
            ];
            return {
              requirementId: `official.${revision}.${role}.${scenarioId}`,
              sourceRevision: revision,
              role,
              scenarioId,
              strength: 'normative' as const,
              applicability: reason ? { status: 'excluded' as const, reason } : { status: 'required' as const },
              deliveryStage: 'compatibility' as const,
              matrixCellIds,
              peerIds: [revision === '2026-07-28' ? 'typescript-v2-2.0.0' : 'typescript-v1-1.30.0'],
              transportProfiles: [role === 'server' ? streamableProfile.inbound[era] : streamableProfile.upstream[era]],
              sourceDigest,
              fixtureDigest: integrity.digest,
            };
          }),
        );
      }),
    )
  ).flat();
}

async function verifyProfileProofs(
  root: string,
  outputDirectory: string,
  proofs: z.infer<typeof profileProofFileSchema>,
): Promise<boolean> {
  try {
    for (const proof of proofs.profileProofs) {
      const evidence = profileEvidenceSchema.parse(
        JSON.parse(await readFile(join(outputDirectory, proof.artifactId), 'utf8')),
      );
      const { digest: recordedDigest, ...payload } = evidence;
      const computedDigest = `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
      if (
        recordedDigest !== computedDigest ||
        proof.evidenceDigest !== computedDigest ||
        proof.profile !== evidence.profile ||
        proof.testId !== evidence.testId ||
        proof.attempt !== evidence.attempt ||
        proof.status !== evidence.status ||
        proof.downstreamIssue !== evidence.downstreamIssue
      ) {
        return false;
      }
      const registeredTests = PROFILE_TEST_REGISTRY[proof.testId];
      if (!registeredTests?.length) return false;
      for (const registered of registeredTests) {
        if (!(await readFile(join(root, registered.path), 'utf8')).includes(registered.needle)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
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

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('port-reservation-failed');
  await new Promise<void>((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return address.port;
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

async function startOfficialGateway(
  root: string,
  outputDirectory: string,
  upstreamEndpoint: string,
): Promise<{ endpoint: string; close(): Promise<void> }> {
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
    ],
    {
      cwd: runtimeScope,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        NODE_ENV: 'test',
        ONE_MCP_CONFIG_DIR: runtimeScope,
        ONE_MCP_LOG_LEVEL: 'error',
        ONE_MCP_ENABLE_AUTH: 'false',
        NO_PROXY: '127.0.0.1,localhost,::1',
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  try {
    await waitForGatewayReady(child, origin);
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
      env: { PATH: process.env.PATH, HOME: home, NODE_ENV: 'test', NO_PROXY: '127.0.0.1,localhost,::1' },
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

async function runRetainedRevisionProbes(root: string, outputDirectory: string) {
  const revisions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'] as const;
  const server = await startTypescriptServer(root, 'legacy', outputDirectory);
  await mkdir(join(outputDirectory, 'legacy-revisions'), { recursive: true, mode: 0o700 });
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
        const evidence = {
          schemaVersion: 1,
          revision,
          negotiatedRevision: negotiated.result.protocolVersion,
          fixtureId: 'typescript-v1-1.30.0',
          transportProfile: 'inbound-streamable-http-legacy',
          testId: `legacy.${revision}.initialize`,
          attempt: 1,
          status: 'passed',
        } as const;
        const evidenceDigest = `sha256:${createHash('sha256').update(JSON.stringify(evidence)).digest('hex')}` as const;
        const artifactId = `legacy-revisions/${revision}.json`;
        await writeFile(
          join(outputDirectory, artifactId),
          `${JSON.stringify({ ...evidence, digest: evidenceDigest }, null, 2)}\n`,
          { encoding: 'utf8', mode: 0o600 },
        );
        return {
          revision,
          fixtureId: evidence.fixtureId,
          transportProfile: evidence.transportProfile,
          testId: evidence.testId,
          artifactId,
          evidenceDigest,
          attempt: 1 as const,
        };
      }),
    );
  } finally {
    await server.close();
  }
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const officialClientBridgeStatusSchema = z
  .object({
    scenario: z.string().min(1),
    status: z.enum(['attempted', 'fixture-defect', 'harness-defect']),
  })
  .strict();

export async function classifyOfficialClientResult(
  result: OfficialConformanceResult,
  statusDirectory: string,
): Promise<OfficialConformanceResult> {
  if (result.classification !== 'product') return result;
  try {
    let fixtureDefect = false;
    for (const scenario of result.scenarios) {
      const status = officialClientBridgeStatusSchema.parse(
        JSON.parse(await readFile(join(statusDirectory, `${encodeURIComponent(scenario.scenarioId)}.json`), 'utf8')),
      );
      if (status.scenario !== scenario.scenarioId) {
        return { classification: 'harness', role: result.role, revision: result.revision, reason: 'artifact-invalid' };
      }
      if (status.status === 'harness-defect') {
        return { classification: 'harness', role: result.role, revision: result.revision, reason: 'artifact-invalid' };
      }
      fixtureDefect ||= status.status === 'fixture-defect';
    }
    return fixtureDefect
      ? { classification: 'fixture', role: result.role, revision: result.revision, reason: 'invalid-target' }
      : result;
  } catch {
    return { classification: 'harness', role: result.role, revision: result.revision, reason: 'artifact-invalid' };
  }
}

async function runOfficialPeers(root: string, outputDirectory: string): Promise<OfficialConformanceResult[]> {
  const packageRoot = dirname(packageManifestPath(root, '@modelcontextprotocol/conformance'));
  const fixture = join(root, 'test/conformance/fixtures/typescript/src/fixture.mjs');
  const bridge = join(root, 'test/conformance/foundation/officialClientBridge.mjs');
  const builtEntryPath = join(root, 'build/index.js');
  const results: OfficialConformanceResult[] = [];
  for (const revision of ['2025-11-25', '2026-07-28'] as const) {
    const statusDirectory = await mkdtemp(join(outputDirectory, `official-client-${revision}-`));
    const command = [process.execPath, bridge, fixture, builtEntryPath, statusDirectory].map(shellArgument).join(' ');
    let clientResult = await runOfficialConformance({
      packageRoot,
      role: 'client',
      revision,
      command,
      temporaryParentDirectory: outputDirectory,
    });
    clientResult = await classifyOfficialClientResult(clientResult, statusDirectory);
    try {
      await rm(statusDirectory, { recursive: true, force: true });
    } catch {
      clientResult = { classification: 'harness', role: 'client', revision, reason: 'cleanup-failure' };
    }
    results.push(clientResult);

    let server: Awaited<ReturnType<typeof startTypescriptServer>> | undefined;
    let gateway: Awaited<ReturnType<typeof startOfficialGateway>> | undefined;
    let serverResult: OfficialConformanceResult = {
      classification: 'fixture',
      role: 'server',
      revision,
      reason: 'invalid-target',
    };
    try {
      server = await startTypescriptServer(root, revision === '2026-07-28' ? 'modern' : 'legacy', outputDirectory);
    } catch {
      // The default result identifies a server fixture that failed before it became a valid target.
    }
    if (server) {
      try {
        gateway = await startOfficialGateway(root, outputDirectory, server.endpoint);
        serverResult = await runOfficialConformance({
          packageRoot,
          role: 'server',
          revision,
          url: gateway.endpoint,
          temporaryParentDirectory: outputDirectory,
        });
      } catch {
        serverResult = { classification: 'process', role: 'server', revision, reason: 'spawn-failure' };
      }
    }
    let cleanupFailed = false;
    for (const close of [gateway?.close, server?.close]) {
      if (!close) continue;
      try {
        await close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      serverResult = { classification: 'harness', role: 'server', revision, reason: 'cleanup-failure' };
    }
    results.push(serverResult);
  }
  return results;
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

function peerIdentity(language: Language, era: Era): string {
  if (language === 'typescript') return era === 'modern' ? 'typescript-v2-2.0.0' : 'typescript-v1-1.30.0';
  return 'python-sdk-2.0.0';
}

async function runMatrix(
  root: string,
  outputDirectory: string,
): Promise<{
  plan: MatrixAssignmentDescriptor[];
  results: MatrixExecutionResult[];
}> {
  const entries = matrixPlan();
  const plan = validateMatrixAssignments(entries.map((entry) => entry.descriptor));
  const results: MatrixExecutionResult[] = [];
  for (const entry of entries) {
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
    results.push(result);
    if (result.kind === 'product') {
      const evidenceDirectory = join(outputDirectory, 'evidence');
      await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
      await Promise.all([
        writeEvidence(join(evidenceDirectory, `${descriptor.assignmentId}.inbound.json`), result.evidence.inbound),
        writeEvidence(join(evidenceDirectory, `${descriptor.assignmentId}.upstream.json`), result.evidence.upstream),
      ]);
    }
  }
  return { plan, results };
}

function normalizedMatrixRuns(
  plan: MatrixAssignmentDescriptor[],
  results: MatrixExecutionResult[],
): ConformanceBaselineInput['matrixRuns'] {
  const planById = new Map(plan.map((assignment) => [assignment.assignmentId, assignment]));
  return results.map((result) => {
    if (result.kind === 'infrastructure') {
      return {
        classification: result.defect,
        assignmentId: result.assignmentId,
        attempt: 1,
        reasonCode: result.reason,
      };
    }
    const descriptor = planById.get(result.assignmentId);
    if (!descriptor) {
      return {
        classification: 'harness' as const,
        assignmentId: result.assignmentId,
        attempt: 1 as const,
        reasonCode: 'matrix-plan-missing',
      };
    }
    return {
      classification: 'product' as const,
      assignmentId: result.assignmentId,
      attempt: 1 as const,
      productVerdict: result.status,
      reasonCode:
        result.status === 'pass'
          ? ('probe-complete' as const)
          : result.reason === 'wire_schema_invalid'
            ? ('schema-invalid' as const)
            : result.reason === 'gateway_rejected'
              ? ('gateway-rejected' as const)
              : ('unsupported-operation' as const),
      executedProfiles: transportProfilesSchema.parse(descriptor.executedProfiles),
      probe: {
        negotiatedRevision:
          'errorCode' in result.facts
            ? ('not-negotiated' as const)
            : canonicalRevisionSchema.parse(result.facts.negotiatedRevision),
        operations:
          'errorCode' in result.facts
            ? (['transport/connect'] as const)
            : canonicalOperationsSchema.parse(result.facts.operations),
      },
      evidence: {
        inbound: {
          artifactId: `evidence/${result.assignmentId}.inbound.json`,
          digest: result.evidence.inbound.digest,
          records: result.evidence.inbound.records.length,
        },
        upstream: {
          artifactId: `evidence/${result.assignmentId}.upstream.json`,
          digest: result.evidence.upstream.digest,
          records: result.evidence.upstream.records.length,
        },
      },
    };
  });
}

async function validateEvidenceBundle(
  root: string,
  outputDirectory: string,
  baseline: ConformanceBaseline,
): Promise<void> {
  const artifactPath = (artifactId: string, prefix: string): string => {
    if (!artifactId.startsWith(prefix) || artifactId.includes('..') || !artifactId.endsWith('.json')) {
      throw new Error('evidence-artifact-id-invalid');
    }
    return join(outputDirectory, artifactId);
  };
  if (
    !(await verifyProfileProofs(root, outputDirectory, {
      schemaVersion: 1,
      profileProofs: baseline.profileProofs,
    }))
  ) {
    throw new Error('profile-evidence-mismatch');
  }
  if (baseline.sdkBoundaryProof.classification === 'product') {
    const proof = await readSdkBoundaryProof(outputDirectory, baseline.sdkBoundaryProof);
    if (proof.classification !== 'product' || proof.productVerdict !== baseline.sdkBoundaryProof.productVerdict) {
      throw new Error('sdk-boundary-evidence-mismatch');
    }
  }
  for (const run of baseline.officialRuns) {
    if (run.classification !== 'product') continue;
    const artifact = await readOfficialEvidenceArtifact(outputDirectory, run.artifact);
    if (
      artifact.role !== run.role ||
      artifact.revision !== run.revision ||
      artifact.productVerdict !== run.productVerdict
    ) {
      throw new Error('official-evidence-mismatch');
    }
  }
  for (const run of baseline.matrixRuns) {
    if (run.classification !== 'product') continue;
    for (const reference of [run.evidence.inbound, run.evidence.upstream]) {
      const evidence = SanitizedWireEvidenceFileSchema.parse(
        JSON.parse(await readFile(artifactPath(reference.artifactId, 'evidence/'), 'utf8')),
      );
      if (evidence.digest !== reference.digest || evidence.records.length !== reference.records) {
        throw new Error('matrix-evidence-mismatch');
      }
    }
  }
  for (const proof of baseline.legacyRevisionProofs) {
    const evidence = legacyRevisionEvidenceSchema.parse(
      JSON.parse(await readFile(artifactPath(proof.artifactId, 'legacy-revisions/'), 'utf8')),
    );
    const { digest: recordedDigest, ...payload } = evidence;
    const computedDigest = `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
    if (
      recordedDigest !== computedDigest ||
      proof.evidenceDigest !== computedDigest ||
      proof.revision !== evidence.revision ||
      proof.testId !== evidence.testId
    ) {
      throw new Error('legacy-revision-evidence-mismatch');
    }
  }
}

async function persistBaseline(root: string, outputDirectory: string, baseline: ConformanceBaseline): Promise<void> {
  const validated = validateConformanceBaseline(baseline);
  await validateEvidenceBundle(root, outputDirectory, validated);
  await writeFile(join(outputDirectory, 'conformance-baseline.json'), `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export async function runFoundationConformance(options: FoundationRunOptions): Promise<ConformanceBaseline> {
  const root = resolve(options.root);
  const outputDirectory = resolve(options.outputDirectory);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const expectedSourceSha = process.env.GITHUB_SHA ?? sourceSha;
  const integrity = await integrityReport(root, expectedSourceSha);
  await writeFile(join(outputDirectory, 'conformance-integrity.json'), `${JSON.stringify(integrity, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  if (!integrity.ok) {
    const issues = integrity.issues.map(({ code, subject }) => `${code}:${subject}`).join(', ');
    throw new Error(`Conformance integrity check failed: ${issues}`);
  }
  const generatedSdkBoundaryProof = await generateSdkBoundaryProof(root, outputDirectory);
  const sdkBoundaryProof =
    generatedSdkBoundaryProof.classification === 'product'
      ? await readSdkBoundaryProof(outputDirectory, generatedSdkBoundaryProof)
      : generatedSdkBoundaryProof;
  const proofs = await readFile(join(outputDirectory, 'profile-proofs.json'), 'utf8')
    .then((content) => profileProofFileSchema.safeParse(JSON.parse(content)))
    .catch(() => ({ success: false as const }));
  const proofsValid = proofs.success && (await verifyProfileProofs(root, outputDirectory, proofs.data));

  if (!integrity.ok || !proofsValid || sdkBoundaryProof.classification !== 'product') {
    const baseline = buildConformanceBaseline({
      mode: options.mode,
      sourceSha,
      integrity: {
        ok: integrity.ok && proofsValid,
        digest: integrity.digest,
        source: { clean: integrity.source.clean },
      },
      requirementCatalog: [],
      officialRuns: [],
      matrixPlan: [],
      matrixRuns: [],
      profileProofs: [],
      legacyRevisionProofs: [],
      sdkBoundaryProof,
      requiredProfiles: [...REQUIRED_TRANSPORT_PROFILES],
    });
    await persistBaseline(root, outputDirectory, baseline);
    return baseline;
  }
  if (!proofs.success) throw new Error('profile-proof-validation-inconsistent');

  const legacyRevisionProofs = await runRetainedRevisionProbes(root, outputDirectory);
  const officialRuns = await runOfficialPeers(root, outputDirectory);
  const matrix = await runMatrix(root, outputDirectory);
  const planEntries = new Map(matrixPlan().map((entry) => [entry.descriptor.assignmentId, entry]));
  const observedInput: ConformanceBaselineInput = {
    mode: options.mode,
    sourceSha,
    integrity: { ok: integrity.ok, digest: integrity.digest, source: { clean: integrity.source.clean } },
    requirementCatalog: await requirementCatalog(root, integrity),
    officialRuns,
    matrixPlan: matrix.plan.map((assignment) => ({
      id: assignment.assignmentId,
      cellId: `${assignment.inboundEra}-${assignment.upstreamEra}`,
      variantKind: assignment.variant,
      profiles: transportProfilesSchema.parse(assignment.executedProfiles),
      peerIds: (() => {
        const entry = planEntries.get(assignment.assignmentId);
        if (!entry) throw new Error('matrix-plan-missing');
        return [
          peerIdentity(entry.inboundLanguage, assignment.inboundEra),
          peerIdentity(entry.upstreamLanguage, assignment.upstreamEra),
        ];
      })(),
    })),
    matrixRuns: normalizedMatrixRuns(matrix.plan, matrix.results),
    profileProofs: proofs.data.profileProofs,
    legacyRevisionProofs,
    sdkBoundaryProof,
    requiredProfiles: [...REQUIRED_TRANSPORT_PROFILES],
  };
  await writeFile(join(outputDirectory, 'observed-inputs.json'), `${JSON.stringify(observedInput, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  const baseline = buildConformanceBaseline(observedInput);
  await persistBaseline(root, outputDirectory, baseline);
  return baseline;
}

export async function removeFoundationOutputs(outputDirectory: string): Promise<void> {
  await rm(outputDirectory, { recursive: true, force: true });
}
