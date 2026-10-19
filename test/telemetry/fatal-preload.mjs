// Test-only loopback fault trigger, available on Windows/macOS/Linux.
// One file per owned process prevents a backend child overwriting the runtime URL.
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { isMainThread } from 'node:worker_threads';

const destination = process.env.TELEMETRY_ACCEPTANCE_FAULT_FILE;
if (destination && isMainThread) {
  const server = createServer((_req, res) => {
    res.end('accepted');
    setTimeout(() => {
      writeFileSync(
        `${destination}.${process.pid}.triggered`,
        JSON.stringify({
          at: Date.now(),
          uncaught: process.listenerCount('uncaughtException'),
          unhandled: process.listenerCount('unhandledRejection'),
        }),
        { mode: 0o600 },
      );
      throw new Error('PRIVACY_ERROR_489');
    }, 10);
  });
  server.listen(0, '127.0.0.1', () =>
    writeFileSync(`${destination}.${process.pid}`, `http://127.0.0.1:${server.address().port}`, { mode: 0o600 }),
  );
  server.unref();
}
