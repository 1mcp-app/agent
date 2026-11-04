import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readlink } from 'node:fs/promises';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';

let cached: string | undefined;
const pending = new Map<boolean, Promise<string | undefined>>();

/** PIDs authorize recovery only inside the same boot and PID namespace. */
export function coordinationScope(background = false): Promise<string | undefined> {
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(background);
  if (existing) return existing;
  const read = readScope(background)
    .catch(() => undefined)
    .then((scope) => {
      if (scope) cached = scope;
      return scope;
    })
    .finally(() => pending.delete(background));
  pending.set(background, read);
  return read;
}

async function readScope(background: boolean): Promise<string | undefined> {
  let evidence: string[];
  switch (process.platform) {
    case 'linux':
      evidence = await Promise.all([
        readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
        readlink('/proc/self/ns/pid'),
      ]);
      break;
    case 'darwin':
      evidence = [await command('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], background)];
      break;
    case 'win32': {
      const script =
        "$ErrorActionPreference='Stop'; (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid; (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks";
      evidence = [
        os.hostname(),
        await command(
          path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
          background,
        ),
      ];
      if (!/^[0-9a-f-]+\r?\n[0-9]+$/i.test(evidence[1])) return undefined;
      break;
    }
    default:
      return undefined;
  }
  if (evidence.some((value) => !value.trim())) return undefined;
  return createHash('sha256')
    .update(JSON.stringify([process.platform, ...evidence.map((v) => v.trim())]))
    .digest('hex');
}

function command(executable: string, args: string[], background: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    const deadline = setTimeout(
      () => {
        child.kill();
        reject(new Error('Telemetry coordination scope unavailable'));
      },
      background ? 3000 : 10_000,
    );
    if (background) {
      child.unref();
      if (child.stdout instanceof Socket) child.stdout.unref();
      deadline.unref();
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 4096) {
        child.kill();
        reject(new Error('Invalid telemetry coordination scope'));
      }
    });
    child.once('error', () => {
      clearTimeout(deadline);
      reject(new Error('Telemetry coordination scope unavailable'));
    });
    child.once('close', (code) => {
      clearTimeout(deadline);
      if (code === 0) resolve(output.trim());
      else reject(new Error('Telemetry coordination scope unavailable'));
    });
  });
}
