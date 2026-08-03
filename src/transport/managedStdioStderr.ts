import { Stream } from 'node:stream';

import logger from '@src/logger/logger.js';

import { ManagedStdioStderrEvent } from './managedStdioStderrEvent.js';
import type { ManagedStdioStderrOptions } from './managedStdioStderrOptions.js';

const DEFAULT_MAX_LINE_BYTES = 8 * 1024;
const DEFAULT_MAX_LINES_PER_WINDOW = 20;
const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_REPEAT_SUMMARY_INTERVAL_MS = 5_000;
const DEFAULT_MAX_BYTES_PER_TURN = 16 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 64 * 1024;

interface QueuedChunk {
  readonly kind: 'chunk';
  readonly buffer: Buffer;
  offset: number;
}

interface QueueMarker {
  readonly kind: 'line-boundary' | 'stream-end';
}

type QueueEntry = QueuedChunk | QueueMarker;

/**
 * Drains one backend's stderr without allowing it to grow parent logs without bound.
 */
export class ManagedStdioStderr {
  private readonly emit: NonNullable<ManagedStdioStderrOptions['emit']>;
  private readonly maxLineBytes: number;
  private readonly maxLinesPerWindow: number;
  private readonly windowMs: number;
  private readonly repeatSummaryIntervalMs: number;
  private readonly maxBytesPerTurn: number;
  private readonly maxBufferedBytes: number;
  private stream: Stream | null = null;
  private pausedStream: Stream | null = null;
  private streamEnded = false;
  private queue: QueueEntry[] = [];
  private queuedBytes = 0;
  private drainImmediate: ReturnType<typeof setImmediate> | null = null;
  private closing = false;
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private resolveClose: (() => void) | null = null;
  private lineBuffer = Buffer.alloc(0);
  private lineTruncated = false;
  private lastLine: string | undefined;
  private repeatCount = 0;
  private suppressedCount = 0;
  private emittedInWindow = 0;
  private windowStartedAt: number | null = null;
  private repeatTimer: ReturnType<typeof setTimeout> | null = null;
  private windowTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly handleData = (chunk: unknown): void => {
    if (this.closing || this.closed) {
      return;
    }

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    if (buffer.length > 0) {
      this.queue.push({ kind: 'chunk', buffer, offset: 0 });
      this.queuedBytes += buffer.length;
      this.applyBackpressure();
      this.scheduleDrain();
    }
  };

  private readonly handleStreamEnd = (): void => {
    if (this.closed || this.streamEnded) {
      return;
    }

    this.streamEnded = true;
    this.queue.push({ kind: 'stream-end' });
    this.scheduleDrain();
  };

  constructor(
    private readonly serverName: string,
    options: ManagedStdioStderrOptions = {},
  ) {
    this.emit =
      options.emit ??
      ((message, metadata) => {
        logger.warn(message, metadata);
      });
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.maxLinesPerWindow = options.maxLinesPerWindow ?? DEFAULT_MAX_LINES_PER_WINDOW;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.repeatSummaryIntervalMs = options.repeatSummaryIntervalMs ?? DEFAULT_REPEAT_SUMMARY_INTERVAL_MS;
    this.maxBytesPerTurn =
      options.maxBytesPerTurn !== undefined && options.maxBytesPerTurn > 0
        ? options.maxBytesPerTurn
        : DEFAULT_MAX_BYTES_PER_TURN;
    this.maxBufferedBytes =
      options.maxBufferedBytes !== undefined && options.maxBufferedBytes > 0
        ? options.maxBufferedBytes
        : DEFAULT_MAX_BUFFERED_BYTES;
  }

  public attach(stream: Stream | null | undefined): void {
    if (this.closing || this.closed || stream === this.stream) {
      return;
    }

    const shouldFinishPreviousLine = this.stream !== null && !this.streamEnded;
    this.detachStream();
    if (shouldFinishPreviousLine) {
      this.queue.push({ kind: 'line-boundary' });
    }
    this.stream = stream ?? null;
    this.streamEnded = false;
    this.stream?.on('data', this.handleData);
    this.stream?.on('end', this.handleStreamEnd);
    this.stream?.on('close', this.handleStreamEnd);
    this.applyBackpressure();
    if (this.queue.length > 0) {
      this.scheduleDrain();
    }
  }

  public close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closing = true;
    this.detachStream();
    this.closePromise = new Promise<void>((resolve) => {
      this.resolveClose = resolve;
    });

    if (this.queue.length > 0) {
      this.scheduleDrain();
    } else {
      this.completeClose();
    }

