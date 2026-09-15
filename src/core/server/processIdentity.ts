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
  z.object({ platform: z.literal('darwin'), hostname: z.string().min(1), startTime: z.string().min(1) }),
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
        .execFileSync('/usr/bin/env', ['LC_ALL=C', '/bin/ps', '-p', String(pid), '-o', 'lstart='], {
          encoding: 'utf8',
          timeout: 3000,
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        .trim();
      return processIdentitySchema.parse({ platform: 'darwin', hostname: os.hostname(), startTime });
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

function sameContext(left: ProcessIdentity, right: ProcessIdentity): boolean {
  if (left.platform !== right.platform) return false;
  if (left.platform === 'linux' && right.platform === 'linux') {
    return left.bootId === right.bootId && left.pidNamespace === right.pidNamespace;
  }
  return 'hostname' in left && 'hostname' in right && left.hostname === right.hostname;
}

/** Numeric PIDs are meaningful only within the recorded execution context. */
export function inspectProcessIdentity(
  pid: number,
  identity?: ProcessIdentity,
  dependencies: IdentityDependencies = {},
): ProcessIdentityStatus {
  if (!identity) return 'unknown';
  const readIdentity = dependencies.readIdentity ?? readProcessIdentity;
  const context = readIdentity(process.pid);
  if (!context || !sameContext(identity, context)) return 'unknown';
  const observed = readIdentity(pid);
  if (observed) {
    if (!sameContext(identity, observed)) return 'unknown';
    return observed.startTime === identity.startTime ? 'alive' : 'dead';
  }
  return (dependencies.processAlive ?? processExists)(pid) ? 'unknown' : 'dead';
}
