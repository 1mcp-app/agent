import { spawn, type SpawnOptions } from 'child_process';
import fs from 'fs';
import path from 'path';

import { ConfigManager } from '@src/config/configManager.js';
import { cleanupBackgroundLaunchConfig, writeBackgroundLaunchConfig } from '@src/core/server/backgroundLaunchConfig.js';
import {
  type BackgroundSupervisorDependencies,
  type BackgroundSupervisorEvent,
  type BackgroundSupervisorOptions,
  cleanupBackgroundSupervisorState,
  runBackgroundRuntimeSupervisor,
} from '@src/core/server/backgroundRuntimeSupervisor.js';
import {
  type BackgroundSupervisorState,
  readBackgroundSupervisorState,
} from '@src/core/server/backgroundRuntimeSupervisorState.js';
import { isProcessAlive, readPidFile, ServerPidInfo } from '@src/core/server/pidFileManager.js';
import {
  discoverScopedRuntime,
  type LoadingSummarySnapshot,
  probeLoadingSummary,
  probeReadiness,
  ReadinessProbe,
} from '@src/core/server/runtimeLifecycle.js';
import { claimRuntimeScope, type RuntimeScopeOwnership } from '@src/core/server/runtimeScopeOwnership.js';
import type { ApplicationConfig } from '@src/core/types/transport.js';
import logger from '@src/logger/logger.js';
import { resolveLoggingConfig } from '@src/logger/loggingConfig.js';
import { normalizedArgv } from '@src/utils/cli/normalizedArgv.js';

import { resolveServeConfigPaths } from './runtimeScope.js';
import type { ServeOptions } from './serve.js';

/**
 * `serve --background`: start a detached persistent supervisor for the selected
 * Runtime Scope, then return once its current worker is ready.
 *
 * The launcher never serves. The supervisor owns the Runtime Scope, starts
 * authorized workers, and remains resident across retries and crash-loop state.
 */

/** Internal guard flag name; mirrors the hidden yargs option in `index.ts`. */
export const BACKGROUND_GUARD_FLAG = 'background-bootstrap';
export const RUNTIME_OWNER_CLAIM_ID_FLAG = 'runtime-owner-claim-id';
export const BACKGROUND_LAUNCH_CONFIG_FLAG = 'background-launch-config';

const BACKGROUND_STARTUP_OPTION_KEYS = [
  'config',
  'config-dir',
  'log-level',
  'log-file',
  'transport',
  'port',
  'host',
  'external-url',
  'preset',
  'filter',
  'pagination',
  'auth',
  'enable-auth',
  'enable-scope-validation',
  'enable-enhanced-security',
  'session-ttl',
  'session-storage-path',
  'rate-limit-window',
  'rate-limit-max',
  'trust-proxy',
  'health-info-level',
  'enable-async-loading',
  'async-min-servers',
  'async-timeout',
  'async-batch-notifications',
  'async-batch-delay',
  'async-notify-on-ready',
  'enable-lazy-loading',
  'lazy-mode',
  'lazy-inline-catalog',
  'lazy-catalog-format',
  'lazy-direct-expose',
  'lazy-cache-max-entries',
  'lazy-cache-ttl',
  'lazy-preload',
  'lazy-preload-keywords',
  'lazy-fallback-on-error',
  'lazy-fallback-timeout',
  'enable-config-reload',
  'config-reload-debounce',
  'enable-env-substitution',
  'enable-session-persistence',
  'session-persist-requests',
  'session-persist-interval',
  'session-background-flush',
  'enable-client-notifications',
  'enable-jsonrpc-error-logging',
  'enable-internal-tools',
  'internal-tools',
  'instructions-template',
] as const satisfies readonly (keyof ServeOptions)[];

/** Default log file for a background runtime when none is configured. */
export function defaultBackgroundLogFile(configDir: string): string {
  return path.join(configDir, 'logs', 'server.log');
}

