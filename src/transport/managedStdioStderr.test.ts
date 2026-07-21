import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManagedStdioStderr } from './managedStdioStderr.js';
import { ManagedStdioStderrEvent } from './managedStdioStderrEvent.js';

describe('ManagedStdioStderr', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('deduplicates contiguous lines and emits a repeat summary', () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('noisy-server', { emit });
    const stream = new PassThrough();

    stderr.attach(stream);
    stream.write('same line\nsame line\nsame line\nnext line\n');

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

    expect(emit).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(emit).toHaveBeenLastCalledWith(
      ManagedStdioStderrEvent.Suppressed,
      expect.objectContaining({ serverName: 'noisy-server', suppressedCount: 1 }),
    );

    stderr.close();
  });

  it('caps an individual line without buffering the discarded remainder', () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('noisy-server', { emit, maxLineBytes: 8 });
    const stream = new PassThrough();

    stderr.attach(stream);
    stream.write('abcdefghijklmnop\n');

    expect(emit).toHaveBeenCalledWith(
      ManagedStdioStderrEvent.Line,
      expect.objectContaining({ serverName: 'noisy-server', line: 'abcdefgh', truncated: true }),
    );

    stderr.close();
  });

  it('keeps deduplication state across replacement streams', () => {
    const emit = vi.fn();
    const stderr = new ManagedStdioStderr('restartable-server', { emit });
    const firstStream = new PassThrough();
    const secondStream = new PassThrough();

    stderr.attach(firstStream);
    firstStream.write('restart failure\nrestart failure\n');
    stderr.attach(secondStream);
    secondStream.write('restart failure\n');
    stderr.close();

    expect(emit).toHaveBeenCalledWith(
      ManagedStdioStderrEvent.Repeated,
      expect.objectContaining({ serverName: 'restartable-server', repeatCount: 2 }),
    );
  });
});
