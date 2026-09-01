import { JSONRPCMessageSchema as ModernJSONRPCMessageSchema } from '@modelcontextprotocol/core';

import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { JSONRPCMessageSchema as LegacyJSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';

import { z } from 'zod';

import { createSanitizedWireCapture, startHttpWireTap } from '../capture/index.js';

type Environment = Record<string, string | undefined>;
type KillSignal = Parameters<ChildProcess['kill']>[0];

export const OFFICIAL_CONFORMANCE_PACKAGE = {
  name: '@modelcontextprotocol/conformance',
  version: '0.2.0-alpha.11',
} as const;

export const OFFICIAL_REQUIREMENT_DIGESTS = {
  '2025-11-25': 'f33a304dfa2cbd999c24026a3453a64f377bba0c8aa80addadaf05862d212371',
  '2026-07-28': 'ae2f4f6210fd729e2e318edd5bbfa31a43cee0bc608e48052fa26dbf1d939b57',
} as const;

export type OfficialConformanceRevision = keyof typeof OFFICIAL_REQUIREMENT_DIGESTS;
export type OfficialConformanceRole = 'client' | 'server';
export type OfficialCheckStatus = 'SUCCESS' | 'FAILURE' | 'WARNING' | 'SKIPPED';

// These inventories mirror the hash-pinned YAML so missing reports can be detected without trusting CLI text output.
const REQUIRED_SCENARIOS: Record<OfficialConformanceRevision, Record<OfficialConformanceRole, readonly string[]>> = {
  '2025-11-25': {
    server: [
      'server-initialize',
      'logging-set-level',
      'ping',
      'completion-complete',
      'tools-list',
      'tools-call-simple-text',
      'tools-call-image',
      'tools-call-audio',
      'tools-call-embedded-resource',
      'tools-call-mixed-content',
      'tools-call-with-logging',
      'tools-call-error',
      'tools-call-with-progress',
      'tools-call-sampling',
      'tools-call-elicitation',
      'elicitation-sep1034-defaults',
      'server-sse-multiple-streams',
      'elicitation-sep1330-enums',
      'resources-list',
      'resources-read-text',
      'resources-read-binary',
      'resources-templates-read',
      'resources-subscribe',
      'resources-unsubscribe',
      'prompts-list',
      'prompts-get-simple',
      'prompts-get-with-args',
      'prompts-get-embedded-resource',
      'prompts-get-with-image',
      'dns-rebinding-protection',
    ],
    client: [
      'initialize',
      'tools_call',
      'elicitation-sep1034-client-defaults',
      'sse-retry',
      'auth/metadata-default',
      'auth/metadata-var1',
      'auth/metadata-var2',
      'auth/metadata-var3',
      'auth/basic-cimd',
      'auth/scope-from-www-authenticate',
      'auth/scope-from-scopes-supported',
      'auth/scope-omitted-when-undefined',
      'auth/scope-step-up',
      'auth/scope-retry-limit',
      'auth/token-endpoint-auth-basic',
      'auth/token-endpoint-auth-post',
      'auth/token-endpoint-auth-none',
      'auth/pre-registration',
    ],
  },
  '2026-07-28': {
    server: [
      'server-stateless',
      'completion-complete',
      'tools-list',
      'tools-call-simple-text',
      'tools-call-image',
      'tools-call-audio',
      'tools-call-embedded-resource',
      'tools-call-mixed-content',
      'tools-call-error',
      'tools-call-with-progress',
      'server-sse-multiple-streams',
      'resources-list',
      'resources-read-text',
      'resources-read-binary',
      'resources-templates-read',
      'sep-2164-resource-not-found',
      'prompts-list',
      'prompts-get-simple',
      'prompts-get-with-args',
      'prompts-get-embedded-resource',
      'prompts-get-with-image',
      'dns-rebinding-protection',
      'caching',
      'input-required-result-basic-elicitation',
      'input-required-result-basic-sampling',
      'input-required-result-basic-list-roots',
      'input-required-result-request-state',
      'input-required-result-multiple-input-requests',
      'input-required-result-multi-round',
      'input-required-result-missing-input-response',
      'input-required-result-non-tool-request',
      'input-required-result-result-type',
      'input-required-result-unsupported-methods',
      'input-required-result-tampered-state',
      'input-required-result-capability-check',
      'input-required-result-ignore-extra-params',
      'input-required-result-validate-input',
    ],
    client: [
      'tools_call',
      'request-metadata',
      'auth/metadata-default',
      'auth/metadata-var1',
      'auth/metadata-var2',
      'auth/metadata-var3',
      'auth/basic-cimd',
      'auth/scope-from-www-authenticate',
      'auth/scope-from-scopes-supported',
      'auth/scope-omitted-when-undefined',
      'auth/scope-step-up',
      'auth/scope-retry-limit',
      'auth/token-endpoint-auth-basic',
      'auth/token-endpoint-auth-post',
      'auth/token-endpoint-auth-none',
      'auth/pre-registration',
      'auth/resource-mismatch',
      'auth/offline-access-scope',
      'auth/offline-access-not-supported',
      'auth/authorization-server-migration',
      'auth/iss-supported',
      'auth/iss-not-advertised',
      'auth/iss-supported-missing',
      'auth/iss-wrong-issuer',
      'auth/iss-unexpected',
      'auth/iss-normalized',
      'auth/metadata-issuer-mismatch',
      'sep-2322-client-request-state',
      'http-standard-headers',
      'http-custom-headers',
      'http-invalid-tool-headers',
      'json-schema-ref-no-deref',
    ],
  },
};

const NOT_SCORED_SCENARIOS: Record<OfficialConformanceRevision, Record<OfficialConformanceRole, readonly string[]>> = {
  '2025-11-25': {
    server: ['server-session-lifecycle', 'json-schema-2020-12', 'server-sse-polling'],
    client: [
      'auth/client-credentials-jwt',
      'auth/client-credentials-basic',
      'auth/enterprise-managed-authorization',
      'auth/dpop',
      'auth/dpop-nonce',
      'auth/wif-jwt-bearer',
      'json-schema-2020-12-preservation',
    ],
  },
  '2026-07-28': {
    server: [
      'tasks-lifecycle',
      'tasks-capability-negotiation',
      'tasks-wire-fields',
      'tasks-request-state-removal',
      'tasks-mrtr-input',
      'tasks-request-headers',
      'tasks-dispatch-and-envelope',
      'tasks-status-notifications',
      'tasks-required-task-error',
      'tasks-mrtr-composition',
      'json-schema-2020-12',
      'http-header-validation',
      'http-custom-header-server-validation',
    ],
    client: [
      'auth/client-credentials-jwt',
      'auth/client-credentials-basic',
      'auth/enterprise-managed-authorization',
      'auth/dpop',
      'auth/dpop-nonce',
      'auth/wif-jwt-bearer',
      'json-schema-2020-12-preservation',
    ],
  },
};

export function officialScenarioIds(revision: OfficialConformanceRevision, role: OfficialConformanceRole): string[] {
  return [...REQUIRED_SCENARIOS[revision][role], ...NOT_SCORED_SCENARIOS[revision][role]];
}

export function officialClientScenarioIds(revision: OfficialConformanceRevision): string[] {
  return officialScenarioIds(revision, 'client');
}

const packageMetadataSchema = z.object({
  name: z.literal(OFFICIAL_CONFORMANCE_PACKAGE.name),
  version: z.literal(OFFICIAL_CONFORMANCE_PACKAGE.version),
});
const safeIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/#$-]*$/);
const rawCheckSchema = z.object({
  id: safeIdSchema,
  status: z.enum(['SUCCESS', 'FAILURE', 'WARNING', 'SKIPPED', 'INFO']),
  specReferences: z
    .array(z.object({ id: safeIdSchema }))
    .max(64)
    .optional(),
});
const rawChecksSchema = z.array(rawCheckSchema).max(10_000);
const officialEvidenceArtifactPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.enum(['client', 'server']),
    revision: z.enum(['2025-11-25', '2026-07-28']),
    productVerdict: z.enum(['pass', 'fail']),
    scenarios: z.array(
      z
        .object({
          scenarioId: safeIdSchema,
          checks: z.array(
            z
              .object({
                id: safeIdSchema,
                status: z.enum(['SUCCESS', 'FAILURE', 'WARNING', 'SKIPPED']),
                specReferenceIds: z.array(safeIdSchema),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    counts: z
      .object({
        SUCCESS: z.number().int().nonnegative(),
        FAILURE: z.number().int().nonnegative(),
        WARNING: z.number().int().nonnegative(),
        SKIPPED: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const OfficialEvidenceArtifactSchema = officialEvidenceArtifactPayloadSchema
  .extend({ digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u) })
  .strict();

export interface VerifiedOfficialConformancePackage {
  name: typeof OFFICIAL_CONFORMANCE_PACKAGE.name;
  version: typeof OFFICIAL_CONFORMANCE_PACKAGE.version;
  requirementDigests: typeof OFFICIAL_REQUIREMENT_DIGESTS;
}

type FixtureErrorCode = 'package-invalid' | 'requirement-integrity';

export class OfficialConformanceFixtureError extends Error {
  readonly code: FixtureErrorCode;

  constructor(code: FixtureErrorCode) {
    super(code);
    this.name = 'OfficialConformanceFixtureError';
    this.code = code;
  }
}

export interface SanitizedOfficialCheck {
  id: string;
  status: OfficialCheckStatus;
  specReferenceIds: string[];
}

export interface SanitizedOfficialScenario {
  scenarioId: string;
  checks: SanitizedOfficialCheck[];
}

export interface OfficialCheckCounts {
  SUCCESS: number;
  FAILURE: number;
  WARNING: number;
  SKIPPED: number;
  total: number;
}

export type OfficialConformanceResult =
  | {
      classification: 'product';
      role: OfficialConformanceRole;
      revision: OfficialConformanceRevision;
      productVerdict: 'pass' | 'fail';
      scenarios: SanitizedOfficialScenario[];
      counts: OfficialCheckCounts;
      artifact: { artifactId: string; digest: `sha256:${string}` };
    }
  | {
      classification: 'fixture';
      role: OfficialConformanceRole;
      revision: OfficialConformanceRevision;
      reason: 'invalid-package' | 'invalid-target' | 'invalid-workspace';
    }
  | {
      classification: 'process';
      role: OfficialConformanceRole;
      revision: OfficialConformanceRevision;
      reason: 'spawn-failure' | 'nonzero-exit' | 'terminated' | 'timeout' | 'aborted';
    }
  | {
      classification: 'harness';
      role: OfficialConformanceRole;
      revision: OfficialConformanceRevision;
      reason: 'missing-output' | 'artifact-invalid' | 'exit-inconsistent' | 'cleanup-failure';
    };

interface CommonRunOptions {
  packageRoot: string;
  revision: OfficialConformanceRevision;
  timeoutMs?: number;
  signal?: AbortSignal;
  temporaryParentDirectory: string;
}

export type OfficialConformanceRunOptions = CommonRunOptions &
  ({ role: 'server'; url: string; command?: never } | { role: 'client'; command: string; url?: never });

interface ProcessResult {
  exitCode: number | null;
  signal: string | null;
  spawnFailed: boolean;
  timedOut: boolean;
  aborted: boolean;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function officialArtifactDigest(payload: z.infer<typeof officialEvidenceArtifactPayloadSchema>): `sha256:${string}` {
  return `sha256:${sha256(Buffer.from(JSON.stringify(payload)))}`;
}

export async function readOfficialEvidenceArtifact(
  root: string,
  reference: { artifactId: string; digest: string },
): Promise<z.infer<typeof OfficialEvidenceArtifactSchema>> {
  if (!/^official-evidence\/(client|server)\.(2025-11-25|2026-07-28)\.json$/u.test(reference.artifactId)) {
    throw new Error('Official evidence artifact reference invalid');
  }
  const artifact = OfficialEvidenceArtifactSchema.parse(
    JSON.parse(await readFile(resolve(root, reference.artifactId), 'utf8')),
  );
  const { digest, ...payload } = artifact;
  if (digest !== reference.digest || digest !== officialArtifactDigest(payload)) {
    throw new Error('Official evidence artifact digest mismatch');
  }
  return artifact;
}

async function persistOfficialEvidenceArtifact(
  root: string,
  payload: z.infer<typeof officialEvidenceArtifactPayloadSchema>,
): Promise<{ artifactId: string; digest: `sha256:${string}` }> {
  const validated = officialEvidenceArtifactPayloadSchema.parse(payload);
  const artifactId = `official-evidence/${validated.role}.${validated.revision}.json`;
  const reference = { artifactId, digest: officialArtifactDigest(validated) } as const;
  await mkdir(resolve(root, 'official-evidence'), { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(root, artifactId),
    `${JSON.stringify({ ...validated, digest: reference.digest }, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  );
  await readOfficialEvidenceArtifact(root, reference);
  return reference;
}

async function ensureFileWithin(packageRoot: string, path: string): Promise<void> {
  const [realRoot, realFile] = await Promise.all([realpath(packageRoot), realpath(path)]);
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${sep}`)) {
    throw new OfficialConformanceFixtureError('package-invalid');
  }
  if (!(await stat(realFile)).isFile()) throw new OfficialConformanceFixtureError('package-invalid');
}

export async function verifyOfficialConformancePackage(
  packageRoot: string,
): Promise<VerifiedOfficialConformancePackage> {
  try {
    const metadataPath = resolve(packageRoot, 'package.json');
    const entryPoint = resolve(packageRoot, 'dist', 'index.js');
    await Promise.all([ensureFileWithin(packageRoot, metadataPath), ensureFileWithin(packageRoot, entryPoint)]);
    packageMetadataSchema.parse(JSON.parse(await readFile(metadataPath, 'utf8')));

    for (const revision of Object.keys(OFFICIAL_REQUIREMENT_DIGESTS) as OfficialConformanceRevision[]) {
      const requirementPath = resolve(packageRoot, 'requirements', `${revision}.yaml`);
      await ensureFileWithin(packageRoot, requirementPath);
      if (sha256(await readFile(requirementPath)) !== OFFICIAL_REQUIREMENT_DIGESTS[revision]) {
        throw new OfficialConformanceFixtureError('requirement-integrity');
      }
    }
  } catch (error) {
    if (error instanceof OfficialConformanceFixtureError) throw error;
    throw new OfficialConformanceFixtureError('package-invalid');
  }

  return {
    ...OFFICIAL_CONFORMANCE_PACKAGE,
    requirementDigests: OFFICIAL_REQUIREMENT_DIGESTS,
  };
}

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      (url.hostname === '127.0.0.1' ||
        url.hostname === '::1' ||
        url.hostname === '[::1]' ||
        url.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

function isValidClientCommand(value: string): boolean {
  return value.length > 0 && value.length <= 8_192 && !/[\0\r\n]/.test(value);
}

function sanitizedEnvironment(home: string, temporaryDirectory: string): Environment {
  const environment: Environment = {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
  };

  for (const name of ['PATH', 'SystemRoot', 'ComSpec', 'PATHEXT'] as const) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

function terminateOwnedProcess(child: ChildProcess, signal: KillSignal): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The process may have exited between the state check and signal delivery.
  }
}

function executeOnce(
  entryPoint: string,
  args: string[],
  environment: Environment,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  return new Promise((resolveProcess) => {
    if (signal?.aborted) {
      resolveProcess({ exitCode: null, signal: null, spawnFailed: false, timedOut: false, aborted: true });
      return;
    }

    const child = spawn(process.execPath, [entryPoint, ...args], {
      detached: process.platform !== 'win32',
      env: environment,
      stdio: 'ignore',
    });
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const terminate = (reason: 'timeout' | 'aborted') => {
      timedOut ||= reason === 'timeout';
      aborted ||= reason === 'aborted';
      terminateOwnedProcess(child, 'SIGTERM');
      forceKillTimer = setTimeout(() => terminateOwnedProcess(child, 'SIGKILL'), 2_000);
      forceKillTimer.unref();
    };
    const timeout = setTimeout(() => terminate('timeout'), timeoutMs);
    timeout.unref();
    const abort = () => terminate('aborted');
    signal?.addEventListener('abort', abort, { once: true });

    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener('abort', abort);
      resolveProcess(result);
    };

    child.once('error', () => {
      finish({ exitCode: null, signal: null, spawnFailed: true, timedOut, aborted });
    });
    child.once('close', (exitCode, closeSignal) => {
      terminateOwnedProcess(child, timedOut || aborted ? 'SIGKILL' : 'SIGTERM');
      finish({ exitCode, signal: closeSignal, spawnFailed: false, timedOut, aborted });
    });
  });
}

async function findCheckFiles(root: string, directory = root, depth = 0): Promise<string[]> {
  if (depth > 4) throw new Error('artifact depth');
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('artifact symlink');
    if (entry.isDirectory()) paths.push(...(await findCheckFiles(root, path, depth + 1)));
    else if (entry.isFile() && entry.name === 'checks.json') paths.push(path);
  }
  return paths;
}

function scenarioFromDirectory(
  outputDirectory: string,
  checkPath: string,
  role: OfficialConformanceRole,
  expectedScenarios: readonly string[],
): string | undefined {
  const directory = relative(outputDirectory, dirname(checkPath)).split(sep).join('/');
  const timestamp = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z';
  return [...expectedScenarios]
    .sort((left, right) => right.length - left.length)
    .find((scenario) => {
      const escaped = scenario.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefix = role === 'server' ? `server-${escaped}` : escaped;
      return new RegExp(`^${prefix}-${timestamp}$`).test(directory);
    });
}

async function parseScenarioReport(
  outputDirectory: string,
  role: OfficialConformanceRole,
  scenarioId: string,
): Promise<SanitizedOfficialScenario> {
  const files = await findCheckFiles(outputDirectory);
  if (files.length === 0) throw new Error('missing');
  if (files.length !== 1) throw new Error('invalid');

  const path = files[0];
  if ((await stat(path)).size > 5 * 1024 * 1024) throw new Error('invalid');
  if (scenarioFromDirectory(outputDirectory, path, role, [scenarioId]) !== scenarioId) throw new Error('invalid');
  const rawChecks = rawChecksSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const checks = rawChecks.flatMap<SanitizedOfficialCheck>((check) => {
    if (check.status === 'INFO') return [];
    return [
      {
        id: check.id,
        status: check.status,
        specReferenceIds: [...new Set(check.specReferences?.map((reference) => reference.id) ?? [])],
      },
    ];
  });
  return { scenarioId, checks };
}

const NO_OUTPUT_OBSERVATION: SanitizedOfficialCheck = {
  id: 'official-runner-no-output',
  status: 'FAILURE',
  specReferenceIds: [],
};
const SCHEMA_INVALID_TARGET_OBSERVATION: SanitizedOfficialCheck = {
  id: 'official-target-schema-invalid',
  status: 'FAILURE',
  specReferenceIds: [],
};
const REVIEWED_UNEXPECTED_ERROR_FALLBACK_SCENARIOS: Record<OfficialConformanceRevision, ReadonlySet<string>> = {
  '2025-11-25': new Set(),
  '2026-07-28': new Set(['tasks-capability-negotiation']),
};

function processFailure(
  processResult: ProcessResult,
  identity: { role: OfficialConformanceRole; revision: OfficialConformanceRevision },
): OfficialConformanceResult | undefined {
  if (processResult.spawnFailed) return { classification: 'process', ...identity, reason: 'spawn-failure' };
  if (processResult.timedOut) return { classification: 'process', ...identity, reason: 'timeout' };
  if (processResult.aborted) return { classification: 'process', ...identity, reason: 'aborted' };
  if (processResult.signal) return { classification: 'process', ...identity, reason: 'terminated' };
  return undefined;
}

function validatorForRevision(revision: OfficialConformanceRevision): (envelope: Record<string, unknown>) => boolean {
  const schema = revision === '2026-07-28' ? ModernJSONRPCMessageSchema : LegacyJSONRPCMessageSchema;
  return (envelope) => schema.safeParse(envelope).success;
}

function tappedTarget(tapOrigin: string, target: string): string {
  const original = new URL(target);
  return `${tapOrigin}${original.pathname}${original.search}`;
}

function countChecks(scenarios: SanitizedOfficialScenario[]): OfficialCheckCounts {
  const counts: OfficialCheckCounts = { SUCCESS: 0, FAILURE: 0, WARNING: 0, SKIPPED: 0, total: 0 };
  for (const scenario of scenarios) {
    for (const check of scenario.checks) {
      counts[check.status] += 1;
      counts.total += 1;
    }
  }
  return counts;
}

export async function runOfficialConformance(
  options: OfficialConformanceRunOptions,
): Promise<OfficialConformanceResult> {
  const identity = { role: options.role, revision: options.revision } as const;
  try {
    await verifyOfficialConformancePackage(options.packageRoot);
  } catch {
    return { classification: 'fixture', ...identity, reason: 'invalid-package' };
  }

  const targetIsValid = options.role === 'server' ? isLoopbackUrl(options.url) : isValidClientCommand(options.command);
  if (!targetIsValid) return { classification: 'fixture', ...identity, reason: 'invalid-target' };

  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60 * 60_000) {
    return { classification: 'fixture', ...identity, reason: 'invalid-target' };
  }

  let workspace: string | undefined;
  let executionStarted = false;
  let result: OfficialConformanceResult | undefined;
  try {
    workspace = await mkdtemp(join(options.temporaryParentDirectory, '1mcp-official-conformance-'));
    const home = join(workspace, 'home');
    const temporaryDirectory = join(workspace, 'tmp');
    const outputDirectory = join(workspace, 'output');
    await Promise.all([mkdir(home, { recursive: true }), mkdir(temporaryDirectory, { recursive: true })]);

    const expectedScenarios = [
      ...REQUIRED_SCENARIOS[options.revision][options.role],
      ...NOT_SCORED_SCENARIOS[options.revision][options.role],
    ];
    const scenarios: SanitizedOfficialScenario[] = [];
    for (const [index, scenarioId] of expectedScenarios.entries()) {
      const scenarioOutputDirectory = join(outputDirectory, String(index));
      await mkdir(scenarioOutputDirectory, { recursive: true });
      let targetErrorSchemaResult: 'valid' | 'invalid' | undefined;
      let closeTap: ((waitForErrorEvidence: boolean) => Promise<void>) | undefined;
      let targetArgs: string[];
      if (options.role === 'server') {
        const capture = createSanitizedWireCapture({
          contexts: [{ id: `official-${index}`, negotiatedRevision: options.revision }],
          validateEnvelope: validatorForRevision(options.revision),
        });
        const tap = await startHttpWireTap({
          target: options.url,
          capture,
          contextId: `official-${index}`,
          hop: 'inbound',
        });
        targetArgs = ['--url', tappedTarget(tap.url, options.url)];
        const captureTargetError = (): void => {
          const retained = capture
            .snapshot()
            .records.find(
              (record) =>
                record.direction === 'gateway_to_client' &&
                record.correlation === 'error' &&
                (record.schemaResult === 'valid' || record.schemaResult === 'invalid') &&
                record.contentKind === 'json' &&
                record.envelope.error,
            );
          if (retained?.schemaResult === 'valid' || retained?.schemaResult === 'invalid') {
            targetErrorSchemaResult = retained.schemaResult;
          }
        };
        closeTap = async (waitForErrorEvidence) => {
          const deadline = Date.now() + (waitForErrorEvidence ? 500 : 0);
          do {
            captureTargetError();
            if (targetErrorSchemaResult || !waitForErrorEvidence) break;
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
          } while (Date.now() < deadline);
          await tap.close();
        };
      } else {
        targetArgs = ['--command', options.command];
      }
      executionStarted = true;
      const processResult = await executeOnce(
        resolve(options.packageRoot, 'dist', 'index.js'),
        [
          options.role,
          ...targetArgs,
          '--scenario',
          scenarioId,
          '--spec-version',
          options.revision,
          '--force',
          '--output-dir',
          scenarioOutputDirectory,
        ],
        sanitizedEnvironment(home, temporaryDirectory),
        timeoutMs,
        options.signal,
      );
      try {
        await closeTap?.(processResult.exitCode !== 0);
      } catch {
        result = { classification: 'harness', ...identity, reason: 'cleanup-failure' };
        break;
      }
      result = processFailure(processResult, identity);
      if (result) break;

      let scenario: SanitizedOfficialScenario;
      try {
        scenario = await parseScenarioReport(scenarioOutputDirectory, options.role, scenarioId);
      } catch (error) {
        const noOutput = error instanceof Error && error.message === 'missing';
        if (
          noOutput &&
          processResult.exitCode !== 0 &&
          options.role === 'server' &&
          targetErrorSchemaResult === 'invalid' &&
          REVIEWED_UNEXPECTED_ERROR_FALLBACK_SCENARIOS[options.revision].has(scenarioId)
        ) {
          scenarios.push({
            scenarioId,
            checks: [
              {
                ...(targetErrorSchemaResult === 'invalid' ? SCHEMA_INVALID_TARGET_OBSERVATION : NO_OUTPUT_OBSERVATION),
              },
            ],
          });
          continue;
        }
        if (noOutput && processResult.exitCode !== 0) {
          result = { classification: 'process', ...identity, reason: 'nonzero-exit' };
          break;
        }
        result = {
          classification: 'harness',
          ...identity,
          reason: noOutput ? 'missing-output' : 'artifact-invalid',
        };
        break;
      }

      if (processResult.exitCode !== 0 && scenario.checks.every((check) => check.status === 'SUCCESS')) {
        result = { classification: 'harness', ...identity, reason: 'exit-inconsistent' };
        break;
      }
      scenarios.push(scenario);
    }

    if (!result) {
      const scoredScenarios = new Set(REQUIRED_SCENARIOS[options.revision][options.role]);
      const hasProductFailure = scenarios.some(
        (scenario) =>
          scoredScenarios.has(scenario.scenarioId) &&
          (scenario.checks.length === 0 || scenario.checks.some((check) => check.status !== 'SUCCESS')),
      );
      const productVerdict = hasProductFailure ? 'fail' : 'pass';
      const counts = countChecks(scenarios);
      try {
        const artifact = await persistOfficialEvidenceArtifact(options.temporaryParentDirectory, {
          schemaVersion: 1,
          ...identity,
          productVerdict,
          scenarios,
          counts,
        });
        result = { classification: 'product', ...identity, productVerdict, scenarios, counts, artifact };
      } catch {
        result = { classification: 'harness', ...identity, reason: 'artifact-invalid' };
      }
    }
  } catch {
    result = executionStarted
      ? { classification: 'process', ...identity, reason: 'spawn-failure' }
      : { classification: 'fixture', ...identity, reason: 'invalid-workspace' };
  }

  result ??= { classification: 'harness', ...identity, reason: 'artifact-invalid' };
  if (workspace) {
    try {
      await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      return { classification: 'harness', ...identity, reason: 'cleanup-failure' };
    }
  }
  return result;
}