/**
 * Build the child's serve arguments: strip flags the parent overrides
 * (lifecycle actions, `--transport`/`-t`, `--log-file`, and the guard —
 * including their `=`-joined forms) and re-append the HTTP transport, the
 * resolved log file, and the guard flag. Background is HTTP-only, so the child
 * is always forced onto `--transport http`.
 */
export function buildBackgroundChildArgs(serveArgs: string[], opts: { logFile: string }): string[] {
  const out = stripBackgroundManagedArgs(serveArgs);
  out.push('--transport', 'http', '--log-file', opts.logFile, `--${BACKGROUND_GUARD_FLAG}`);
  return out;
}

/** Materialize parsed CLI, environment, and default values for the supervisor. */
export function buildBackgroundSupervisorArgs(parsedArgv: ServeOptions, opts: { logFile: string }): string[] {
  const args: string[] = [];
  for (const key of BACKGROUND_STARTUP_OPTION_KEYS) {
    if (key === 'transport' || key === 'log-file') continue;
    const value = parsedArgv[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      args.push(`--${key}=${String(value)}`);
    }
  }
  args.push('--transport=http', `--log-file=${opts.logFile}`, `--${BACKGROUND_GUARD_FLAG}`);
  return args;
}

/** Build the immutable effective invocation used for every supervised worker. */
export function buildBackgroundWorkerArgs(
  serveArgs: string[],
  opts: { logFile: string; claimId: string; launchConfigFile?: string },
): string[] {
  const out = stripBackgroundManagedArgs(serveArgs);
  out.push('--transport', 'http', '--log-file', opts.logFile, `--${RUNTIME_OWNER_CLAIM_ID_FLAG}`, opts.claimId);
  if (opts.launchConfigFile) out.push(`--${BACKGROUND_LAUNCH_CONFIG_FLAG}`, opts.launchConfigFile);
  return out;
}

function stripBackgroundManagedArgs(serveArgs: string[]): string[] {
  const stripWithValue = new Set([
    '--transport',
    '-t',
    '--log-file',
    `--${RUNTIME_OWNER_CLAIM_ID_FLAG}`,
    `--${BACKGROUND_LAUNCH_CONFIG_FLAG}`,
  ]);
  const out: string[] = [];

  for (let i = 0; i < serveArgs.length; i++) {
    const token = serveArgs[i];

    if (
      /^--(?:background|restart|status|stop)(?:=.*)?$/.test(token) ||
      /^--background-bootstrap(?:=.*)?$/.test(token)
    ) {
      continue;
    }
    if (/^--(transport|log-file|runtime-owner-claim-id|background-launch-config)=/.test(token) || /^-t=/.test(token)) {
      continue;
    }
    if (stripWithValue.has(token)) {
      i++; // also skip the following value
      continue;
    }
    out.push(token);
  }

  return out;
}

/**
 * Resolve how to re-invoke this executable cross-platform.
 * - Under Node: `process.execPath` (node) + the JS entry script.
 * - As a packaged SEA binary: `process.execPath` is the binary itself, no script.
 */
export function resolveSelfInvocation(argv: string[] = process.argv): { command: string; baseArgs: string[] } {
  const script = argv[1];
  if (script && /\.(c|m)?js$/.test(script)) {
    return { command: process.execPath, baseArgs: [script] };
  }
  return { command: process.execPath, baseArgs: [] };
}

/** Strip the single `serve` command token (it is re-added explicitly on spawn). */
function stripServeToken(args: string[]): string[] {
  const index = args.indexOf('serve');
  if (index === -1) {
    return [...args];
  }
  return [...args.slice(0, index), ...args.slice(index + 1)];
}

/** A point-in-time snapshot of the background-startup wait, for progress UIs. */
export interface BackgroundProgress {
  /** Milliseconds elapsed since the wait began. */
  elapsedMs: number;
  /** The current worker's PID record once it appears; undefined while still spawning. */
  info?: ServerPidInfo;
}

export interface WaitForReadyOptions {
  timeoutMs?: number;
  intervalMs?: number;
  readinessProbe?: ReadinessProbe;
  isChildAlive?: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Invoked once per poll iteration with the current wait snapshot. */
  onProgress?: (progress: BackgroundProgress) => void;
}

