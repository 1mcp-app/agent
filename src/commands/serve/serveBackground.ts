import { spawn, type SpawnOptions } from 'child_process';
import fs from 'fs';
import path from 'path';

import ConfigContext from '@src/config/configContext.js';
import { ConfigManager } from '@src/config/configManager.js';
import { getConfigDir } from '@src/constants.js';
import { readPidFile, ServerPidInfo } from '@src/core/server/pidFileManager.js';
import { discoverScopedRuntime, probeReadiness, ReadinessProbe } from '@src/core/server/runtimeLifecycle.js';
import logger from '@src/logger/logger.js';
import { resolveLoggingConfig } from '@src/logger/loggingConfig.js';
import { normalizedArgv } from '@src/utils/cli/normalizedArgv.js';

import type { ServeOptions } from './serve.js';

/**
 * `serve --background`: start the HTTP Aggregated Runtime as a detached child
 * for the selected Runtime Scope, then return once it is ready.
 *
 * The parent never serves; it spawns a detached copy of this executable running
 * the normal serve path (marked with an internal guard flag so it does not
 * recursively background itself), waits for the child's PID file and
 * `/health/ready`, and reports the result.
 */

/** Internal guard flag name; mirrors the hidden yargs option in `index.ts`. */
export const BACKGROUND_GUARD_FLAG = 'background-bootstrap';

/** Default log file for a background runtime when none is configured. */
export function defaultBackgroundLogFile(configDir: string): string {
  return path.join(configDir, 'logs', 'server.log');
}

/**
 * Build the child's serve arguments: strip flags the parent overrides
 * (`--background`, `--transport`, `--log-file`, and the guard) and re-append the
 * HTTP transport, the resolved log file, and the guard flag. Background is
 * HTTP-only, so the child is always forced onto `--transport http`.
 */
