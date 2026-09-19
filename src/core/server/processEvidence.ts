import fs from 'node:fs';

import { z } from 'zod';

const integer = z.number().int().nonnegative().max(2147483647);
const evidenceShape = z.object({
  pid: integer.positive(),
  ppid: integer,
  uid: z.number().int().nonnegative(),
  realUid: z.number().int().nonnegative(),
  executable: z.string(),
  argv: z.array(z.string()).max(65536),
  exited: z.literal(true).optional(),
  birth: z.string().regex(/^\d+(?:\.\d+)?$/),
  context: z.object({
    platform: z.literal('linux'),
    bootId: z.string().min(1),
    pidNamespace: z.string().regex(/^pid:\[\d+\]$/),
    mountNamespace: z
      .string()
      .regex(/^mnt:\[\d+\]$/)
      .optional(),
    userNamespace: z
      .string()
      .regex(/^user:\[\d+\]$/)
      .optional(),
  }),
});
export type ProcessEvidence = z.infer<typeof evidenceShape>;
const evidenceSchema = evidenceShape.refine(hasCompleteEvidence);

function hasCompleteEvidence(value: ProcessEvidence): boolean {
  if (value.exited) return value.executable === '' && value.argv.length === 0;
  if (!value.executable.startsWith('/')) return false;
  if (value.argv.length === 0) return false;
  return !!(value.context.mountNamespace && value.context.userNamespace);
}
const MAX_BYTES = 4 * 1024 * 1024;

function readBounded(filename: string, limit: number): string {
  const fd = fs.openSync(filename, 'r');
  try {
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length <= limit) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
      length += count;
    }
    throw new Error('Process evidence exceeds limit');
  } finally {
    fs.closeSync(fd);
  }
}

function readExitedNamespace(filename: string): string | undefined {
  try {
    return fs.readlinkSync(filename);
  } catch {
    return undefined;
  }
}

function linuxSnapshot(pid: number): ProcessEvidence {
  const base = `/proc/${pid}`;
  const stat = readBounded(`${base}/stat`, 16384);
  const end = stat.lastIndexOf(')');
  if (!stat.startsWith(`${pid} (`) || end < 0) throw new Error('Malformed process stat');
  const fields = stat
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  const exited = fields[0] === 'Z' || fields[0] === 'X';
  const status = readBounded(`${base}/status`, 65536);
  const uid = /^Uid:\s+(\d+)\s+(\d+)\s+\d+\s+\d+$/m.exec(status);
  const cmdline = exited ? '' : readBounded(`${base}/cmdline`, MAX_BYTES);
  if (!uid) throw new Error('Missing process evidence');
  if (!exited && !cmdline.endsWith('\0')) throw new Error('Missing process evidence');
  return evidenceSchema.parse({
    pid,
    ppid: Number(fields[1]),
    uid: Number(uid[2]),
    realUid: Number(uid[1]),
    executable: exited ? '' : fs.readlinkSync(`${base}/exe`),
    argv: exited ? [] : cmdline.slice(0, -1).split('\0'),
    ...(exited ? { exited: true } : {}),
    birth: fields[19],
    context: {
      platform: 'linux',
      bootId: readBounded('/proc/sys/kernel/random/boot_id', 128).trim(),
      pidNamespace: fs.readlinkSync(`${base}/ns/pid`),
      mountNamespace: exited ? readExitedNamespace(`${base}/ns/mnt`) : fs.readlinkSync(`${base}/ns/mnt`),
      userNamespace: exited ? readExitedNamespace(`${base}/ns/user`) : fs.readlinkSync(`${base}/ns/user`),
    },
  });
}

/** Capture exact procfs evidence on Linux; other platforms use guided legacy recovery. */
export function readProcessEvidence(pid: number): ProcessEvidence | undefined {
  if (process.platform !== 'linux') return undefined;
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2147483647) return undefined;
  try {
    const before = linuxSnapshot(pid);
    const after = linuxSnapshot(pid);
    return JSON.stringify(before) === JSON.stringify(after) ? after : undefined;
  } catch {
    return undefined;
  }
}