export interface WaitForReadyResult {
  ready: boolean;
  info?: ServerPidInfo;
  reason?: string;
  /** True when the resident supervisor has exhausted automatic retries. */
  terminal?: boolean;
}

/**
 * Wait until the child's PID file identifies the spawned child AND
 * `/health/ready` succeeds, or until timeout / worker exit.
 */
export async function waitForBackgroundReady(
  configDir: string,
  childPid: number,
  options: WaitForReadyOptions = {},
): Promise<WaitForReadyResult> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const intervalMs = options.intervalMs ?? 250;
  const probe = options.readinessProbe ?? probeReadiness;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const start = now();
  while (now() - start < timeoutMs) {
    if (options.isChildAlive && !options.isChildAlive()) {
      return { ready: false, reason: 'background process exited before becoming ready' };
    }

    const info = readPidFile(configDir);
    options.onProgress?.({ elapsedMs: now() - start, info: info ?? undefined });
    if (info && info.pid === childPid && (await probe(info))) {
      return { ready: true, info };
    }

    await sleep(intervalMs);
  }

  return { ready: false, reason: `timed out after ${timeoutMs}ms waiting for readiness` };
}

export interface WaitForSupervisorReadyOptions {
  intervalMs?: number;
  readinessProbe?: ReadinessProbe;
  isSupervisorAlive?: (pid: number) => boolean;
  readState?: (configDir: string) => BackgroundSupervisorState | null;
  readRuntimeInfo?: (configDir: string) => ServerPidInfo | null;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (progress: BackgroundProgress) => void;
}

/** Wait through worker replacement until readiness or terminal crash-loop. */
export async function waitForBackgroundSupervisorReady(
  configDir: string,
  supervisorPid: number,
  options: WaitForSupervisorReadyOptions = {},
): Promise<WaitForReadyResult> {
  const intervalMs = options.intervalMs ?? 250;
  const probe = options.readinessProbe ?? probeReadiness;
  const processAlive = options.isSupervisorAlive ?? isProcessAlive;
  const readState = options.readState ?? readBackgroundSupervisorState;
  const readRuntimeInfo = options.readRuntimeInfo ?? readPidFile;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startedAt = Date.now();

  for (;;) {
    if (!processAlive(supervisorPid)) {
      return { ready: false, reason: 'background supervisor exited before the runtime became ready' };
    }
    const state = readState(configDir);
    if (state?.supervisorPid === supervisorPid) {
      if (state.status === 'crash-loop') {
        return { ready: false, terminal: true, reason: 'background runtime entered crash-loop' };
      }
      if (state.runtimePid !== null) {
        const info = readRuntimeInfo(configDir);
        options.onProgress?.({ elapsedMs: Date.now() - startedAt, info: info ?? undefined });
        if (info?.pid === state.runtimePid && (await probe(info))) {
          return { ready: true, info };
        }
      } else {
        options.onProgress?.({ elapsedMs: Date.now() - startedAt });
      }
    }
    await sleep(intervalMs);
  }
}

/** Minimal shape of the detached supervisor the launcher depends on. */
export interface SpawnedSupervisor {
  pid?: number;
  unref(): void;
  once(event: 'exit', listener: () => void): void;
  killed?: boolean;
}

/** @deprecated Compatibility alias; background launch now spawns a supervisor. */
export type SpawnedChild = SpawnedSupervisor;

export interface RunBackgroundDeps {
  /** Raw CLI argv (after node/cli), defaults to the process's normalized argv. */
  rawArgv?: string[];
  spawnChild?: (command: string, args: string[], options: SpawnOptions) => SpawnedSupervisor;
  waitForReady?: (
    configDir: string,
    supervisorPid: number,
    options: WaitForSupervisorReadyOptions,
  ) => Promise<WaitForReadyResult>;
  killChild?: (pid: number) => void;
  loadAppConfig?: (parsedArgv: ServeOptions) => ApplicationConfig;
}

