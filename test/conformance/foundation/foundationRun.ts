import { type ChildProcess, execFile, execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import {
  buildConformanceBaseline,
  type ConformanceBaseline,
  type ConformanceBaselineInput,
  validateConformanceBaseline,
} from '../baseline/baseline.js';
import { writeEvidence } from '../capture/index.js';
import { verifyConformanceIntegrity } from '../integrity/index.js';
import { type OfficialConformanceResult, runOfficialConformance } from '../official/officialRunner.js';
import {
  executeMatrixAssignment,
  type MatrixAssignmentDescriptor,
  type MatrixExecutionOptions,
  type MatrixExecutionResult,
  validateMatrixAssignments,
} from '../runtime/index.js';

const execFileAsync = promisify(execFile);
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
  z.enum(['server/discover', 'initialize', 'ping', 'tools/list', 'tools/call']),
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
          evidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
          attempt: z.literal(1),
        })
        .strict(),
    ),
  })
  .strict();

type Era = keyof typeof revisionByEra;
type Variant = 'typescript-baseline' | 'alternate-inbound' | 'alternate-upstream';
type Language = 'typescript' | 'go' | 'python';

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
      const alternate: Language = inboundEra === 'modern' || upstreamEra === 'modern' ? 'python' : 'go';
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
          '@modelcontextprotocol/node',
          '@modelcontextprotocol/sdk',
          '@modelcontextprotocol/server',
          '@modelcontextprotocol/server-legacy',
        ].map((name) => [name, packageManifestPath(root, name)]),
      ),
    },
    requirements: {
      '2025-11-25': join(packageRoot, 'requirements', '2025-11-25.yaml'),
      '2026-07-28': join(packageRoot, 'requirements', '2026-07-28.yaml'),
    },
    go: {
      goModPath: join(root, 'test/conformance/fixtures/go/go.mod'),
      goSumPath: join(root, 'test/conformance/fixtures/go/go.sum'),
      vendorPath: join(root, 'test/conformance/fixtures/go/vendor'),
    },
    python: {
      pyprojectPath: join(root, 'test/conformance/fixtures/python/pyproject.toml'),
      uvLockPath: join(root, 'test/conformance/fixtures/python/uv.lock'),
    },
  });
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolvePromise();
    }, 3_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    child.kill('SIGTERM');
  });
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
  const ready = await new Promise<unknown>((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('fixture-readiness-timeout')), 15_000);
    let output = '';
    child.once('exit', () => reject(new Error('fixture-exited')));
    child.stdout?.on('data', (chunk: Buffer | string) => {
      output += String(chunk);
      const lineEnd = output.indexOf('\n');
      if (lineEnd < 0) return;
      clearTimeout(timeout);
      try {
        resolvePromise(JSON.parse(output.slice(0, lineEnd)));
      } catch {
        reject(new Error('fixture-readiness-invalid'));
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
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runOfficialPeers(root: string, outputDirectory: string): Promise<OfficialConformanceResult[]> {
  const packageRoot = dirname(packageManifestPath(root, '@modelcontextprotocol/conformance'));
  const fixture = join(root, 'test/conformance/fixtures/typescript/src/fixture.mjs');
  const command = `${shellArgument(process.execPath)} ${shellArgument(fixture)}`;
  const results: OfficialConformanceResult[] = [];
  for (const revision of ['2025-11-25', '2026-07-28'] as const) {
    results.push(
      await runOfficialConformance({
        packageRoot,
        role: 'client',
        revision,
        command,
        temporaryParentDirectory: outputDirectory,
      }),
    );
    const server = await startTypescriptServer(root, revision === '2026-07-28' ? 'modern' : 'legacy', outputDirectory);
    try {
      results.push(
        await runOfficialConformance({
          packageRoot,
          role: 'server',
          revision,
          url: server.endpoint,
          temporaryParentDirectory: outputDirectory,
        }),
      );
    } finally {
      await server.close();
    }
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

function goPeer(binary: string, era: Era, role: 'inbound' | 'upstream'): PeerCommand {
  return role === 'upstream'
    ? {
        fixtureId: 'go-sdk',
        command: binary,
        args: ['server', '--transport', 'streamable-http', '--protocol-era', era],
      }
    : {
        fixtureId: 'go-sdk',
        command: binary,
        args: [
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

async function buildGoFixture(root: string, outputDirectory: string): Promise<string> {
  const binary = join(outputDirectory, 'go-fixture');
  await execFileAsync('go', ['build', '-mod=vendor', '-o', binary, '.'], {
    cwd: join(root, 'test/conformance/fixtures/go'),
    env: { PATH: process.env.PATH, HOME: join(outputDirectory, 'home'), GOCACHE: join(outputDirectory, 'go-build') },
    timeout: 90_000,
  });
  return binary;
}

function peer(root: string, goBinary: string, language: Language, era: Era, role: 'inbound' | 'upstream'): PeerCommand {
  if (language === 'typescript') return typescriptPeer(root, era, role);
  if (language === 'go') return goPeer(goBinary, era, role);
  return pythonPeer(root, era, role);
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
  const goBinary = await buildGoFixture(root, outputDirectory);
  const results: MatrixExecutionResult[] = [];
  for (const entry of entries) {
    const { descriptor } = entry;
    const inbound = peer(root, goBinary, entry.inboundLanguage, descriptor.inboundEra, 'inbound');
    const upstream = peer(root, goBinary, entry.upstreamLanguage, descriptor.upstreamEra, 'upstream');
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
      reasonCode: result.status === 'pass' ? ('probe-complete' as const) : ('unsupported-operation' as const),
      executedProfiles: transportProfilesSchema.parse(descriptor.executedProfiles),
      probe: {
        negotiatedRevision: canonicalRevisionSchema.parse(result.facts.negotiatedRevision),
        operations: canonicalOperationsSchema.parse(result.facts.operations),
      },
      evidence: {
        inbound: {
          artifactId: `wire.${result.assignmentId}.inbound`,
          digest: result.evidence.inbound.digest,
          records: result.evidence.inbound.records.length,
        },
        upstream: {
          artifactId: `wire.${result.assignmentId}.upstream`,
          digest: result.evidence.upstream.digest,
          records: result.evidence.upstream.records.length,
        },
      },
    };
  });
}

async function persistBaseline(outputDirectory: string, baseline: ConformanceBaseline): Promise<void> {
  const validated = validateConformanceBaseline(baseline);
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
  const proofs = profileProofFileSchema.safeParse(
    JSON.parse(await readFile(join(outputDirectory, 'profile-proofs.json'), 'utf8')),
  );

  if (!integrity.ok || !proofs.success) {
    const baseline = buildConformanceBaseline({
      mode: options.mode,
      sourceSha,
      integrity: {
        ok: integrity.ok && proofs.success,
        digest: integrity.digest,
        source: { clean: integrity.source.clean },
      },
      officialRuns: [],
      matrixPlan: [],
      matrixRuns: [],
      profileProofs: [],
      requiredProfiles: [...REQUIRED_TRANSPORT_PROFILES],
    });
    await persistBaseline(outputDirectory, baseline);
    return baseline;
  }

  const officialRuns = await runOfficialPeers(root, outputDirectory);
  const matrix = await runMatrix(root, outputDirectory);
  const baseline = buildConformanceBaseline({
    mode: options.mode,
    sourceSha,
    integrity: { ok: integrity.ok, digest: integrity.digest, source: { clean: integrity.source.clean } },
    officialRuns,
    matrixPlan: matrix.plan.map((assignment) => ({
      id: assignment.assignmentId,
      cellId: `${assignment.inboundEra}-${assignment.upstreamEra}`,
      variantKind: assignment.variant,
      profiles: transportProfilesSchema.parse(assignment.executedProfiles),
    })),
    matrixRuns: normalizedMatrixRuns(matrix.plan, matrix.results),
    profileProofs: proofs.data.profileProofs,
    requiredProfiles: [...REQUIRED_TRANSPORT_PROFILES],
  });
  await persistBaseline(outputDirectory, baseline);
  return baseline;
}

export async function removeFoundationOutputs(outputDirectory: string): Promise<void> {
  await rm(outputDirectory, { recursive: true, force: true });
}