    return this.closePromise;
  }

  private completeClose(): void {
    this.closed = true;
    this.flushPendingLine();
    this.flushRepeatSummary();
    this.flushSuppressionSummary();
    this.clearTimer('repeat');
    this.clearTimer('window');
    this.resolveClose?.();
    this.resolveClose = null;
  }

  private scheduleDrain(): void {
    if (this.closed || this.drainImmediate || this.queue.length === 0) {
      return;
    }

    this.drainImmediate = setImmediate(() => {
      this.drainImmediate = null;
      this.drainTurn();
    });
  }

  private drainTurn(): void {
    let remainingBudget = this.maxBytesPerTurn;

    while (remainingBudget > 0 && this.queue.length > 0) {
      const entry = this.queue[0];
      if (entry.kind !== 'chunk') {
        this.queue.shift();
        this.flushPendingLine();
        if (entry.kind === 'stream-end') {
          this.flushRepeatSummary();
        }
        remainingBudget--;
        continue;
      }

      const available = entry.buffer.length - entry.offset;
      const consumed = Math.min(available, remainingBudget);
      this.consumeChunk(entry.buffer.subarray(entry.offset, entry.offset + consumed));
      entry.offset += consumed;
      this.queuedBytes -= consumed;
      remainingBudget -= consumed;
      if (entry.offset === entry.buffer.length) {
        this.queue.shift();
      }
    }

    this.releaseBackpressure();
    if (this.queue.length > 0) {
      this.scheduleDrain();
    } else if (this.closing) {
      this.completeClose();
    }
  }

  private applyBackpressure(): void {
    if (this.queuedBytes < this.maxBufferedBytes || this.pausedStream === this.stream) {
      return;
    }

    const pausable = this.stream as (Stream & { pause?: () => unknown }) | null;
    if (pausable?.pause) {
      pausable.pause();
      this.pausedStream = this.stream;
    }
  }

  private releaseBackpressure(): void {
    if (!this.pausedStream || this.queuedBytes >= this.maxBufferedBytes) {
      return;
    }

    const resumable = this.pausedStream as Stream & { resume?: () => unknown };
    this.pausedStream = null;
    resumable.resume?.();
  }

  private consumeChunk(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      const newlineIndex = chunk.indexOf(0x0a, offset);
      const segmentEnd = newlineIndex === -1 ? chunk.length : newlineIndex;
      this.appendSegment(chunk.subarray(offset, segmentEnd));

      if (newlineIndex === -1) {
        return;
      }

      this.flushPendingLine();
      offset = newlineIndex + 1;
    }
  }

  private appendSegment(segment: Buffer): void {
    if (this.lineTruncated || segment.length === 0) {
      return;
    }

    const remainingBytes = this.maxLineBytes - this.lineBuffer.length;
    if (remainingBytes <= 0) {
      this.lineTruncated = true;
      return;
    }

    const accepted = segment.subarray(0, remainingBytes);
    this.lineBuffer = Buffer.concat([this.lineBuffer, accepted], this.lineBuffer.length + accepted.length);
    if (accepted.length < segment.length) {
      this.lineTruncated = true;
    }
  }

  private flushPendingLine(): void {
    if (this.lineBuffer.length === 0 && !this.lineTruncated) {
      return;
    }

    const line = this.lineBuffer.toString('utf8').replace(/\r$/, '');
    const truncated = this.lineTruncated;
    this.lineBuffer = Buffer.alloc(0);
    this.lineTruncated = false;
    this.processLine(line, truncated);
  }

  private processLine(line: string, truncated: boolean): void {
    if (line === this.lastLine) {
      this.repeatCount++;
      this.ensureRepeatTimer();
      return;
    }

    this.flushRepeatSummary();
    this.lastLine = line;
    this.ensureRateWindow();

    if (this.emittedInWindow >= this.maxLinesPerWindow) {
      this.suppressedCount++;
      return;
    }

    this.emittedInWindow++;
    this.emit(ManagedStdioStderrEvent.Line, {
      serverName: this.serverName,
      source: 'backend-stderr',
      line,
      ...(truncated ? { truncated: true } : {}),
    });
  }

  private ensureRateWindow(): void {
    const now = Date.now();
    if (this.windowStartedAt !== null && now - this.windowStartedAt < this.windowMs) {
      return;
    }

    this.flushSuppressionSummary();
    this.windowStartedAt = now;
    this.emittedInWindow = 0;
    this.clearTimer('window');
    this.windowTimer = setTimeout(() => {
      this.windowTimer = null;
      this.flushSuppressionSummary();
      this.windowStartedAt = null;
      this.emittedInWindow = 0;
    }, this.windowMs);
    this.unrefTimer(this.windowTimer);
  }

  private ensureRepeatTimer(): void {
    if (this.repeatTimer) {
      return;
    }

    this.repeatTimer = setTimeout(() => {
      this.repeatTimer = null;
      this.flushRepeatSummary();
    }, this.repeatSummaryIntervalMs);
    this.unrefTimer(this.repeatTimer);
  }

  private flushRepeatSummary(): void {
    if (this.repeatCount === 0) {
      return;
    }

    this.emit(ManagedStdioStderrEvent.Repeated, {
      serverName: this.serverName,
      source: 'backend-stderr',
      repeatCount: this.repeatCount,
    });
    this.repeatCount = 0;
    this.clearTimer('repeat');
  }

  private flushSuppressionSummary(): void {
    if (this.suppressedCount === 0) {
      return;
    }

    this.emit(ManagedStdioStderrEvent.Suppressed, {
      serverName: this.serverName,
      source: 'backend-stderr',
      suppressedCount: this.suppressedCount,
    });
    this.suppressedCount = 0;
  }

  private detachStream(): void {
    this.stream?.off('data', this.handleData);
    this.stream?.off('end', this.handleStreamEnd);
    this.stream?.off('close', this.handleStreamEnd);
    if (this.pausedStream && this.pausedStream === this.stream) {
      const resumable = this.pausedStream as Stream & { resume?: () => unknown };
      this.pausedStream = null;
      resumable.resume?.();
    }
    this.stream = null;
  }

  private clearTimer(timer: 'repeat' | 'window'): void {
    const timeout = timer === 'repeat' ? this.repeatTimer : this.windowTimer;
    if (timeout) {
      clearTimeout(timeout);
    }
    if (timer === 'repeat') {
      this.repeatTimer = null;
    } else {
      this.windowTimer = null;
    }
  }

  private unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }
  }
}
