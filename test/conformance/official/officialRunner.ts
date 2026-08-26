import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { z } from 'zod';

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
  temporaryParentDirectory?: string;
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

async function parseReports(
  outputDirectory: string,
  role: OfficialConformanceRole,
  revision: OfficialConformanceRevision,
): Promise<SanitizedOfficialScenario[]> {
  const expectedScenarios = [...REQUIRED_SCENARIOS[revision][role], ...NOT_SCORED_SCENARIOS[revision][role]];
  const files = await findCheckFiles(outputDirectory);
  if (files.length === 0) throw new Error('missing');
  if (files.length !== expectedScenarios.length) throw new Error('invalid');

  const reports = new Map<string, SanitizedOfficialCheck[]>();
  for (const path of files) {
    if ((await stat(path)).size > 5 * 1024 * 1024) throw new Error('invalid');
    const scenarioId = scenarioFromDirectory(outputDirectory, path, role, expectedScenarios);
    if (!scenarioId || reports.has(scenarioId)) throw new Error('invalid');
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
    reports.set(scenarioId, checks);
  }

  if (expectedScenarios.some((scenario) => !reports.has(scenario))) throw new Error('invalid');
  return expectedScenarios.map((scenarioId) => ({ scenarioId, checks: reports.get(scenarioId)! }));
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
    workspace = await mkdtemp(join(options.temporaryParentDirectory ?? tmpdir(), '1mcp-official-conformance-'));
    const home = join(workspace, 'home');
    const temporaryDirectory = join(workspace, 'tmp');
    const outputDirectory = join(workspace, 'output');
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(temporaryDirectory, { recursive: true }),
      mkdir(outputDirectory, { recursive: true }),
    ]);

    const targetArgs = options.role === 'server' ? ['--url', options.url] : ['--command', options.command];
    executionStarted = true;
    const processResult = await executeOnce(
      resolve(options.packageRoot, 'dist', 'index.js'),
      [options.role, ...targetArgs, '--requirements', options.revision, '--output-dir', outputDirectory],
      sanitizedEnvironment(home, temporaryDirectory),
      timeoutMs,
      options.signal,
    );

    if (processResult.spawnFailed) result = { classification: 'process', ...identity, reason: 'spawn-failure' };
    else if (processResult.timedOut) result = { classification: 'process', ...identity, reason: 'timeout' };
    else if (processResult.aborted) result = { classification: 'process', ...identity, reason: 'aborted' };
    else if (processResult.signal) result = { classification: 'process', ...identity, reason: 'terminated' };
    else {
      let scenarios: SanitizedOfficialScenario[] | undefined;
      try {
        scenarios = await parseReports(outputDirectory, options.role, options.revision);
      } catch (error) {
        const noOutput = error instanceof Error && error.message === 'missing';
        result =
          noOutput && processResult.exitCode !== 0
            ? { classification: 'process', ...identity, reason: 'nonzero-exit' }
            : {
                classification: 'harness',
                ...identity,
                reason: noOutput ? 'missing-output' : 'artifact-invalid',
              };
      }

      if (scenarios) {
        const scoredScenarios = new Set(REQUIRED_SCENARIOS[options.revision][options.role]);
        const hasProductFailure = scenarios.some(
          (scenario) =>
            scoredScenarios.has(scenario.scenarioId) &&
            (scenario.checks.length === 0 || scenario.checks.some((check) => check.status !== 'SUCCESS')),
        );
        result =
          processResult.exitCode !== 0 && !hasProductFailure
            ? { classification: 'harness', ...identity, reason: 'exit-inconsistent' }
            : {
                classification: 'product',
                ...identity,
                productVerdict: hasProductFailure ? 'fail' : 'pass',
                scenarios,
                counts: countChecks(scenarios),
              };
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
