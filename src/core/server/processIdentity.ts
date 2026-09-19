import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

import { z } from 'zod';

export const processIdentitySchema = z.discriminatedUnion('platform', [
  z.object({
    platform: z.literal('linux'),
    bootId: z.string().min(1),
    pidNamespace: z.string().min(1),
    startTime: z.string().regex(/^\d+$/),
  }),
  z.object({
    platform: z.literal('darwin'),
    hostname: z.string().min(1),
    bootId: z.string().min(1).optional(),
    startTime: z.string().min(1),
  }),
  z.object({ platform: z.literal('win32'), hostname: z.string().min(1), startTime: z.string().regex(/^\d+$/) }),
]);
export type ProcessIdentity = z.infer<typeof processIdentitySchema>;
export type ProcessIdentityStatus = 'alive' | 'dead' | 'unknown';

/** Capture kernel process birth evidence; unavailable evidence is never a PID-only match. */
export function readProcessIdentity(pid: number): ProcessIdentity | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      // comm is parenthesized and may itself contain spaces or closing parentheses.
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      if (fields[0] === 'Z' || fields[0] === 'X') return undefined;
      return processIdentitySchema.parse({
        platform: 'linux',
        bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
        pidNamespace: fs.readlinkSync(`/proc/${pid}/ns/pid`),
        startTime: fields[19],
      });
    }
    if (process.platform === 'darwin') {
      // macOS ps exposes birth time at second precision; see the lifecycle platform contract.
      const startTime = childProcess
        .execFileSync('/usr/bin/env', ['LC_ALL=C', 'TZ=UTC', '/bin/ps', '-p', String(pid), '-o', 'lstart='], {
          encoding: 'utf8',
          timeout: 3000,
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        .trim();
      const bootId = childProcess
        .execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], {
          encoding: 'utf8',
          timeout: 3000,
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        .trim();
      return processIdentitySchema.parse({ platform: 'darwin', hostname: os.hostname(), bootId, startTime });
    }
    if (process.platform === 'win32') {
      const startTime = childProcess
        .execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
          ],
          {
            encoding: 'utf8',
            timeout: 3000,
            stdio: ['ignore', 'pipe', 'ignore'],
          },
        )
        .trim();
      return processIdentitySchema.parse({ platform: 'win32', hostname: os.hostname(), startTime });
    }
  } catch {
    // Permission errors, disappearing processes, malformed procfs, and missing platform tools are uncertain.
  }
  return undefined;
}

interface IdentityDependencies {
  readIdentity?: typeof readProcessIdentity;
  processAlive?: (pid: number) => boolean;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

function contextMismatch(recorded: ProcessIdentity, observed: ProcessIdentity): string | undefined {
  if (recorded.platform !== observed.platform) return 'the recorded process belongs to another operating system';
  if (recorded.platform === 'linux' && observed.platform === 'linux') {
    if (recorded.bootId !== observed.bootId) return 'the recorded process belongs to another boot session';
    if (recorded.pidNamespace !== observed.pidNamespace) return 'the recorded process belongs to another PID namespace';
    return undefined;
  }
  if (recorded.platform === 'darwin' && observed.platform === 'darwin' && recorded.bootId) {
    if (!observed.bootId) return 'the current macOS boot-session ID could not be read';
    if (recorded.bootId !== observed.bootId) return 'the recorded process belongs to another boot session';
    return undefined;
  }
  // Compatibility only: retire hostname-based macOS records at the next major release.
  if ('hostname' in recorded && 'hostname' in observed && recorded.hostname !== observed.hostname) {
    return 'the hostname differs from the hostname-based process record';
  }
  return undefined;
}

type IdentityInspection = { status: 'alive' | 'dead' } | { status: 'unknown'; reason: string };

/** All lifecycle paths use the same evidence and fail-closed decisions. */
function inspectIdentity(
  pid: number,
  identity: ProcessIdentity | undefined,
  dependencies: IdentityDependencies,
): IdentityInspection {
  if (!identity) return { status: 'unknown', reason: 'the record has no process birth evidence (legacy format)' };
  const readIdentity = dependencies.readIdentity ?? readProcessIdentity;
  const context = readIdentity(process.pid);
  if (!context)
    return {
      status: 'unknown',
      reason: 'OS process evidence is unavailable to this CLI (permissions or platform tools)',
    };
  const mismatch = contextMismatch(identity, context);
  if (mismatch) return { status: 'unknown', reason: mismatch };
  const observed = readIdentity(pid);
  if (observed) {
    const mismatch = contextMismatch(identity, observed);
    if (mismatch) return { status: 'unknown', reason: mismatch };
    return { status: observed.startTime === identity.startTime ? 'alive' : 'dead' };
  }
  if (!(dependencies.processAlive ?? processExists)(pid)) return { status: 'dead' };
  return { status: 'unknown', reason: 'the process may still exist, but its birth evidence could not be read' };
}

/** Numeric PIDs are meaningful only within the recorded execution context. */
export function inspectProcessIdentity(
  pid: number,
  identity?: ProcessIdentity,
  dependencies: IdentityDependencies = {},
): ProcessIdentityStatus {
  return inspectIdentity(pid, identity, dependencies).status;
}

/** Diagnostic re-read only; this never authorizes signalling or metadata cleanup. */
export function processIdentityRecoveryMessage(
  pid: number,
  identity?: ProcessIdentity,
  dependencies: IdentityDependencies = {},
): string {
  const inspection = inspectIdentity(pid, identity, dependencies);
  const reason =
    inspection.status === 'unknown'
      ? inspection.reason
      : 'process evidence changed during verification; retry the command';
  return (
    `Cannot verify process identity for PID ${pid}: ${reason}. Lifecycle metadata was retained. ` +
    'Run the command as the runtime user on the same host/container with OS process-inspection permissions. ' +
    'On Linux, legacy supervised pairs can use explicit serve --stop or serve --restart with the same --config-dir. ' +
    'For other legacy records, stop the old runtime through its original CLI or service manager, then start with this CLI. ' +
    'Do not delete lifecycle metadata while any process may still use this scope.'
  );
}
