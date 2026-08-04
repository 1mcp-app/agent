import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManagedStdioStderr } from './managedStdioStderr.js';
import { ManagedStdioStderrEvent } from './managedStdioStderrEvent.js';

describe('ManagedStdioStderr', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('deduplicates contiguous lines and emits a repeat summary', async () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('noisy-server', { emit, maxBytesPerTurn: 8 });
    const stream = new PassThrough();

    stderr.attach(stream);
    stream.write('same line\nsame line\nsame line\nnext line\n');
    await stderr.close();

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

    await stderr.close();
  });

  it('falls back to the default per-turn byte budget when the injected budget is zero', async () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('noisy-server', { emit, maxBytesPerTurn: 0 });
    const stream = new PassThrough();

    stderr.attach(stream);
    stream.write('still drains\n');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(emit).toHaveBeenCalledWith(ManagedStdioStderrEvent.Line, expect.objectContaining({ line: 'still drains' }));
    await stderr.close();
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
    for (let turn = 0; turn < 1_000 && noisyResume.mock.calls.length === 0; turn++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(noisyResume).toHaveBeenCalledOnce();

    await noisy.close();
    await healthy.close();
  });

  it('drains queued work and releases a paused stream on repeated close', async () => {
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
    const firstClose = stderr.close();
    const repeatedClose = stderr.close();
    expect(repeatedClose).toBe(firstClose);
    await firstClose;

    expect(stream.listenerCount('data')).toBe(0);
    expect(stream.listenerCount('end')).toBe(0);
    expect(stream.listenerCount('close')).toBe(0);
    expect(resume).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(
      ManagedStdioStderrEvent.Line,
      expect.objectContaining({ serverName: 'closing-server', line: 'queued stderr' }),
    );
    const emittedOnClose = emit.mock.calls.length;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(emit).toHaveBeenCalledTimes(emittedOnClose);
  });

  it('rate limits unique lines and emits a suppression summary', async () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('noisy-server', {
      emit,
      maxBytesPerTurn: 4,
      maxLinesPerWindow: 2,
      windowMs: 100,
    });
    const stream = new PassThrough();

    stderr.attach(stream);
    stream.write('one\ntwo\nthree\n');

    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(3));
    expect(emit).toHaveBeenLastCalledWith(
      ManagedStdioStderrEvent.Suppressed,
      expect.objectContaining({ serverName: 'noisy-server', suppressedCount: 1 }),
    );

    await stderr.close();
  });

  it('caps an individual line without buffering the discarded remainder', async () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('noisy-server', { emit, maxLineBytes: 8, maxBytesPerTurn: 4 });
    const stream = new PassThrough();

    stderr.attach(stream);
    stream.write('abcdefghijklmnop\n');
    await stderr.close();

    expect(emit).toHaveBeenCalledWith(
      ManagedStdioStderrEvent.Line,
      expect.objectContaining({ serverName: 'noisy-server', line: 'abcdefgh', truncated: true }),
    );
  });

  it('keeps deduplication state across replacement streams', async () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('restartable-server', { emit, maxBytesPerTurn: 8 });
    const firstStream = new PassThrough();
    const secondStream = new PassThrough();

    stderr.attach(firstStream);
    firstStream.write('restart failure\nrestart failure\n');
    stderr.attach(secondStream);
    secondStream.write('restart failure\n');
    await stderr.close();

    expect(emit).toHaveBeenCalledWith(
      ManagedStdioStderrEvent.Repeated,
      expect.objectContaining({ serverName: 'restartable-server', repeatCount: 2 }),
    );
  });
});
