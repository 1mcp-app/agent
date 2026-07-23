import { getConfigDir } from '@src/constants.js';
import {
  type BackgroundSupervisorState,
  cleanupBackgroundSupervisorState,
  readBackgroundSupervisorState,
} from '@src/core/server/backgroundRuntimeSupervisor.js';
import { isProcessAlive, ServerPidInfo } from '@src/core/server/pidFileManager.js';
import { discoverScopedRuntime, RuntimeStatus } from '@src/core/server/runtimeLifecycle.js';
import {
  readRuntimeScopeOwnership,
  reclaimStaleRuntimeScopeOwnership,
  type RuntimeScopeOwnershipRecord,
} from '@src/core/server/runtimeScopeOwnership.js';

/**
 * `serve --status`: report the state of the Background Aggregated Runtime in the
 * selected Runtime Scope. Discovery goes through the lifecycle module, so the
 * same two-tier staleness rule applies — a dead PID file is cleaned up and the
 * scope is reported not-running.
 */

export type ServeRuntimeStatus = RuntimeStatus | 'restarting' | 'crash-loop' | 'orphaned';

export interface RuntimeStatusReport {
  status: ServeRuntimeStatus;
  /** The Runtime Scope (resolved configuration directory). */
  configDir: string;
  /** PID record for `running`/`unreachable`; null for `not-running`/`error`. */
  info: ServerPidInfo | null;
  /** Authoritative supervised-background lifecycle snapshot, when present. */
  supervisorState?: BackgroundSupervisorState;
  /** Canonical scope owner when no runtime PID/state is available. */
  ownership?: RuntimeScopeOwnershipRecord;
  /** Human-readable discovery failure for `error` reports. */
  error?: string;
}

/**
 * Process exit codes per runtime state, so scripts can branch on `serve --status`:
 * - running (alive and ready) → 0
 * - not-running (empty scope or stale dead PID) → 3
 * - unreachable (alive but `/health/ready` failing) → 4
 */
export const STATUS_EXIT_CODES: Record<ServeRuntimeStatus, number> = {
  running: 0,
  'not-running': 3,
  unreachable: 4,
  error: 2,
  restarting: 5,
  'crash-loop': 6,
  orphaned: 7,
};

export interface RuntimeStatusDeps {
  readSupervisorState?: typeof readBackgroundSupervisorState;
  cleanupSupervisorState?: typeof cleanupBackgroundSupervisorState;
  isAlive?: (pid: number) => boolean;
  discoverRuntime?: typeof discoverScopedRuntime;
  readOwnership?: typeof readRuntimeScopeOwnership;
  reclaimOwnership?: typeof reclaimStaleRuntimeScopeOwnership;
}

/**
 * Discover the scoped runtime and assemble a status report. The default
 * readiness probe (`/health/ready`) distinguishes alive-but-not-ready from
 * alive-and-ready.
 */
