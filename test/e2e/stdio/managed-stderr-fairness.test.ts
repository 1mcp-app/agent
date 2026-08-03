import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { ManagedStdioStderr } from '@src/transport/managedStdioStderr.js';

import { expect, it } from 'vitest';

async function within<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Operation exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

it('keeps a healthy MCP request responsive while another child floods managed stderr', async () => {
  const noisyProcess = spawn(
    process.execPath,
    [
      '-e',
      "const chunk = 'stderr flood\\n'.repeat(16384); const flood = () => { if (!process.stderr.write(chunk)) process.stderr.once('drain', flood); else setImmediate(flood); }; flood();",
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const noisyExited = once(noisyProcess, 'exit');
  const noisyStarted = once(noisyProcess.stderr, 'data');
  const noisyStderr = new ManagedStdioStderr('noisy-server', {
    emit: () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5),
    maxBytesPerTurn: 64,
    maxBufferedBytes: 1024,
    maxLinesPerWindow: 200,
  });
  const healthyTransport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../fixtures/echo-server.js', import.meta.url))],
  });
  const healthyClient = new Client({ name: 'stderr-fairness-test', version: '1.0.0' });

  noisyStderr.attach(noisyProcess.stderr);

  try {
    await within(noisyStarted, 5_000);
    await within(healthyClient.connect(healthyTransport), 5_000);
    const result = await within(
      healthyClient.callTool({ name: 'echo', arguments: { message: 'still responsive' } }),
      2_000,
    );

    expect(result.content).toContainEqual(
      expect.objectContaining({ text: expect.stringContaining('still responsive') }),
    );
  } finally {
    noisyProcess.kill();
    await Promise.all([noisyStderr.close(), healthyTransport.close(), within(noisyExited, 1_000)]);
  }
});
