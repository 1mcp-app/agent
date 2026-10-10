import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import { codeGraphEnvironment } from './codegraphEnvironment.js';
import { CodeGraphPreparationError } from './codegraphProcess.js';

const execute = promisify(execFile);
const environment = codeGraphEnvironment;
const responseSchema = z.object({ token: z.string().regex(/^builtin:/), paths: z.array(z.string()) });

/** Verified Git 2.52.0 Darwin native fsmonitor SimpleIPC. A query uses Git's
 * cookie barrier, not an assumption about when Node fs.watch events arrive.
 */
export class CodeGraphJournal {
  private owned?: ChildProcess;
  private exited?: Promise<void>;

  private constructor(
    readonly root: string,
    readonly socketPath: string,
  ) {}

  static async create(root: string, signal?: AbortSignal): Promise<CodeGraphJournal> {
    if (process.platform !== 'darwin')
      throw new Error(
        'Verified CodeGraph journal readiness currently supports Darwin only; native Windows and Linux lifecycle acceptance is pending.',
      );
    const { stdout: version } = await execute('git', ['version'], { env: environment(), timeout: 2_000, signal });
    if (version.trim() !== 'git version 2.52.0')
      throw new Error(
        'CodeGraph journal readiness requires the verified installed Git 2.52.0; no Git installation is performed.',
      );
    const { stdout } = await execute(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-C',
        root,
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        'fsmonitor--daemon.ipc',
      ],
      { env: environment(), timeout: 2_000, signal },
    );
    const { stdout: top } = await execute(
      'git',
      ['-c', 'core.fsmonitor=false', '-C', root, 'rev-parse', '--show-toplevel'],
      { env: environment(), timeout: 2_000, signal },
    );
    if (top.trim() !== root)
      throw new Error('Native source journal requires the exact Git worktree root, not an ancestor or nested project.');
    const socketPath = stdout.trim();
    if (!socketPath.startsWith('/')) throw new Error('Git returned a non-absolute fsmonitor socket path.');
    return new CodeGraphJournal(root, socketPath);
  }

  async query(token?: string, signal?: AbortSignal): Promise<{ token: string; paths: string[] }> {
    const info = await lstat(this.socketPath).catch(() => undefined);
    if (!info?.isSocket())
      throw new CodeGraphPreparationError(
        'journal_unavailable',
        'Native Git fsmonitor is unavailable for this checkout. Explicitly prepare with an authorized initialize/sync policy; inspection never starts a daemon.',
      );
    // Darwin sockaddr_un cannot hold long worktree socket paths. Native Git
    // connects relative to the socket directory too. Isolate cwd in a bounded
    // read-only child; never change the shared runtime's cwd or make symlinks.
    if (Buffer.byteLength(this.socketPath) >= 100) {
      try {
        const { stdout } = await execute(
          process.execPath,
          ['-e', LONG_SOCKET_QUERY, path.basename(this.socketPath), token ?? 'builtin:0:0'],
          {
            cwd: path.dirname(this.socketPath),
            env: environment(),
            signal,
            timeout: 2_000,
            maxBuffer: 1_048_576,
          },
        );
        return responseSchema.parse(JSON.parse(stdout));
      } catch (error) {
        if (signal?.aborted) throw new CodeGraphPreparationError('cancelled', 'Native readiness query cancelled.');
        throw new CodeGraphPreparationError(
          'journal_unavailable',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let pending = Buffer.alloc(0);
      const payloads: Buffer[] = [];
      let size = 0;
      let complete = false;
      const finish = (error?: Error) => {
        if (complete) return;
        complete = true;
        clearTimeout(deadline);
        signal?.removeEventListener('abort', abort);
        socket.destroy();
        if (error) reject(error);
      };
      const abort = () => finish(new CodeGraphPreparationError('cancelled', 'Native readiness query cancelled.'));
      const deadline = setTimeout(
        () =>
          finish(
            new CodeGraphPreparationError(
              'journal_timeout',
              'Native Git fsmonitor cookie barrier did not complete within 2 seconds.',
            ),
          ),
        2_000,
      );
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) return abort();
      socket.on('connect', () => {
        const message = Buffer.from(token ?? 'builtin:0:0');
        socket.write(
          Buffer.concat([
            Buffer.from((message.length + 4).toString(16).padStart(4, '0')),
            message,
            Buffer.from('0000'),
          ]),
        );
      });
      socket.on('error', (error) => finish(new CodeGraphPreparationError('journal_unavailable', error.message)));
      socket.on('end', () => {
        if (!complete) finish(new Error('Native Git fsmonitor returned an incomplete response.'));
      });
      socket.on('data', (data: Buffer) => {
        size += data.length;
        if (size > 1_048_576) return finish(new Error('Native Git fsmonitor response exceeded the bounded limit.'));
        pending = Buffer.concat([pending, data]);
        while (pending.length >= 4) {
          const header = pending.subarray(0, 4).toString('ascii');
          if (!/^[\da-f]{4}$/i.test(header)) return finish(new Error('Invalid native Git IPC packet header.'));
          const length = Number.parseInt(header, 16);
          if (length === 0) {
            const fields = Buffer.concat(payloads).toString('utf8').split('\0');
            const next = fields.shift();
            if (!next?.startsWith('builtin:')) return finish(new Error('Unsupported native Git journal token.'));
            const paths = fields.filter(Boolean);
            finish();
            resolve({ token: next, paths });
            return;
          }
          if (length < 4) return finish(new Error('Unsupported native Git IPC control packet.'));
          if (pending.length < length) return;
          payloads.push(pending.subarray(4, length));
          pending = pending.subarray(length);
        }
      });
    });
  }

  async start(signal: AbortSignal): Promise<void> {
    try {
      await this.query(undefined, signal);
      return;
    } catch (error) {
      if (!(error instanceof CodeGraphPreparationError && error.code === 'journal_unavailable')) throw error;
    }
    if (signal.aborted)
      throw new CodeGraphPreparationError('cancelled', 'Preparation cancelled before native journal startup.');
    const child = spawn('git', ['-c', 'core.fsmonitor=false', '-C', this.root, 'fsmonitor--daemon', 'run'], {
      env: environment(),
      stdio: 'ignore',
      detached: false,
    });
    this.owned = child;
    let exited = false;
    this.exited = new Promise<void>((resolve) =>
      child.once('close', () => {
        exited = true;
        resolve();
      }),
    );
    let startupError: Error | undefined;
    child.once('error', (error) => {
      startupError = error;
    });
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (signal.aborted) throw new CodeGraphPreparationError('cancelled', 'Native journal startup cancelled.');
        try {
          await this.query(undefined, signal);
          return;
        } catch (error) {
          if (exited) throw startupError ?? error;
          if (!(error instanceof CodeGraphPreparationError && error.code === 'journal_unavailable')) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Native Git fsmonitor did not start within the bounded startup budget.');
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    if (!this.owned || !this.exited) return;
    // Only this exact foreground child is a cancellation credential. Borrowed
    // socket owners are never stopped through Git's target-global stop command.
    const child = this.owned;
    this.owned = undefined;
    child.kill('SIGTERM');
    const escalation = setTimeout(() => child.kill('SIGKILL'), 2_000);
    await this.exited;
    clearTimeout(escalation);
  }
}