export function buildBackgroundChildArgs(serveArgs: string[], opts: { logFile: string }): string[] {
  const stripWithValue = new Set(['--transport', '-t', '--log-file']);
  const out: string[] = [];

  for (let i = 0; i < serveArgs.length; i++) {
    const token = serveArgs[i];

    if (token === '--background' || token === `--${BACKGROUND_GUARD_FLAG}`) {
      continue;
    }
    if (/^--(transport|log-file)=/.test(token) || /^-t=/.test(token)) {
      continue;
    }
    if (stripWithValue.has(token)) {
      i++; // also skip the following value
      continue;
    }
    out.push(token);
  }

  out.push('--transport', 'http', '--log-file', opts.logFile, `--${BACKGROUND_GUARD_FLAG}`);
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

export interface WaitForReadyOptions {
  timeoutMs?: number;
  intervalMs?: number;
  readinessProbe?: ReadinessProbe;
  isChildAlive?: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface WaitForReadyResult {
  ready: boolean;
  info?: ServerPidInfo;
  reason?: string;
}

/**
 * Wait until the child's PID file identifies the spawned child AND
 * `/health/ready` succeeds, or until timeout / child death.
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
    if (info && info.pid === childPid && (await probe(info))) {
      return { ready: true, info };
    }

    await sleep(intervalMs);
  }

  return { ready: false, reason: `timed out after ${timeoutMs}ms waiting for readiness` };
}

/** Minimal shape of the spawned child the orchestration depends on. */
export interface SpawnedChild {
  pid?: number;
  unref(): void;
  once(event: 'exit', listener: () => void): void;
  killed?: boolean;
}

export interface RunBackgroundDeps {
  /** Raw CLI argv (after node/cli), defaults to the process's normalized argv. */
  rawArgv?: string[];
  spawnChild?: (command: string, args: string[], options: SpawnOptions) => SpawnedChild;
  waitForReady?: typeof waitForBackgroundReady;
  killChild?: (pid: number) => void;
  loadAppConfig?: (parsedArgv: ServeOptions) => {
    transport?: string;
    logLevel?: string;
    logFile?: string;
    logging?: unknown;
  };
}

function defaultLoadAppConfig(parsedArgv: ServeOptions) {
  const configContext = ConfigContext.getInstance();
  if (parsedArgv.config) {
    configContext.setConfigPath(parsedArgv.config);
  } else if (parsedArgv['config-dir']) {
    configContext.setConfigDir(parsedArgv['config-dir']);
  } else {
    configContext.reset();
  }
  const configFilePath = configContext.getResolvedConfigPath();
  return ConfigManager.getInstance(configFilePath).getAppConfig();
}

/**
 * Parent routine for `serve --background`. Sets `process.exitCode` and returns;
 * never starts a server in-process.
 */
export async function runServeBackground(parsedArgv: ServeOptions, deps: RunBackgroundDeps = {}): Promise<void> {
  const configDir = getConfigDir(parsedArgv['config-dir']);
  const loadAppConfig = deps.loadAppConfig ?? defaultLoadAppConfig;
  const appConfig = loadAppConfig(parsedArgv) as {
    transport?: string;
    logLevel?: string;
    logFile?: string;
    logging?: { level?: string; file?: string; maxSize?: number | string; maxFiles?: number };
  };

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

  // Idempotency: do not start a second runtime if the scope is already occupied.
  const existing = await discoverScopedRuntime(configDir);
  if (existing.status === 'running' && existing.info) {
    process.stdout.write(
      `A runtime is already running in this Runtime Scope; not starting another.\n` +
        formatStartedReport(existing.info),
    );
    process.exitCode = 0;
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

  // Resolve the effective log file, defaulting to <configDir>/logs/server.log.
  const { resolved } = resolveLoggingConfig({
    cli: { level: parsedArgv['log-level'], file: parsedArgv['log-file'] },
    structured: appConfig.logging,
    flat: { level: appConfig.logLevel, file: appConfig.logFile },
    env: { level: process.env.LOG_LEVEL },
  });
  const logFile = resolved.file ?? defaultBackgroundLogFile(configDir);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  // Build the detached child invocation.
  const rawArgv = deps.rawArgv ?? normalizedArgv;
  const childServeArgs = buildBackgroundChildArgs(stripServeToken(rawArgv), { logFile });
  const { command, baseArgs } = resolveSelfInvocation();
  const spawnArgs = [...baseArgs, 'serve', ...childServeArgs];

  const spawnChild =
    deps.spawnChild ??
    ((cmd: string, args: string[], options: SpawnOptions) => spawn(cmd, args, options) as unknown as SpawnedChild);

  const child = spawnChild(command, spawnArgs, { detached: true, stdio: 'ignore' });

  if (!child.pid) {
    process.stderr.write('Error: failed to spawn background runtime process.\n');
    process.exitCode = 1;
    return;
  }
  // Allow the parent to exit independently of the child.
  child.unref();

  let childExited = false;
  child.once('exit', () => {
    childExited = true;
  });

  const waitForReady = deps.waitForReady ?? waitForBackgroundReady;
  const result = await waitForReady(configDir, child.pid, {
    isChildAlive: () => !childExited,
  });

  if (result.ready && result.info) {
    process.stdout.write(`Background runtime started.\n${formatStartedReport(result.info)}`);
    process.exitCode = 0;
    return;
  }

  // Failure: report log path, terminate the child, exit non-zero.
  process.stderr.write(
    `Error: background runtime did not become ready (${result.reason ?? 'unknown error'}).\n` +
      `See the log for details: ${logFile}\n`,
  );
  const killChild = deps.killChild ?? defaultKillChild;
  if (!childExited && child.pid) {
    killChild(child.pid);
  }
  process.exitCode = 1;
}

function defaultKillChild(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    logger.warn(`Failed to terminate background child (PID: ${pid}): ${error}`);
  }
}

function formatStartedReport(info: ServerPidInfo): string {
  return `PID: ${info.pid}\n` + `URL: ${info.url}\n` + `Log file: ${info.logFile ?? '(console only)'}\n`;
}
