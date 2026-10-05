import { spawn } from 'node:child_process';

/** Drain every preparation command before allowing protocol tests to start. */
export async function runConformancePreparation(steps) {
  return Promise.all(
    steps.map(({ name, command, args, cwd, env }) => {
      const started = performance.now();
      return new Promise((resolve) => {
        const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
        let launchFailed = false;
        child.once('error', () => {
          launchFailed = true;
        });
        child.once('close', (status) => {
          const exitStatus = launchFailed ? 1 : (status ?? 1);
          process.stdout.write(
            `[conformance] ${name}: ${((performance.now() - started) / 1000).toFixed(2)}s, exit ${exitStatus}\n`,
          );
          resolve(exitStatus);
        });
      });
    }),
  );
}
