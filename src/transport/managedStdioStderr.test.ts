import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManagedStdioStderr } from './managedStdioStderr.js';
import { ManagedStdioStderrEvent } from './managedStdioStderrEvent.js';

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

describe('ManagedStdioStderr', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('deduplicates contiguous lines and emits a repeat summary', async () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('noisy-server', { emit });
    const stream = new PassThrough();

    stderr.attach(stream);
    stream.write('same line\nsame line\nsame line\nnext line\n');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(emit).toHaveBeenNthCalledWith(
      1,
      ManagedStdioStderrEvent.Line,
      expect.objectContaining({ serverName: 'noisy-server', line: 'same line' }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      ManagedStdioStderrEvent.Repeated,
      expect.objectContaining({ serverName: 'noisy-server', repeatCount: 2 }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      3,
      ManagedStdioStderrEvent.Line,
      expect.objectContaining({ serverName: 'noisy-server', line: 'next line' }),
    );

    stderr.close();
  });

  it('yields to scheduled application work while draining a large stderr burst', async () => {
    const emittedLines: string[] = [];
    const stderr = new ManagedStdioStderr('noisy-server', {
      emit: (event, metadata) => {
        if (event === ManagedStdioStderrEvent.Line && metadata.line) {
          emittedLines.push(metadata.line);
        }
      },
      maxBytesPerTurn: 16,
      maxLinesPerWindow: 10_000,
    });
    const stream = new PassThrough();
    const burst = Array.from({ length: 100 }, (_, index) => `line-${index}`).join('\n') + '\n';

    stderr.attach(stream);
    stream.write(burst);

    expect(emittedLines).toEqual([]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(emittedLines.length).toBeGreaterThan(0);
    expect(emittedLines.length).toBeLessThan(100);

    stderr.close();
  });

  it('continues draining when an injected per-turn byte budget is zero', async () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('noisy-server', { emit, maxBytesPerTurn: 0 });
    const stream = new PassThrough();

    stderr.attach(stream);
    stream.write('still drains\n');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(emit).toHaveBeenCalledWith(
      ManagedStdioStderrEvent.Line,
      expect.objectContaining({ line: 'still drains' }),
    );
    stderr.close();
  });

  it('keeps a healthy MCP request responsive while another child floods managed stderr', async () => {
    const noisyProcess = spawn(process.execPath, [
      '-e',
      "const chunk = 'stderr flood\\n'.repeat(16384); const flood = () => { if (!process.stderr.write(chunk)) process.stderr.once('drain', flood); else setImmediate(flood); }; flood();",
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const noisyStderr = new ManagedStdioStderr('noisy-server', {
      emit: () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1),
      maxBytesPerTurn: 64,
      maxBufferedBytes: 1024,
      maxLinesPerWindow: 100_000,
    });
    const healthyTransport = new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), 'test/e2e/fixtures/echo-server.js')],
    });
    const healthyClient = new Client({ name: 'stderr-fairness-test', version: '1.0.0' });

    noisyStderr.attach(noisyProcess.stderr);
    const noisyStarted = once(noisyProcess.stderr!, 'data');

    try {
      await within(noisyStarted, 1_000);
      await within(healthyClient.connect(healthyTransport), 2_000);
      const result = await within(
        healthyClient.callTool({ name: 'echo', arguments: { message: 'still responsive' } }),
        500,
      );

      expect(result.content).toContainEqual(expect.objectContaining({ text: expect.stringContaining('still responsive') }));
    } finally {
      noisyStderr.close();
      await healthyTransport.close();
      const exited = once(noisyProcess, 'exit');
      noisyProcess.kill();
      await exited;
    }
  });

  it('backpressures only the noisy stderr stream and resumes it after draining', async () => {
    const noisy = new ManagedStdioStderr('noisy-server', {
      emit: vi.fn(),
      maxBytesPerTurn: 4,
      maxBufferedBytes: 8,
      maxLinesPerWindow: 10_000,
    });
    const healthyEmit = vi.fn();
    const healthy = new ManagedStdioStderr('healthy-server', { emit: healthyEmit });
    const noisyStream = new PassThrough();
    const healthyStream = new PassThrough();

    noisy.attach(noisyStream);
    healthy.attach(healthyStream);
    const noisyPause = vi.spyOn(noisyStream, 'pause');
    const noisyResume = vi.spyOn(noisyStream, 'resume');
    const healthyPause = vi.spyOn(healthyStream, 'pause');

    noisyStream.write('noise\n'.repeat(100));
    healthyStream.write('healthy\n');

    expect(noisyPause).toHaveBeenCalledOnce();
    expect(healthyPause).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(healthyEmit).toHaveBeenCalledWith(
      ManagedStdioStderrEvent.Line,
      expect.objectContaining({ serverName: 'healthy-server', line: 'healthy' }),
    );
    for (let turn = 0; turn < 200 && noisyResume.mock.calls.length === 0; turn++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(noisyResume).toHaveBeenCalledOnce();

    noisy.close();
    healthy.close();
  });

  it('cancels queued work and releases a paused stream on repeated close', async () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('closing-server', {
      emit,
      maxBytesPerTurn: 1,
      maxBufferedBytes: 1,
    });
    const stream = new PassThrough();

    stderr.attach(stream);
    const resume = vi.spyOn(stream, 'resume');
    stream.write('queued stderr\n');
    stderr.close();
    stderr.close();

    expect(stream.listenerCount('data')).toBe(0);
    expect(stream.listenerCount('end')).toBe(0);
    expect(stream.listenerCount('close')).toBe(0);
    expect(resume).toHaveBeenCalledOnce();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(emit).not.toHaveBeenCalled();
  });

  it('rate limits unique lines and emits a suppression summary', async () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('noisy-server', {
      emit,
      maxLinesPerWindow: 2,
      windowMs: 100,
    });
    const stream = new PassThrough();

    stderr.attach(stream);
    stream.write('one\ntwo\nthree\n');

    await vi.advanceTimersByTimeAsync(0);
    expect(emit).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(emit).toHaveBeenLastCalledWith(
      ManagedStdioStderrEvent.Suppressed,
      expect.objectContaining({ serverName: 'noisy-server', suppressedCount: 1 }),
    );

    stderr.close();
  });

  it('caps an individual line without buffering the discarded remainder', async () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('noisy-server', { emit, maxLineBytes: 8 });
    const stream = new PassThrough();

    stderr.attach(stream);
    stream.write('abcdefghijklmnop\n');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(emit).toHaveBeenCalledWith(
      ManagedStdioStderrEvent.Line,
      expect.objectContaining({ serverName: 'noisy-server', line: 'abcdefgh', truncated: true }),
    );

    stderr.close();
  });

  it('keeps deduplication state across replacement streams', async () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('restartable-server', { emit });
    const firstStream = new PassThrough();
    const secondStream = new PassThrough();

    stderr.attach(firstStream);
    firstStream.write('restart failure\nrestart failure\n');
    stderr.attach(secondStream);
    secondStream.write('restart failure\n');
    await new Promise<void>((resolve) => setImmediate(resolve));
    stderr.close();

    expect(emit).toHaveBeenCalledWith(
      ManagedStdioStderrEvent.Repeated,
      expect.objectContaining({ serverName: 'restartable-server', repeatCount: 2 }),
    );
  });
});
