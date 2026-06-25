import { getConfigDir } from '@src/constants.js';
import { ServerPidInfo } from '@src/core/server/pidFileManager.js';
import { discoverScopedRuntime, RuntimeStatus } from '@src/core/server/runtimeLifecycle.js';

/**
 * `serve --status`: report the state of the Background Aggregated Runtime in the
 * selected Runtime Scope. Discovery goes through the lifecycle module, so the
 * same two-tier staleness rule applies — a dead PID file is cleaned up and the
 * scope is reported not-running.
 */

export interface RuntimeStatusReport {
  status: RuntimeStatus;
  /** The Runtime Scope (resolved configuration directory). */
  configDir: string;
  /** PID record for `running`/`unreachable`; null for `not-running`. */
  info: ServerPidInfo | null;
}

/**
 * Process exit codes per runtime state, so scripts can branch on `serve --status`:
 * - running (alive and ready) → 0
 * - not-running (empty scope or stale dead PID) → 3
 * - unreachable (alive but `/health/ready` failing) → 4
 */
export const STATUS_EXIT_CODES: Record<RuntimeStatus, number> = {
  running: 0,
  'not-running': 3,
  unreachable: 4,
};

/**
 * Discover the scoped runtime and assemble a status report. The default
 * readiness probe (`/health/ready`) distinguishes alive-but-not-ready from
 * alive-and-ready.
 */
export async function getRuntimeStatusReport(configDirOption?: string): Promise<RuntimeStatusReport> {
  const configDir = getConfigDir(configDirOption);
  const { status, info } = await discoverScopedRuntime(configDir);
  return { status, configDir, info };
}

/**
 * Render a status report as human-readable lines.
 */
export function formatRuntimeStatusReport(report: RuntimeStatusReport): string {
  const { status, configDir, info } = report;
  const lines: string[] = [`Runtime Scope: ${configDir}`];

  if (status === 'not-running' || !info) {
    lines.push('Status: not running');
    return `${lines.join('\n')}\n`;
  }

  const ready = status === 'running';
  lines.push(`Status: ${ready ? 'running (ready)' : 'starting (not ready)'}`);
  lines.push(`PID: ${info.pid}`);
  lines.push(`URL: ${info.url}`);
  lines.push(`Started: ${info.startedAt}`);
  lines.push(`Log file: ${info.logFile ?? '(console only)'}`);
  lines.push('Process: alive');
  lines.push(`Readiness (/health/ready): ${ready ? 'ready' : 'not ready'}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Entry point for `serve --status`: discover, print, and set the exit code.
 */
export async function runServeStatus(configDirOption?: string): Promise<void> {
  const report = await getRuntimeStatusReport(configDirOption);
  process.stdout.write(formatRuntimeStatusReport(report));
  process.exitCode = STATUS_EXIT_CODES[report.status];
}
