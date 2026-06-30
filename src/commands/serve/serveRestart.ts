import type { ServeOptions } from './serve.js';
import { runServeBackground } from './serveBackground.js';
import { runServeStop } from './serveStop.js';

/**
 * `serve --restart`: stop the runtime in the selected Runtime Scope (if any),
 * then start a fresh detached background runtime.
 *
 * Semantics mirror `systemctl restart`: when nothing is running the stop is a
 * clean no-op and a background runtime is still started, so a successful restart
 * always ends in a running runtime. This is a thin composition of the existing
 * `--stop` and `--background` handlers; staleness handling, signal escalation,
 * detached spawn, readiness wait, and idempotency all come from them unchanged.
 *
 * Both handlers communicate via `process.exitCode` (the established lifecycle
 * pattern), so this routine inspects it between the two phases: if the stop
 * genuinely failed (runtime still alive after SIGKILL) it aborts before starting
 * to avoid two runtimes contending for the same scope/port.
 */

export interface RunRestartDeps {
  runStop?: typeof runServeStop;
  runBackground?: typeof runServeBackground;
}

export async function runServeRestart(parsedArgv: ServeOptions, deps: RunRestartDeps = {}): Promise<void> {
  const runStop = deps.runStop ?? runServeStop;
  const runBackground = deps.runBackground ?? runServeBackground;

  process.stderr.write('Restarting background runtime…\n');

  // Phase 1: stop. A "nothing running" or stale-PID scope exits 0 here.
  process.exitCode = undefined;
  await runStop(parsedArgv['config-dir']);
  if (process.exitCode) {
    process.stderr.write('Error: restart aborted; could not stop the existing runtime. See messages above.\n');
    // Leave the non-zero exit code from the stop phase in place.
    return;
  }

  // Phase 2: start a fresh detached background runtime. The stop cleaned up the
  // PID file, so the background idempotency probe sees an empty scope.
  process.exitCode = undefined;
  await runBackground(parsedArgv);
}
