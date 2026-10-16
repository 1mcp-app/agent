import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

export class ConfiguredCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface ConfiguredCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

interface CommandOptions {
  readonly checkoutRoot: string;
  readonly operation: string;
  readonly signal?: AbortSignal;
  readonly deadlineMs: number;
  readonly outputLimitBytes: number;
  readonly terminationGraceMs: number;
  readonly beforeLaunch?: () => void;
}

/** Only invocations whose descendants stay in their new process group are supported. */
export async function verifyCommandContainment(signal?: AbortSignal, timeoutMs = 5000): Promise<void> {
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw new ConfiguredCommandError(
      'unsupported_containment',
      'Owned process-group cancellation is unavailable on this platform.',
    );
  await processGroups(signal, timeoutMs);
}

async function processGroups(signal?: AbortSignal, timeoutMs = 5000): Promise<{ group: number; state: string }[]> {
  try {
    const { stdout } = await executeFile('ps', ['-axo', 'pgid=,stat='], {
      signal,
      timeout: Math.max(1, Math.min(5000, timeoutMs)),
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout
      .trim()
      .split('\n')
      .map((line) => {
        const [group, state] = line.trim().split(/\s+/);
        if (!/^\d+$/.test(group) || !state) throw new Error('Invalid process inventory');
        return { group: Number(group), state };
      });
  } catch {
    throw new ConfiguredCommandError(
      'unsupported_containment',
      'Cannot verify owned process groups; no command may launch without cancellation support.',
    );
  }
}

export async function runConfiguredCommand(
  command: ConfiguredCommand,
  options: CommandOptions,
): Promise<{ code: number; output: string; diagnostic: string }> {
  if (options.signal?.aborted) throw new ConfiguredCommandError('cancelled', 'Command cancelled before launch.');
  const expiresAt = Date.now() + options.deadlineMs;
  try {
    await verifyCommandContainment(options.signal, options.deadlineMs);
  } catch (error) {
    if (options.signal?.aborted)
      throw new ConfiguredCommandError(
        'cancelled',
        'Command cancelled during containment verification; no command launched.',
      );
    if (Date.now() >= expiresAt)
      throw new ConfiguredCommandError(
        'execution_deadline',
        'Containment verification exhausted the command budget; no command launched.',
      );
    throw error;
  }
  if (options.signal?.aborted) throw new ConfiguredCommandError('cancelled', 'Command cancelled before launch.');
  if (Date.now() >= expiresAt)
    throw new ConfiguredCommandError(
      'execution_deadline',
      'Containment verification exhausted the command budget; no command launched.',
    );
  const args = command.args.map((argument) =>
    argument.replace(/\{(checkout|operation)\}/g, (_placeholder, field: string) =>
      field === 'checkout' ? options.checkoutRoot : options.operation,
    ),
  );
  options.beforeLaunch?.();
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, args, {
      cwd: options.checkoutRoot,
      detached: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = Buffer.alloc(0);
    let diagnostic = Buffer.alloc(0);
    let closed = false;
    let exitCode: number | null = null;
    let failure: ConfiguredCommandError | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    let checking = false;
    const signalOwned = (signal: 'SIGTERM' | 'SIGKILL'): void => {
      if (!child.pid || finished) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        /* Group exit can race signalling. */
      }
    };
    const stop = (error: ConfiguredCommandError): void => {
      if (failure) return;
      failure = error;
      signalOwned('SIGTERM');
      escalation = setTimeout(() => signalOwned('SIGKILL'), options.terminationGraceMs);
    };
    const abort = (): void =>
      stop(new ConfiguredCommandError('cancelled', 'Owned command cancelled; foreign processes were not targeted.'));
    const deadline = setTimeout(
      () =>
        stop(
          new ConfiguredCommandError(
            'execution_deadline',
            'Owned command exceeded its execution deadline. Explicitly retry with a larger budget.',
          ),
        ),
      Math.max(1, expiresAt - Date.now()),
    );
    const finish = (): void => {
      finished = true;
      clearTimeout(deadline);
      if (escalation) clearTimeout(escalation);
      if (poll) clearTimeout(poll);
      options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (exitCode === null)
        reject(new ConfiguredCommandError('command_failed', 'Command ended without a successful exit code.'));
      else resolve({ code: exitCode, output: output.toString('utf8'), diagnostic: diagnostic.toString('utf8') });
    };
    const check = async (): Promise<void> => {
      if (finished || checking) return;
      checking = true;
      try {
        if (closed && !child.pid) {
          finish();
          return;
        }
        try {
          const groups = await processGroups();
          const alive = groups.some((item) => item.group === child.pid && !item.state.startsWith('Z'));
          if (closed && !alive) {
            finish();
            return;
          }
        } catch (error) {
          stop(
            error instanceof ConfiguredCommandError
              ? error
              : new ConfiguredCommandError('ownership_unknown', 'Owned process inventory unavailable.'),
          );
          // Preserve ownership and scheduler capacity until actual group settlement is verified.
          signalOwned('SIGKILL');
          if (closed && child.pid) {
            try {
              process.kill(-child.pid, 0);
            } catch (inventoryError) {
              if ((inventoryError as { code?: string }).code === 'ESRCH') {
                finish();
                return;
              }
            }
          }
        }
        if (finished) return;
        poll = setTimeout(
          () => {
            void check();
          },
          closed ? 50 : 500,
        );
      } finally {
        checking = false;
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length + chunk.length > options.outputLimitBytes) {
        output = Buffer.concat([output, chunk]).subarray(0, options.outputLimitBytes);
        stop(new ConfiguredCommandError('output_limit', 'Command output exceeded its bounded capture limit.'));
        return;
      }
      output = Buffer.concat([output, chunk]);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostic = Buffer.concat([diagnostic, chunk]).subarray(-options.outputLimitBytes);
    });
    child.once('error', (error) => {
      failure = new ConfiguredCommandError('command_unavailable', error.message);
    });
    child.once('close', (code) => {
      closed = true;
      exitCode = code;
      // Wake settlement immediately; short probes never wait for the running interval.
      if (poll) clearTimeout(poll);
      void check();
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    void check();
  });
}
