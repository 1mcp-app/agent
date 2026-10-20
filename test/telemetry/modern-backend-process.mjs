import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function within(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise.then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Test-only backend on a separate event loop, owned by this exact IPC child. */
export async function startModernBackend({ toolCount = 0, stderrPath } = {}) {
  assert(Number.isInteger(toolCount) && toolCount >= 0 && toolCount <= 10000);
  assert(stderrPath, 'A retained backend stderr path is required');
  const fd = openSync(stderrPath, 'w', 0o600);
  let child;
  try {
    child = fork(fileURLToPath(import.meta.url), ['--worker', String(toolCount)], {
      execArgv: [],
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key !== 'NODE_OPTIONS' && !key.startsWith('OTEL_') && !key.startsWith('ONE_MCP_'),
        ),
      ),
      stdio: ['ignore', 'ignore', fd, 'ipc'],
    });
  } finally {
    closeSync(fd);
  }
  let exited = false;
  const closed = new Promise((resolve) =>
    child.once('close', () => {
      exited = true;
      resolve();
    }),
  );
  let stopping;
  const close = () =>
    (stopping ??= (async () => {
      if (exited) return;
      try {
        if (child.connected)
          child.send({ type: 'shutdown' }, (error) => {
            if (error) child.kill('SIGTERM');
          });
        else child.kill('SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      if (await within(closed, 3000)) return;
      child.kill('SIGKILL');
      assert(await within(closed, 3000), 'Owned modern backend did not exit after escalation');
    })());
  try {
    const url = await new Promise((resolve, reject) => {
      const finish = (error, url) => {
        clearTimeout(timer);
        child.off('message', ready);
        child.off('error', failed);
        child.off('close', earlyExit);
        if (error) reject(error);
        else resolve(url);
      };
      const failed = (error) => finish(error);
      const earlyExit = () => finish(new Error('Modern backend exited before readiness'));
      const ready = (message) => {
        try {
          assert.equal(message?.type, 'modern-backend-ready');
          assert.equal(message.pid, child.pid);
          const url = new URL(message.url);
          assert.equal(url.protocol, 'http:');
          assert.equal(url.hostname, '127.0.0.1');
          assert.equal(url.pathname, '/mcp');
          assert(Number(url.port) > 0);
          finish(undefined, url.href);
        } catch (error) {
          finish(error);
        }
      };
      const timer = setTimeout(() => finish(new Error('Modern backend readiness timed out')), 10000);
      child.on('message', ready);
      child.once('error', failed);
      child.once('close', earlyExit);
    });
    return { pid: child.pid, url, config: { type: 'http', url, protocolVersion: '2026-07-28' }, stderrPath, close };
  } catch (error) {
    await close();
    const stderr = await readFile(stderrPath, 'utf8').catch(() => '');
    throw new Error(`${error.message}; backend stderr: ${stderr.slice(-8192)}`, { cause: error });
  }
}

if (process.argv[2] === '--worker') {
  assert(process.send, 'Fixture worker requires owned IPC');
  const { createModernBackend } = await import('./workload-modern-backend.mjs');
  const backend = await createModernBackend({ toolCount: Number(process.argv[3]) });
  let stopping;
  const stop = () =>
    (stopping ??= backend.close().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    ));
  process.on('message', (message) => {
    if (message?.type === 'shutdown') void stop();
  });
  process.once('disconnect', stop);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.send({ type: 'modern-backend-ready', pid: process.pid, url: backend.url });
}
