import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import winston from 'winston';

import { writeLocalDiagnostic } from './localDiagnostics.js';
import logger, { writeLocalDiagnosticRecord } from './logger.js';

describe('bounded local investigation diagnostics', () => {
  let entries: Array<Record<string, unknown>>;
  beforeEach(() => {
    entries = [];
    logger.clear();
    logger.level = 'debug';
    logger.add(
      new winston.transports.Stream({
        stream: new Writable({
          objectMode: true,
          write(entry: Record<string, unknown>, _encoding, callback) {
            entries.push(entry);
            callback();
          },
        }),
      }),
    );
  });
  afterEach(() => {
    logger.clear();
    logger.level = 'info';
    vi.restoreAllMocks();
  });

  it('retains investigation facts and actual errors while redacting credentials and omitting trace context', () => {
    const cause = new Error('upstream unavailable');
    const error = Object.assign(new Error('GET https://user:pass@example.test/mcp?tenant=hidden#private'), {
      code: 'ECONNRESET',
      cause,
    });
    writeLocalDiagnostic('error', 'backend.connection-failed', {
      serverName: 'search',
      transport: 'stdio',
      attempt: 2,
      timeoutMs: 1000,
      error,
      args: { query: 'weather', authorization: 'Bearer hidden', password: 'hidden', sessionId: 'hidden' },
    });
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    const details = JSON.parse(entry.details as string);
    expect(entry).toMatchObject({ message: 'backend.connection-failed', source: 'local-diagnostic', level: 'error' });
    expect(details).toMatchObject({
      serverName: 'search',
      attempt: 2,
      error: {
        name: 'Error',
        errorCode: 'ECONNRESET',
        message: 'GET https://example.test/mcp',
        cause: { name: 'Error', message: 'upstream unavailable' },
      },
      args: { query: 'weather', authorization: '[REDACTED]', '[REDACTED]': '[REDACTED]', sessionId: '[REDACTED]' },
    });
    expect(details.error.stack).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain('hidden');
    expect(entry).not.toHaveProperty('traceId');
    expect(entry).not.toHaveProperty('spanId');
  });

  it('includes bounded data-property stacks only at debug, and strips header text and log controls', () => {
    const error = new Error('Authorization: Bearer hidden\nnext line');
    Object.defineProperty(error, 'stack', {
      value: 'Error: test\nat connect\nCookie: session=hidden',
      configurable: true,
    });
    writeLocalDiagnostic('debug', 'tool.failed', { error });
    const details = JSON.parse(entries[0].details as string);
    expect(details.error.message).toBe('[REDACTED HEADER]\\nnext line');
    expect(details.error.stack).toBe('Error: test\\nat connect\\n[REDACTED HEADER]');
    expect(JSON.stringify(entries)).not.toContain('hidden');
  });

  it('does not run disabled callbacks or caller getters, proxies, serialization hooks or accessor stacks', () => {
    const getter = vi.fn(() => {
      throw new Error('getter called');
    });
    const proxy = new Proxy({}, { ownKeys: getter, get: getter });
    const fields = Object.defineProperty({ proxy, toJSON: getter }, 'value', { get: getter });
    const error = Object.defineProperty(new Error('safe'), 'stack', { get: getter });
    writeLocalDiagnostic('debug', 'tool.completed', { fields, error });
    expect(getter).not.toHaveBeenCalled();
    logger.level = 'info';
    const callback = vi.fn(() => ({ args: fields }));
    writeLocalDiagnostic('debug', 'tool.arguments', callback);
    expect(callback).not.toHaveBeenCalled();
    expect(entries).toHaveLength(1);
  });

  it('bounds cycles, deep causes and oversized snapshots without retaining an unsafe prefix', () => {
    const cycle: Record<string, unknown> = { value: 'safe' };
    cycle.self = cycle;
    const error = new Error('failure');
    Object.assign(error, { cause: error });
    writeLocalDiagnostic('warn', 'config.reload-failed', { cycle, error });
    expect((entries[0].details as string).length).toBeLessThanOrEqual(8192);
    expect(entries[0].details).toContain('[TRUNCATED');
    writeLocalDiagnostic('debug', 'tool.result', { result: 'x'.repeat(9000) });
    expect(entries[1].details).toBe('[OMITTED: body exceeds 8192 bytes]');
  });

  it('rejects caller-forged sink records and fails open when instrumentation fails', () => {
    writeLocalDiagnosticRecord({ level: 'error', event: 'tool.failed', details: 'unsanitized' });
    expect(entries).toHaveLength(0);
    expect(() =>
      writeLocalDiagnostic('info', 'config.reload', () => {
        throw new Error('callback');
      }),
    ).not.toThrow();
    vi.spyOn(logger, 'isLevelEnabled').mockImplementation(() => {
      throw new Error('logger unavailable');
    });
    expect(() => writeLocalDiagnostic('info', 'config.reload', {})).not.toThrow();
  });
});
