import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const collectorVersion = '0.163.1';

/** Caller supplies an official checksum-verified executable; no implicit download. */
export async function startRealCollector(binary, { port = 0 } = {}) {
  if (port === 0) {
    const reservation = createServer();
    await new Promise((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', resolve);
    });
    port = reservation.address().port;
    await new Promise((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())));
  }
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' });
  if (!version.includes(` ${collectorVersion}`)) throw new Error('Unexpected Collector version');
  const directory = await mkdtemp(join(tmpdir(), '1mcp-collector-'));
  const capture = join(directory, 'otlp.json');
  const config = (await readFile(new URL('../../test/telemetry/collector.yaml', import.meta.url), 'utf8'))
    .replace('0.0.0.0:4318', `127.0.0.1:${port}`)
    .replaceAll('/capture/', directory + '/');
  const configPath = join(directory, 'collector.yaml');
  await writeFile(configPath, config);
  const child = spawn(binary, [`--config=${configPath}`], { stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostic = '';
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  child.stderr.on('data', (chunk) => {
    diagnostic = (diagnostic + chunk).slice(-8192);
  });
  const hasExited = () => child.exitCode !== null || child.signalCode !== null;
  let stopping;
  const stop = () =>
    (stopping ??= (async () => {
      if (spawnError) return;
      if (!hasExited()) {
        child.kill('SIGTERM');
        for (let attempt = 0; attempt < 50 && !hasExited(); attempt++) await delay(100);
        if (!hasExited()) {
          child.kill('SIGKILL');
          for (let attempt = 0; attempt < 20 && !hasExited(); attempt++) await delay(100);
        }
      }
      if (child.exitCode !== 0)
        throw new Error(`Collector exited abnormally (${child.exitCode ?? child.signalCode}): ${diagnostic}`);
      const pieces = [];
      for (const name of ['traces.json', 'metrics.json']) {
        try {
          pieces.push(await readFile(join(directory, name), 'utf8'));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      await writeFile(capture, pieces.join('\n'));
    })());
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      if (hasExited()) throw new Error(`Collector exited before readiness: ${diagnostic}`);
      if (!diagnostic.includes('Everything is ready.')) {
        await delay(100);
        continue;
      }
      try {
        // Empty protobuf is valid: proves the actual receiver, not just an open TCP port.
        const response = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-protobuf' },
          body: Buffer.alloc(0),
          signal: AbortSignal.timeout(300),
        });
        if (response.ok)
          return {
            url: `http://127.0.0.1:${port}`,
            capture,
            directory,
            get diagnostic() {
              return diagnostic;
            },
            version: version.trim(),
            stop,
            cleanup: async () => {
              try {
                await stop();
              } finally {
                await rm(directory, { recursive: true, force: true });
              }
            },
          };
      } catch {
        /* bounded readiness polling */
      }
      await delay(100);
    }
    throw new Error(`Collector readiness timeout: ${diagnostic}`);
  } catch (error) {
    try {
      await stop();
    } catch {
      /* Preserve the original startup failure, which includes diagnostics. */
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    throw error;
  }
}
