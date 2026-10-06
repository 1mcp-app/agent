import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { reserveLoopbackPort } from '../runtime/loopbackPorts.js';

export const OFFICIAL_REFERENCE_COMMIT = 'c321dd32035556e6769d3724a8ee97d87c3faaac';

export async function startOfficialReferenceServer(
  root: string,
  home: string,
): Promise<{ endpoint: string; close(): Promise<void> }> {
  const directory = join(root, 'test/conformance/official/fixtures/reference');
  const fixture = join(directory, 'everything-server.mjs');
  const provenance = z
    .object({
      commit: z.literal(OFFICIAL_REFERENCE_COMMIT),
      generatedSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .parse(JSON.parse(await readFile(join(directory, 'provenance.json'), 'utf8')));
  if (
    createHash('sha256')
      .update(await readFile(fixture))
      .digest('hex') !== provenance.generatedSha256
  ) {
    throw new Error('official-reference-integrity-invalid');
  }
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, [fixture], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      PORT: String(port),
      NODE_ENV: 'test',
      NO_PROXY: '127.0.0.1,localhost,::1',
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  // Keep late child-process errors from becoming uncaught exceptions.
  child.on('error', () => undefined);
  const close = async (): Promise<void> => {
    if (!child.pid) return;
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error): void => {
        clearTimeout(timer);
        if (forceTimer) clearTimeout(forceTimer);
        child.removeListener('exit', exited);
        child.removeListener('error', failed);
        if (error) reject(error);
        else resolve();
      };
      const exited = (): void => finish();
      const failed = (error: Error): void => finish(error);
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        forceTimer = setTimeout(() => finish(new Error('official-reference-cleanup-timeout')), 3_000);
      }, 3_000);
      child.once('exit', exited);
      child.once('error', failed);
      if (child.exitCode !== null || child.signalCode !== null) {
        finish();
        return;
      }
      child.kill('SIGTERM');
    });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('official-reference-readiness-timeout')), 15_000);
      const failed = (): void => {
        clearTimeout(timer);
        reject(new Error('official-reference-exited'));
      };
      child.once('error', failed);
      child.once('exit', failed);
      child.stdout?.on('data', (chunk: Buffer | string) => {
        output += String(chunk);
        if (output.length > 16_384) {
          clearTimeout(timer);
          reject(new Error('official-reference-readiness-invalid'));
          return;
        }
        if (!output.includes(`MCP Conformance Test Server running on http://localhost:${port}`)) return;
        clearTimeout(timer);
        child.removeListener('error', failed);
        child.removeListener('exit', failed);
        // Reference server emits session logs later; drain without retaining them.
        child.stdout?.removeAllListeners('data');
        child.stdout?.resume();
        resolve();
      });
    });
    return { endpoint: `http://127.0.0.1:${port}/mcp`, close };
  } catch (error) {
    await close();
    throw error;
  }
}