export async function getRuntimeStatusReport(
  configDirOption?: string,
  deps: RuntimeStatusDeps = {},
): Promise<RuntimeStatusReport> {
  const configDir = getConfigDir(configDirOption);
  const readSupervisorState = deps.readSupervisorState ?? readBackgroundSupervisorState;
  const cleanupSupervisorState = deps.cleanupSupervisorState ?? cleanupBackgroundSupervisorState;
  const isAlive = deps.isAlive ?? isProcessAlive;
  const discoverRuntime = deps.discoverRuntime ?? discoverScopedRuntime;
  const readOwnership = deps.readOwnership ?? readRuntimeScopeOwnership;
  const reclaimOwnership = deps.reclaimOwnership ?? reclaimStaleRuntimeScopeOwnership;

  let supervisorState: BackgroundSupervisorState | null;
  try {
    supervisorState = readSupervisorState(configDir);
  } catch (error) {
    return {
      status: 'error',
      configDir,
      info: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (supervisorState) {
    const supervisorAlive = isAlive(supervisorState.supervisorPid);
    const runtimeAlive = supervisorState.runtimePid !== null && isAlive(supervisorState.runtimePid);

    if (!supervisorAlive && runtimeAlive) {
      return { status: 'orphaned', configDir, info: null, supervisorState };
    }

    if (supervisorAlive && supervisorState.status === 'restarting') {
      return { status: 'restarting', configDir, info: null, supervisorState };
    }

    if (supervisorAlive && supervisorState.status === 'crash-loop') {
      return { status: 'crash-loop', configDir, info: null, supervisorState };
    }

    if (!supervisorAlive && !runtimeAlive) {
      const discovered = await discoverRuntimeWithOwnership(configDir, {
        discoverRuntime,
        readOwnership,
        reclaimOwnership,
        isAlive,
      });
      if ((discovered.status === 'running' || discovered.status === 'unreachable') && discovered.info) {
        let owner: RuntimeScopeOwnershipRecord | null;
        try {
          owner = readOwnership(configDir);
        } catch (error) {
          return statusError(configDir, error);
        }
        if (owner?.kind === 'background-supervisor' && owner.pid === supervisorState.supervisorPid) {
          return {
            ...discovered,
            status: 'orphaned',
            supervisorState: { ...supervisorState, runtimePid: discovered.info.pid },
          };
        }
      }
      if (discovered.status === 'error' || discovered.ownership) {
        return discovered;
      }
      try {
        if (!cleanupSupervisorState(configDir, supervisorState.supervisorPid)) {
          return {
            status: 'error',
            configDir,
            info: null,
            error: 'Background supervisor state changed while removing stale metadata',
          };
        }
      } catch (error) {
        return {
          status: 'error',
          configDir,
          info: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      return discovered;
    }

    const discovered = await discoverRuntime(configDir);
    if (discovered.status === 'not-running') {
      return { status: 'unreachable', configDir, info: null, supervisorState };
    }
    return { ...discovered, configDir, supervisorState };
  }

  return discoverRuntimeWithOwnership(configDir, { discoverRuntime, readOwnership, reclaimOwnership, isAlive });
}

interface OwnershipDiscoveryDeps {
  discoverRuntime: typeof discoverScopedRuntime;
  readOwnership: typeof readRuntimeScopeOwnership;
  reclaimOwnership: typeof reclaimStaleRuntimeScopeOwnership;
  isAlive: (pid: number) => boolean;
}

async function discoverRuntimeWithOwnership(
  configDir: string,
  deps: OwnershipDiscoveryDeps,
): Promise<RuntimeStatusReport> {
  const discovered = await deps.discoverRuntime(configDir);
  if (discovered.status !== 'not-running') {
    return { ...discovered, configDir };
  }

  let ownership: RuntimeScopeOwnershipRecord | null;
  try {
    ownership = deps.readOwnership(configDir);
  } catch (error) {
    return statusError(configDir, error);
  }
  if (!ownership) {
    return { ...discovered, configDir };
  }
  if (deps.isAlive(ownership.pid)) {
    return { status: 'unreachable', configDir, info: null, ownership };
  }
  try {
    if (deps.reclaimOwnership(configDir, ownership, deps.isAlive)) {
      return { ...discovered, configDir };
    }
    const replacement = deps.readOwnership(configDir);
    if (!replacement) {
      return { ...discovered, configDir };
    }
    if (deps.isAlive(replacement.pid)) {
      return { status: 'unreachable', configDir, info: null, ownership: replacement };
    }
    return statusError(configDir, new Error('Runtime Scope ownership changed while removing stale metadata'));
  } catch (error) {
    return statusError(configDir, error);
  }
}

function statusError(configDir: string, error: unknown): RuntimeStatusReport {
  return {
    status: 'error',
    configDir,
    info: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Render a status report as human-readable lines.
 */
export function formatRuntimeStatusReport(report: RuntimeStatusReport): string {
  const { status, configDir, info } = report;
  const lines: string[] = [`Runtime Scope: ${configDir}`];

  if (report.ownership) {
    lines.push('Status: occupied (unreachable)');
    lines.push(`Owner: ${formatOwnershipKind(report.ownership.kind)}`);
    lines.push(`Owner PID: ${report.ownership.pid} (alive)`);
    lines.push('Runtime metadata: unavailable');
    return `${lines.join('\n')}\n`;
  }

  if (report.supervisorState) {
    const state = report.supervisorState;
    const supervisorSuffix = status === 'orphaned' ? ' (not alive)' : '';
    const runtimeSuffix = status === 'orphaned' && state.runtimePid !== null ? ' (alive)' : '';
    lines.push(`Status: ${status}`);
    lines.push(`Supervisor PID: ${state.supervisorPid}${supervisorSuffix}`);
    lines.push(`Runtime PID: ${state.runtimePid ?? 'none'}${runtimeSuffix}`);
    lines.push(`Restart attempt: ${state.restartAttempt}`);
    lines.push(`Last exit: ${formatLastExit(state.lastExit)}`);
    lines.push(`Next retry: ${state.nextRetryAt ?? 'none'}`);
    if (status === 'error') {
      lines.push(`Error: ${report.error ?? 'PID file could not be read'}`);
    }
    if (info) {
      lines.push(`URL: ${info.url}`);
      lines.push(`Started: ${info.startedAt}`);
      lines.push(`Log file: ${info.logFile ?? '(console only)'}`);
      lines.push('Process: alive');
      lines.push(`Readiness (/health/ready): ${status === 'running' ? 'ready' : 'not ready'}`);
    }
    return `${lines.join('\n')}\n`;
  }

  if (status === 'not-running' || !info) {
    if (status === 'error') {
      lines.push('Status: error');
      lines.push(`Error: ${report.error ?? 'PID file could not be read'}`);
      return `${lines.join('\n')}\n`;
    }
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

function formatOwnershipKind(kind: RuntimeScopeOwnershipRecord['kind']): string {
  switch (kind) {
    case 'foreground-http':
      return 'foreground HTTP';
    case 'foreground-stdio':
      return 'foreground stdio';
    case 'background-supervisor':
      return 'background supervisor';
  }
}

function formatLastExit(lastExit: BackgroundSupervisorState['lastExit']): string {
  if (!lastExit) {
    return 'none';
  }
  const reason = lastExit.code !== null ? `code ${lastExit.code}` : `signal ${lastExit.signal ?? 'unknown'}`;
  const errorDetail = lastExit.error ? `; process error: ${lastExit.error}` : '';
  return `${reason}${errorDetail} at ${lastExit.at}`;
}

/**
 * Entry point for `serve --status`: discover, print, and set the exit code.
 */
export async function runServeStatus(configDirOption?: string): Promise<void> {
  const report = await getRuntimeStatusReport(configDirOption);
  process.stdout.write(formatRuntimeStatusReport(report));
  process.exitCode = STATUS_EXIT_CODES[report.status];
}
