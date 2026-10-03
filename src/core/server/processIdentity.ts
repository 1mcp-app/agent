import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

import logger from '@src/logger/logger.js';

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

interface IdentityAcquisitionFailure {
  platform: typeof process.platform;
  pid: number;
  elapsedMs: number;
  code: string;
}

interface IdentityAcquisition {
  identity?: ProcessIdentity;
  failure?: IdentityAcquisitionFailure;
}

function acquisitionFailureCode(error: unknown): string {
  if (error instanceof z.ZodError) return 'MALFORMED_PROCESS_EVIDENCE';
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'PROCESS_EVIDENCE_UNAVAILABLE';
  const knownCodes = ['ETIMEDOUT', 'ENOENT', 'EACCES', 'EPERM', 'ESRCH', 'EIO', 'ENOTDIR'];
  return typeof error.code === 'string' && knownCodes.includes(error.code)
    ? error.code
    : 'PROCESS_EVIDENCE_UNAVAILABLE';
}

function acquisitionFailureReason(failure?: IdentityAcquisitionFailure): string {
  if (!failure) return '';
  const details = `platform=${failure.platform}, lookup PID=${failure.pid}, elapsedMs=${failure.elapsedMs}, code=${failure.code}`;
  if (failure.code === 'ETIMEDOUT') return ` (${details}; retry after reducing system load)`;
  if (failure.code === 'ENOENT' && failure.platform === 'win32')
    return ` (${details}; check the platform process-inspection tool is available)`;
  if (failure.code === 'EACCES' || failure.code === 'EPERM')
    return ` (${details}; check process-inspection permissions)`;
  if (failure.code === 'MALFORMED_PROCESS_EVIDENCE')
    return ` (${details}; the process-inspection result was malformed)`;
  return ` (${details})`;
}

/** Capture kernel process birth evidence; unavailable evidence is never a PID-only match. */
export function readProcessIdentity(pid: number): ProcessIdentity | undefined {
  return acquireProcessIdentity(pid).identity;
}

function acquireProcessIdentity(pid: number): IdentityAcquisition {
  if (!Number.isSafeInteger(pid) || pid <= 0) return {};
  const startedAt = performance.now();
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      // comm is parenthesized and may itself contain spaces or closing parentheses.
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      if (fields[0] === 'Z' || fields[0] === 'X') return {};
      return {
        identity: processIdentitySchema.parse({
          platform: 'linux',
          bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
          pidNamespace: fs.readlinkSync(`/proc/${pid}/ns/pid`),
          startTime: fields[19],
        }),
      };
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
      return {
        identity: processIdentitySchema.parse({ platform: 'darwin', hostname: os.hostname(), bootId, startTime }),
      };
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
      return { identity: processIdentitySchema.parse({ platform: 'win32', hostname: os.hostname(), startTime }) };
    }
  } catch (error) {
    const failure = {
      platform: process.platform,
      pid,
      elapsedMs: Math.round(performance.now() - startedAt),
      code: acquisitionFailureCode(error),
    };
    // Windows has a subprocess acquisition path; retain only safe diagnostic fields.
    if (process.platform === 'win32') logger.warn('Process birth evidence acquisition failed', failure);
    return { failure };
  }
  return {};
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
  const readIdentity = (pid: number): IdentityAcquisition =>
    dependencies.readIdentity ? { identity: dependencies.readIdentity(pid) } : acquireProcessIdentity(pid);
  const contextResult = readIdentity(process.pid);
  const context = contextResult.identity;
  if (!context)
    return {
      status: 'unknown',
      reason:
        'OS process evidence is unavailable to this CLI (permissions or platform tools)' +
        acquisitionFailureReason(contextResult.failure),
    };
  const mismatch = contextMismatch(identity, context);
  if (mismatch) return { status: 'unknown', reason: mismatch };
  const observedResult = readIdentity(pid);
  const observed = observedResult.identity;
  if (observed) {
    const mismatch = contextMismatch(identity, observed);
    if (mismatch) return { status: 'unknown', reason: mismatch };
    return { status: observed.startTime === identity.startTime ? 'alive' : 'dead' };
  }
  if (!(dependencies.processAlive ?? processExists)(pid)) return { status: 'dead' };
  return {
    status: 'unknown',
    reason:
      'the process may still exist, but its birth evidence could not be read' +
      acquisitionFailureReason(observedResult.failure),
  };
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
