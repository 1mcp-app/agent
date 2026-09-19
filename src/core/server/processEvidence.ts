import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  context: z.discriminatedUnion('platform', [
    z.object({
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
    z.object({ platform: z.literal('darwin'), bootId: z.string().regex(/^\d+\.\d+$/) }),
  ]),
});
export type ProcessEvidence = z.infer<typeof evidenceShape>;
const evidenceSchema = evidenceShape.refine(hasCompleteEvidence);

function hasCompleteEvidence(value: ProcessEvidence): boolean {
  if (value.exited) return value.executable === '' && value.argv.length === 0;
  if (!value.executable.startsWith('/')) return false;
  if (value.argv.length === 0) return false;
  if (value.context.platform === 'linux') {
    return !!(value.context.mountNamespace && value.context.userNamespace);
  }
  return true;
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

function prepareDarwinHelper(): { file: string; directory?: string } {
  const embedded = (globalThis as typeof globalThis & { __1MCP_SEA_PROCESS_EVIDENCE__?: string })
    .__1MCP_SEA_PROCESS_EVIDENCE__;
  if (embedded === undefined) {
    // Emitted at build/core/server: two parents resolve to build/native, not repository/native.
    return { file: fileURLToPath(new URL('../../native/process-evidence-darwin', import.meta.url)) };
  }
  if (!embedded.length || embedded.length > MAX_BYTES * 2) throw new Error('Invalid embedded helper');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-process-evidence-'));
  try {
    fs.chmodSync(directory, 0o700);
    const file = path.join(directory, 'probe');
    fs.writeFileSync(file, Buffer.from(embedded, 'base64'), { mode: 0o700, flag: 'wx' });
    return { file, directory };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function darwinSnapshot(pid: number, helper: string): ProcessEvidence {
  const output = childProcess.execFileSync(helper, [String(pid)], {
    timeout: 3000,
    maxBuffer: MAX_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const result = evidenceSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output)));
  if (result.pid !== pid || result.context.platform !== 'darwin') throw new Error('Wrong process evidence');
  return result;
}

/** Owns only helper materialization; every read still acquires fresh paired process snapshots. */
export function createProcessEvidenceReader(): { read: typeof readProcessEvidence; close: () => void } {
  let helper: ReturnType<typeof prepareDarwinHelper> | undefined;
  let closed = false;
  const readDarwin = (pid: number): ProcessEvidence => {
    helper ??= prepareDarwinHelper();
    return darwinSnapshot(pid, helper.file);
  };
  return {
    read(pid) {
      if (closed) return undefined;
      return readStableEvidence(pid, readDarwin);
    },
    close() {
      if (closed) return;
      closed = true;
      if (helper?.directory) fs.rmSync(helper.directory, { recursive: true, force: true });
    },
  };
}

/** Convenience read outside a lifecycle operation; always disposes its own helper. */
export function readProcessEvidence(pid: number): ProcessEvidence | undefined {
  try {
    const reader = createProcessEvidenceReader();
    try {
      return reader.read(pid);
    } finally {
      reader.close();
    }
  } catch {
    return undefined;
  }
}

/** Capture exact argv and kernel ownership evidence; unavailable or changing evidence fails closed. */
function readStableEvidence(pid: number, readDarwin: (pid: number) => ProcessEvidence): ProcessEvidence | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2147483647) return undefined;
  try {
    let read: (pid: number) => ProcessEvidence;
    switch (process.platform) {
      case 'linux':
        read = linuxSnapshot;
        break;
      case 'darwin':
        read = readDarwin;
        break;
      default:
        return undefined;
    }
    const before = read(pid);
    const after = read(pid);
    return JSON.stringify(before) === JSON.stringify(after) ? after : undefined;
  } catch {
    return undefined;
  }
}
