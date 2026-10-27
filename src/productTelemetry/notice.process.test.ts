import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { build } from 'esbuild';
import { expect, it } from 'vitest';

import { createTestProcessEnvironment } from '../../scripts/test-process-environment.mjs';

it('contains a broken stderr notice without admitting identity or changing the foreground result', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'product-notice-'));
  const script = path.join(directory, 'notice.mjs');
  await build({
    stdin: {
      contents: `import { InstallationStore } from './src/productTelemetry/installationStore.ts'; import { writeProductNotice } from './src/productTelemetry/notice.ts'; const store = new InstallationStore(process.argv[2], {notice: writeProductNotice}); process.send('ready'); process.on('message', async () => { process.stdout.write('original-result'); let failed = false; try { await store.admit(); } catch { failed = true; } process.send({ failed, status: await store.status() }); process.disconnect(); });`,
      resolveDir: process.cwd(),
    },
    outfile: script,
    bundle: true,
    format: 'esm',
    platform: 'node',
  });
  const child = fork(script, [path.join(directory, 'installation')], {
    env: createTestProcessEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stdout = '';
  child.stdout!.on('data', (chunk) => {
    stdout += chunk;
  });
  const messages: unknown[] = [];
  child.on('message', (message) => {
    if (message === 'ready') {
      child.stderr!.destroy();
      child.send('run');
    } else messages.push(message);
  });
  let timer: ReturnType<typeof setTimeout>;
  try {
    const exit = await Promise.race([
      new Promise<number | null>((resolve) => child.once('exit', resolve)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('notice fixture did not exit')), 15000);
      }),
    ]);
    expect(exit).toBe(0);
    expect(stdout).toBe('original-result');
    expect(messages).toEqual([
      {
        failed: true,
        status: { preference: 'default', identityPresent: false, queuedSummaries: 0, coordination: 'available' },
      },
    ]);
  } finally {
    clearTimeout(timer!);
    child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
