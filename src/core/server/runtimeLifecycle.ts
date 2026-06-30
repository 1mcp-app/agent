import {
  cleanupPidFileIfMatches,
  isProcessAlive,
  readPidFile,
  ServerPidInfo,
} from '@src/core/server/pidFileManager.js';
import logger from '@src/logger/logger.js';

/**
 * Lifecycle module for the (Background) Aggregated Runtime.
 *
 * This is the single place every path discovers a scoped runtime — today's
 * client surfaces (`proxy`, `inspect`, `run`) and the upcoming `serve --status`,
 * `serve --stop`, and `serve --background` idempotency check. Centralizing
 * discovery here guarantees the two-tier staleness rule is applied identically
 * everywhere and that `readPidFile` can stay a pure reader.
 */

/**
 * Discovered state of the runtime occupying a Runtime Scope.
 *
 * - `not-running`: no PID file, malformed PID file, or the recorded process is
 *   dead. The PID file is deleted in the dead-process case.
 * - `unreachable`: the recorded process is alive but the readiness probe failed.
 *   The PID file is RETAINED — the runtime may be mid-startup or wedged, and
 *   deleting it would strand a real process.
 * - `running`: the recorded process is alive and the readiness probe succeeded.
 */
export type RuntimeStatus = 'not-running' | 'unreachable' | 'running';

export interface ScopedRuntime {
  status: RuntimeStatus;
  /** The PID record, present for `unreachable` and `running`; null otherwise. */
  info: ServerPidInfo | null;
}

/**
 * Probes whether a runtime URL is usable. Returns true when usable.
 *
 * The default probe hits the `/health/ready` readiness gate, which confirms the
 * runtime accepts requests even while backend MCP servers continue loading.
 */
export type ReadinessProbe = (info: ServerPidInfo) => Promise<boolean>;

/** Derive the runtime base URL (strip a trailing `/mcp`) from a recorded URL. */
function baseUrlOf(url: string): string {
  return url.replace(/\/mcp\/?$/, '');
}

/**
 * Default readiness probe: GET `<baseUrl>/health/ready`.
 */
export async function probeReadiness(info: ServerPidInfo, timeoutMs = 5000): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrlOf(info.url)}/health/ready`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Discover the runtime occupying a Runtime Scope, applying the two-tier
 * staleness rule. Owns PID-file deletion so callers never delete directly.
 *
 * @param configDir Resolved configuration directory for the Runtime Scope
 * @param readinessProbe Optional reachability check (defaults to `/health/ready`)
 */
export async function discoverScopedRuntime(
  configDir: string,
  readinessProbe: ReadinessProbe = probeReadiness,
): Promise<ScopedRuntime> {
  const info = readPidFile(configDir);

  if (!info) {
    return { status: 'not-running', info: null };
  }

  // Tier 1: dead process → delete the stale PID file, report not-running.
  // Delete only if the file still records this dead PID: a newer runtime may
  // have replaced it between the read above and here, and we must not strand it.
  if (!isProcessAlive(info.pid)) {
    logger.warn(`PID file points to dead process (PID: ${info.pid}); removing stale PID file`);
    cleanupPidFileIfMatches(configDir, info.pid);
    return { status: 'not-running', info: null };
  }

  // Tier 2: alive but unreachable → retain the PID file, report not-usable.
  const reachable = await readinessProbe(info);
  if (!reachable) {
    return { status: 'unreachable', info };
  }

  return { status: 'running', info };
}
