import { Stream } from 'node:stream';

import logger from '@src/logger/logger.js';

import { ManagedStdioStderrEvent } from './managedStdioStderrEvent.js';
import type { ManagedStdioStderrOptions } from './managedStdioStderrOptions.js';

const DEFAULT_MAX_LINE_BYTES = 8 * 1024;
const DEFAULT_MAX_LINES_PER_WINDOW = 20;
const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_REPEAT_SUMMARY_INTERVAL_MS = 5_000;

/**
 * Drains one backend's stderr without allowing it to grow parent logs without bound.
 */
export class ManagedStdioStderr {
  private readonly emit: NonNullable<ManagedStdioStderrOptions['emit']>;
  private readonly maxLineBytes: number;
  private readonly maxLinesPerWindow: number;
  private readonly windowMs: number;
  private readonly repeatSummaryIntervalMs: number;
  private stream: Stream | null = null;
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
    this.consumeChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  };

  private readonly handleStreamEnd = (): void => {
    this.flushPendingLine();
    this.flushRepeatSummary();
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
  }

  public attach(stream: Stream | null | undefined): void {
    if (stream === this.stream) {
      return;
    }

    this.detachStream();
    this.flushPendingLine();
    this.stream = stream ?? null;
    this.stream?.on('data', this.handleData);
    this.stream?.on('end', this.handleStreamEnd);
    this.stream?.on('close', this.handleStreamEnd);
  }

  public close(): void {
    this.detachStream();
    this.flushPendingLine();
    this.flushRepeatSummary();
    this.flushSuppressionSummary();
    this.clearTimer('repeat');
    this.clearTimer('window');
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
