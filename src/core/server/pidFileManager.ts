import fs from 'fs';
import path from 'path';

import logger from '@src/logger/logger.js';

import { z } from 'zod';

/**
 * Server information stored in PID file
 */
export interface ServerPidInfo {
  pid: number;
  url: string;
  port: number;
  host: string;
  transport: 'http';
  startedAt: string;
  configDir: string;
  /**
   * Effective log file the runtime is writing to, captured at startup.
   * Optional: absent when no log file is configured, and absent in PID files
   * written by older versions. `serve --status` reports this real path rather
   * than recomputing a default that would be wrong under `--log-file`.
   */
  logFile?: string;
}

/**
 * Schema validating a PID file at the (untrusted, cross-version) file boundary.
 * `pid` must be a positive integer — this is load-bearing: a negative PID would
 * make `process.kill(pid, ...)` signal an entire process group (potentially the
 * operator's own shell), so a corrupt/hand-edited file must never reach the
 * signal paths in `serveStop`.
 */
const serverPidInfoSchema = z.object({
  pid: z.number().int().positive(),
  url: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  host: z.string().min(1),
  transport: z.literal('http'),
  startedAt: z.string().min(1),
  configDir: z.string().min(1),
  logFile: z.string().min(1).optional(),
}) satisfies z.ZodType<ServerPidInfo>;

const PID_FILE_NAME = 'server.pid';

/**
 * Get PID file path for a given config directory
 */
export function getPidFilePath(configDir: string): string {
  return path.join(configDir, PID_FILE_NAME);
}

/**
 * Check if a process is alive
 * @param pid Process ID to check
 * @returns true if process is alive, false otherwise
 */
export function isProcessAlive(pid: number): boolean {
  try {
    // Send signal 0 (no-op) to check if process exists
    // This doesn't actually send a signal, just checks permissions
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // ESRCH = process doesn't exist
    // EPERM = process exists but no permission (still alive)
    return err instanceof Error && 'code' in err && (err as { code: string }).code === 'EPERM';
  }
}

/**
 * Write PID file with server information
 * @param configDir Configuration directory
 * @param serverInfo Server information to write
 */
export function writePidFile(configDir: string, serverInfo: ServerPidInfo): void {
  const pidFilePath = getPidFilePath(configDir);

  try {
    // Ensure config directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Write PID file atomically: write to a sibling temp file then rename into
    // place (rename is atomic on POSIX). Concurrent readers — racing `serve
    // --status` / discovery — never observe a half-written, unparseable file.
    const content = JSON.stringify(serverInfo, null, 2);
    const tempFilePath = `${pidFilePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempFilePath, content, { encoding: 'utf-8' });
    fs.renameSync(tempFilePath, pidFilePath);

    logger.info(`PID file written: ${pidFilePath}`);
  } catch (error) {
    logger.error(`Failed to write PID file: ${error}`);
    throw error;
  }
}

/**
 * Read and parse the PID file. This is a PURE reader: it validates the file
 * exists and has the required fields, but does NOT check process liveness and
 * never deletes the file. Liveness handling and the two-tier staleness rule are
 * owned by the lifecycle module (`runtimeLifecycle.ts`) so every discovery path
 * applies deletion consistently.
 *
 * @param configDir Configuration directory
 * @returns Parsed server info, or null if the file is missing or malformed
 */
export function readPidFile(configDir: string): ServerPidInfo | null {
  const pidFilePath = getPidFilePath(configDir);

  let content: string;
  try {
    content = fs.readFileSync(pidFilePath, 'utf-8');
  } catch (error) {
    // ENOENT is the normal "no runtime in this scope" case — silent. Anything
    // else (EACCES, EISDIR, EIO) means the file is present but unreadable; warn
    // loudly so a permissions/corruption problem is not mistaken for an empty
    // scope (which would let `--background` double-spawn or `--stop` no-op).
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'ENOENT') {
      return null;
    }
    logger.warn(`PID file present but unreadable (${pidFilePath}): ${error}`);
    return null;
  }

  // Validate the boundary with a schema rather than a hand-rolled truthiness
  // check: enforces field types and, critically, `pid > 0` so a malformed file
  // can never drive the signal paths to a negative (process-group) PID.
  const parsed = serverPidInfoSchema.safeParse(safeJsonParse(content));
  if (!parsed.success) {
    logger.warn(`Invalid PID file format (${pidFilePath}): ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    return null;
  }

  return parsed.data;
}

/** Parse JSON without throwing; returns `undefined` on malformed input. */
function safeJsonParse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/**
 * Cleanup (delete) PID file.
 * @param configDir Configuration directory
 * @returns true if the file was removed (or already absent), false if the
 *   delete failed (e.g. EACCES/EPERM) and a stale file was left behind. Callers
 *   should surface a warning on `false` so the operator can remove it manually.
 */
export function cleanupPidFile(configDir: string): boolean {
  const pidFilePath = getPidFilePath(configDir);

  try {
    if (fs.existsSync(pidFilePath)) {
      fs.unlinkSync(pidFilePath);
      logger.info(`PID file cleaned up: ${pidFilePath}`);
    }
    return true;
  } catch (error) {
    logger.error(`Failed to cleanup PID file: ${error}`);
    return false;
  }
}

/**
 * Delete the PID file only if it still records `expectedPid`. Guards against a
 * time-of-check/time-of-use race: between reading a stale/dead PID and deleting
 * the file, a new runtime may have written a fresh PID file in the same scope.
 * Deleting unconditionally would strand that live runtime (undiscoverable to
 * later `--status`/`--stop`). Re-reading and matching the PID prevents that.
 *
 * @returns true if the file was removed or is already gone/replaced; false if a
 *   matching file existed but could not be deleted.
 */
export function cleanupPidFileIfMatches(configDir: string, expectedPid: number): boolean {
  const current = readPidFile(configDir);
  if (!current || current.pid !== expectedPid) {
    // Already gone, or replaced by a newer runtime — leave it untouched.
    return true;
  }
  return cleanupPidFile(configDir);
}

/**
 * Cleanup function to remove PID file
 * @param configDir Configuration directory
 */
export function cleanupPidFileOnExit(configDir: string): void {
  cleanupPidFile(configDir);
}

/**
 * Register cleanup handler to remove PID file on process exit (only the 'exit' event)
 * This function only registers for the 'exit' event, not signal handlers.
 * Signal handlers should be managed by the main application to ensure proper cleanup order.
 * @param configDir Configuration directory
 */
export function registerPidFileCleanup(configDir: string): void {
  const cleanup = () => {
    cleanupPidFile(configDir);
  };

  // Only register for the 'exit' event
  // Signal handlers (SIGINT, SIGTERM, SIGHUP) should be managed by the main application
  process.on('exit', cleanup);
}

/**
 * Register signal handlers with cleanup function (for standalone usage)
 * Only use this if the application doesn't have its own signal handlers
 * @param configDir Configuration directory
 */
export function registerPidFileSignalHandlers(configDir: string): void {
  const cleanup = () => {
    cleanupPidFile(configDir);
  };

  // Register cleanup for signal handlers
  // NOTE: This should only be used if the main application doesn't have its own signal handlers
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGHUP', () => {
    cleanup();
    process.exit(0);
  });
}