export function relevantJournalPaths(paths: readonly string[]): string[] {
  return paths.filter((file) => {
    if (file === '/') return true; // Native journal reset/gap: never reuse.
    if (file === '.codegraph/' || file.startsWith('.codegraph/')) return false;
    return true;
  });
}

const LONG_SOCKET_QUERY = String.raw`
const net = require('node:net');
const [name, token] = process.argv.slice(1);
const socket = net.createConnection(name);
let pending = Buffer.alloc(0), size = 0;
const payloads = [];
const fail = message => { console.error(message); socket.destroy(); process.exit(1); };
socket.on('error', e => fail(e.message));
socket.on('connect', () => { const message=Buffer.from(token); socket.write(Buffer.concat([Buffer.from((message.length+4).toString(16).padStart(4,'0')),message,Buffer.from('0000')])); });
socket.on('end', () => fail('Incomplete native Git IPC response.'));
socket.on('data', data => {
  size += data.length;
  if (size > 1048576) return fail('Native Git IPC response limit exceeded.');
  pending = Buffer.concat([pending,data]);
  while(pending.length >= 4) {
    const header=pending.subarray(0,4).toString('ascii');
    if(!/^[\da-f]{4}$/i.test(header)) return fail('Invalid Git IPC packet.');
    const length=parseInt(header,16);
    if(length===0) {
      const fields=Buffer.concat(payloads).toString('utf8').split('\0');
      const next=fields.shift();
      if(!next || !next.startsWith('builtin:')) return fail('Invalid Git journal token.');
      process.stdout.write(JSON.stringify({token:next,paths:fields.filter(Boolean)}));
      socket.destroy(); process.exit(0);
    }
    if(length<4) return fail('Invalid Git IPC control packet.');
    if(pending.length<length) return;
    payloads.push(pending.subarray(4,length));pending=pending.subarray(length);
  }
});
`;