export interface RunBackgroundSupervisorDeps {
  rawArgv?: string[];
  loadAppConfig?: RunBackgroundDeps['loadAppConfig'];
  claimScope?: (configDir: string) => RuntimeScopeOwnership;
  runSupervisor?: (
    options: BackgroundSupervisorOptions,
    dependencies: BackgroundSupervisorDependencies,
  ) => Promise<void>;
}

function defaultLoadAppConfig(parsedArgv: ServeOptions): ApplicationConfig {
  const { configFilePath } = resolveServeConfigPaths(parsedArgv);
  return ConfigManager.getInstance(configFilePath).getAppConfig();
}

/**
 * Parent routine for `serve --background`. Sets `process.exitCode` and returns;
 * never starts a server in-process.
 */
export async function runServeBackground(parsedArgv: ServeOptions, deps: RunBackgroundDeps = {}): Promise<void> {
  const { runtimeScope: configDir } = resolveServeConfigPaths(parsedArgv);
  const loadAppConfig = deps.loadAppConfig ?? defaultLoadAppConfig;
  const appConfig = loadAppConfig(parsedArgv) as {
    transport?: string;
    logLevel?: string;
    logFile?: string;
    logging?: { level?: string; file?: string; maxSize?: number | string; maxFiles?: number };
    asyncLoading?: { enabled?: boolean };
  };

  // Mirror the async-loading precedence from serve.ts so the started report can
  // hint at the fast-detach path when the runtime is in the (default) sync mode.
  const asyncEnabled = parsedArgv['enable-async-loading'] ?? appConfig.asyncLoading?.enabled ?? false;

  // HTTP-only: reject stdio; sse normalizes to http.
  const effectiveTransport = parsedArgv.transport ?? appConfig.transport ?? 'http';
  if (effectiveTransport === 'stdio') {
    process.stderr.write(
      'Error: `serve --background --transport stdio` is not supported.\n' +
        'stdio uses the invoking process stdin/stdout and cannot be detached. Use HTTP transport.\n',
    );
    process.exitCode = 1;
    return;
  }

  // Fail closed when discovery already proves that this scope is occupied.
  const existing = await discoverScopedRuntime(configDir);
  if (existing.status === 'running' && existing.info) {
    process.stderr.write(
      `A runtime already owns this Runtime Scope (PID ${existing.info.pid}).\n` +
        `Refusing to start another runtime. Stop it first.\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (existing.status === 'unreachable' && existing.info) {
    process.stderr.write(
      `A runtime already occupies this Runtime Scope (PID ${existing.info.pid}) but is not ready yet.\n` +
        `Refusing to start a second runtime. Check 'serve --status' or stop it first.\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (existing.status === 'error') {
    process.stderr.write(
      `Cannot inspect Runtime Scope ${configDir}: ${existing.error ?? 'PID file could not be read'}.\n` +
        `Refusing to start a second runtime until the PID file problem is fixed.\n`,
    );
    process.exitCode = 1;
    return;
  }

  // Resolve the effective log file, defaulting to <configDir>/logs/server.log.
  // Only `resolved.file` is consumed here — the detached child re-resolves its
  // own level on the normal serve path, so no env tier is needed (and reading
  // process.env directly would bypass the yargs-based ONE_MCP_* loading).
  const { resolved } = resolveLoggingConfig({
    cli: { level: parsedArgv['log-level'], file: parsedArgv['log-file'] },
    structured: appConfig.logging,
    flat: { level: appConfig.logLevel, file: appConfig.logFile },
  });
  const logFile = resolved.file ?? defaultBackgroundLogFile(configDir);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  // Materialize parsed CLI/env/default precedence into the detached supervisor.
  const supervisorServeArgs = buildBackgroundSupervisorArgs(parsedArgv, { logFile });
  const { command, baseArgs } = resolveSelfInvocation();
  const supervisorArgs = [...baseArgs, 'serve', ...supervisorServeArgs];

  const spawnChild =
    deps.spawnChild ??
    ((cmd: string, args: string[], options: SpawnOptions) => spawn(cmd, args, options) as unknown as SpawnedSupervisor);

  const supervisor = spawnChild(command, supervisorArgs, { detached: true, stdio: 'ignore' });

  if (!supervisor.pid) {
    process.stderr.write('Error: failed to spawn background runtime process.\n');
    process.exitCode = 1;
    return;
  }
  // Allow the parent to exit independently of the child.
  supervisor.unref();

  // Acknowledge the spawn immediately so the wait is never silent.
  process.stderr.write(`Starting background runtime supervisor (PID ${supervisor.pid})…\n`);
  process.stderr.write(`Log file: ${logFile}\n`);

  let supervisorExited = false;
  supervisor.once('exit', () => {
    supervisorExited = true;
  });

  const renderer = createProgressRenderer(logFile);

  const waitForReady = deps.waitForReady ?? waitForBackgroundSupervisorReady;
  const result = await waitForReady(configDir, supervisor.pid, {
    isSupervisorAlive: () => !supervisorExited,
    onProgress: renderer.render,
  });

  renderer.clear();

  if (result.ready && result.info) {
    // One final probe so the report can show how many servers are already up.
    const summary = await probeLoadingSummary(result.info);
    process.stdout.write(`Background runtime started.\n${formatStartedReport(result.info, { summary, asyncEnabled })}`);
    process.exitCode = 0;
    return;
  }

  // Startup failure is non-zero. A terminal crash-loop supervisor deliberately
  // remains resident for status/stop/restart; other bootstrap failures are
  // terminated because they never established the persistent lifecycle owner.
  process.stderr.write(
    `Error: background runtime did not become ready (${result.reason ?? 'unknown error'}).\n` +
      `See the log for details: ${logFile}\n`,
  );
  const killChild = deps.killChild ?? defaultKillChild;
  if (!result.terminal && !supervisorExited && supervisor.pid) {
    killChild(supervisor.pid);
  }
  process.exitCode = 1;
}

/** Persistent child routine selected by the internal background-bootstrap flag. */
export async function runServeBackgroundSupervisor(
  parsedArgv: ServeOptions,
  deps: RunBackgroundSupervisorDeps = {},
): Promise<void> {
  const { runtimeScope: configDir } = resolveServeConfigPaths(parsedArgv);
  const ownership = (deps.claimScope ?? ((scope) => claimRuntimeScope(scope, { kind: 'background-supervisor' })))(
    configDir,
  );
  let launchConfigFile: string | undefined;
  let supervisorFailure: { error: unknown } | undefined;

  try {
    const loadAppConfig = deps.loadAppConfig ?? defaultLoadAppConfig;
    const appConfig = loadAppConfig(parsedArgv);
    const { resolved } = resolveLoggingConfig({
      cli: { level: parsedArgv['log-level'], file: parsedArgv['log-file'] },
      structured: appConfig.logging,
      flat: { level: appConfig.logLevel, file: appConfig.logFile },
    });
    const logFile = resolved.file ?? defaultBackgroundLogFile(configDir);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    launchConfigFile = writeBackgroundLaunchConfig(configDir, ownership.record.claimId, appConfig);
    const rawArgv = deps.rawArgv ?? normalizedArgv;
    const workerServeArgs = buildBackgroundWorkerArgs(stripServeToken(rawArgv), {
      logFile,
      claimId: ownership.record.claimId,
      launchConfigFile,
    });
    const { command, baseArgs } = resolveSelfInvocation();
    const workerArgs = [...baseArgs, 'serve', ...workerServeArgs];
    const runSupervisor = deps.runSupervisor ?? runBackgroundRuntimeSupervisor;
    const appendEvent = (event: BackgroundSupervisorEvent): void => {
      fs.appendFileSync(logFile, `${JSON.stringify(event)}\n`, 'utf8');
    };

    await runSupervisor(
      { configDir, workerCommand: command, workerArgs },
      {
        waitForReady: async (worker) => {
          if (!worker.pid) return false;
          const result = await waitForBackgroundReady(configDir, worker.pid, {
            isChildAlive: () => isProcessAlive(worker.pid!),
          });
          return result.ready;
        },
        appendEvent,
      },
    );
  } catch (error) {
    supervisorFailure = { error };
  }

  if (launchConfigFile && !cleanupBackgroundLaunchConfig(configDir, ownership.record.claimId)) {
    throw new Error('Background launch configuration changed before supervisor cleanup');
  }
  if (!cleanupBackgroundSupervisorState(configDir, ownership.record.pid)) {
    throw new Error('Background supervisor state changed before supervisor cleanup');
  }
  ownership.release();
  if (supervisorFailure) throw supervisorFailure.error;
}

function defaultKillChild(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    logger.warn(`Failed to terminate background supervisor (PID: ${pid}): ${error}`);
  }
}

function formatStartedReport(
  info: ServerPidInfo,
  opts: { summary?: LoadingSummarySnapshot | null; asyncEnabled?: boolean } = {},
): string {
  let report = `PID: ${info.pid}\n` + `URL: ${info.url}\n` + `Log file: ${info.logFile ?? '(console only)'}\n`;
  if (opts.summary) {
    report += `Servers: ${opts.summary.ready}/${opts.summary.total} ready\n`;
  }
  // In the default sync mode the wait is bounded by upstream connection time;
  // point users at the fast-detach path. Omitted when async is already on, or
  // when the caller does not supply the flag.
  if (opts.asyncEnabled === false) {
    report += `Tip: run with --enable-async-loading for near-instant background detach.\n`;
  }
  return report;
}

/** Truncate a single line so progress output stays on one terminal row. */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Best-effort read of the last non-empty line of a (possibly absent) log file. */
function tailLastLine(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Build a stderr progress renderer for the background wait. Throttles to ~1s and
 * uses an in-place line on a TTY, plain lines otherwise. Two phases:
 * - before the PID file appears (sync mode's blocking window): elapsed time plus
 *   the latest child log line;
 * - once the runtime is up: aggregate `/health/mcp` loading counts.
 */
function createProgressRenderer(logFile: string): {
  render: (progress: BackgroundProgress) => void;
  clear: () => void;
} {
  const isTty = Boolean(process.stderr.isTTY);
  let lastRenderMs = -1;
  let lastSummary: LoadingSummarySnapshot | null = null;
  let summaryProbeInFlight = false;
  let lineActive = false;

  const render = (progress: BackgroundProgress): void => {
    // Throttle to roughly one update per second; always render the first tick.
    if (progress.elapsedMs !== 0 && progress.elapsedMs - lastRenderMs < 900) {
      return;
    }
    lastRenderMs = progress.elapsedMs;
    const seconds = Math.floor(progress.elapsedMs / 1000);

    // Refresh the loading summary out of band so rendering stays synchronous.
    if (progress.info && !summaryProbeInFlight) {
      summaryProbeInFlight = true;
      void probeLoadingSummary(progress.info)
        .then((summary) => {
          lastSummary = summary;
        })
        .catch(() => {})
        .finally(() => {
          summaryProbeInFlight = false;
        });
    }

    let detail: string;
    if (progress.info && lastSummary) {
      const s = lastSummary;
      detail = `${s.ready}/${s.total} servers ready (${s.loading} loading, ${s.failed} failed)`;
    } else if (progress.info) {
      detail = 'runtime starting…';
    } else {
      const lastLogLine = tailLastLine(logFile);
      detail = lastLogLine ? truncate(lastLogLine, 100) : 'waiting for runtime to start…';
    }

    const line = `[${seconds}s] ${detail}`;
    if (isTty) {
      process.stderr.write(`\x1b[2K\r${line}`);
      lineActive = true;
    } else {
      process.stderr.write(`${line}\n`);
    }
  };

  const clear = (): void => {
    if (isTty && lineActive) {
      process.stderr.write('\x1b[2K\r');
      lineActive = false;
    }
  };

  return { render, clear };
}
