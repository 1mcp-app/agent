import { spawn } from 'node:child_process';
import { PassThrough, type Readable, type Writable } from 'node:stream';

import type { SanitizedWireCapture, WireDirection } from './sanitizedWireEvidence.js';

const LINE_INSPECTION_LIMIT = 1_048_576;
const SHUTDOWN_PHASE_TIMEOUT_MS = 500;

export interface StdioWireTapStatus {
  exitKind: 'zero' | 'nonzero' | 'signal';
  stderr: 'absent' | 'present';
}

export interface StdioWireTap {
  stdin: Writable;
  stdout: Readable;
  closed: Promise<StdioWireTapStatus>;
  close(): Promise<StdioWireTapStatus>;
}

async function waitForExit(
  closed: Promise<StdioWireTapStatus>,
  timeoutMs: number,
): Promise<StdioWireTapStatus | undefined> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      closed,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

class SanitizingLineObserver {
  private chunks: Buffer[] | null = [];
  private length = 0;

  constructor(
    private readonly capture: SanitizedWireCapture,
    private readonly contextId: string,
    private readonly direction: WireDirection,
  ) {}

  push(chunk: Buffer | string): void {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    let start = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== 0x0a) continue;
      this.append(bytes.subarray(start, index));
      this.emitLine();
      start = index + 1;
    }
    this.append(bytes.subarray(start));
  }

  finish(): void {
    if (this.length > 0) this.emitLine();
  }

  private append(bytes: Buffer): void {
    if (bytes.length === 0) return;
    this.length += bytes.length;
    if (this.chunks && this.length <= LINE_INSPECTION_LIMIT) {
      this.chunks.push(Buffer.from(bytes));
      return;
    }
    if (this.chunks) {
      for (const chunk of this.chunks) chunk.fill(0);
      this.chunks = null;
    }
  }

  private emitLine(): void {
    const body = this.chunks ? Buffer.concat(this.chunks) : Buffer.alloc(0);
    this.capture.observe({
      contextId: this.contextId,
      hop: 'stdio',
      direction: this.direction,
      headers: {},
      body,
      bodyByteLength: this.length,
    });
    body.fill(0);
    if (this.chunks) {
      for (const chunk of this.chunks) chunk.fill(0);
    }
    this.chunks = [];
    this.length = 0;
  }
}

export async function startStdioWireTap(options: {
  command: string;
  args?: readonly string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  capture: SanitizedWireCapture;
  contextId: string;
}): Promise<StdioWireTap> {
  const child = spawn(options.command, [...(options.args ?? [])], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const input = new PassThrough();
  const output = new PassThrough();
  const requestObserver = new SanitizingLineObserver(options.capture, options.contextId, 'gateway_to_peer');
  const responseObserver = new SanitizingLineObserver(options.capture, options.contextId, 'peer_to_gateway');
  let stderrPresent = false;

  input.on('data', (chunk: Buffer) => requestObserver.push(chunk));
  input.once('end', () => requestObserver.finish());
  child.stdout.on('data', (chunk: Buffer) => responseObserver.push(chunk));
  child.stdout.once('end', () => responseObserver.finish());
  child.stderr.on('data', () => {
    stderrPresent = true;
  });
  input.pipe(child.stdin);
  child.stdout.pipe(output);
  child.stderr.resume();

  const closed = new Promise<StdioWireTapStatus>((resolve) => {
    child.once('close', (code, signal) => {
      resolve({
        exitKind: signal ? 'signal' : code === 0 ? 'zero' : 'nonzero',
        stderr: stderrPresent ? 'present' : 'absent',
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', () => reject(new Error('Stdio wire tap spawn failure')));
  });

  let closePromise: Promise<StdioWireTapStatus> | undefined;

  return {
    stdin: input,
    stdout: output,
    closed,
    async close() {
      closePromise ??= (async () => {
        if (!input.destroyed && !input.writableEnded) input.end();

        const graceful = await waitForExit(closed, SHUTDOWN_PHASE_TIMEOUT_MS);
        if (graceful) return graceful;

        child.kill('SIGTERM');
        const terminated = await waitForExit(closed, SHUTDOWN_PHASE_TIMEOUT_MS);
        if (terminated) return terminated;

        child.kill('SIGKILL');
        const killed = await waitForExit(closed, SHUTDOWN_PHASE_TIMEOUT_MS);
        if (killed) return killed;

        throw new Error('Stdio wire tap shutdown failure');
      })();
      return closePromise;
    },
  };
}
