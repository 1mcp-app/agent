import { Writable } from 'node:stream';

import { activateRuntimeScopeEnvironment } from '@src/config/runtimeScopeEnv.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import winston from 'winston';

import { sanitizeHttpBody } from './httpDiagnostics.js';
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
    activateRuntimeScopeEnvironment({});
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

  it('redacts session identifiers in upstream error prose and credentials in non-HTTP URLs', () => {
    writeLocalDiagnostic('error', 'backend.session-lost', {
      error: new Error(
        "Could not find session ID 'opaque-session-value'; redis://user:password@host.test/db?auth=opaque-query",
      ),
    });
    const details = JSON.parse(entries[0].details as string);
    expect(details.error.message).toContain('Could not find [REDACTED IDENTIFIER]');
    expect(details.error.message).toContain('redis://host.test/db');
    expect(JSON.stringify(entries)).not.toMatch(/opaque-session-value|password|opaque-query/);
    writeLocalDiagnostic('warn', 'oauth.failed', {
      error: new Error('Unknown Mcp-Session-Id header: opaque-header; authorization code opaque-code has expired'),
    });
    expect(JSON.stringify(entries)).not.toMatch(/opaque-header|opaque-code/);
    writeLocalDiagnostic('error', 'backend.failed', {
      error: Object.assign(new Error('safe'), {
        code: 'redis://bob:opaque-code-password@host.test/db?auth=opaque-code-query',
      }),
    });
    expect(JSON.parse(entries[2].details as string).error.errorCode).toBe('redis://host.test/db');
    expect(JSON.stringify(entries)).not.toMatch(/opaque-code-password|opaque-code-query/);
    writeLocalDiagnostic('error', 'backend.failed', {
      error: new Error('Failed to connect to client search:opaque-session-value: timed out'),
    });
    expect(JSON.stringify(entries)).not.toContain('opaque-session-value');
    writeLocalDiagnostic('error', 'backend.failed', {
      error: new Error('Failed to connect to client 搜索 工具:opaque-unicode-session: timed out'),
    });
    expect(JSON.stringify(entries)).not.toContain('opaque-unicode-session');
    writeLocalDiagnostic('error', 'backend.failed', {
      error: Object.assign(new Error('Failed to connect to client search: timed out'), {
        data: { cause: new Error("Client '搜索 工具:opaque-quoted-session' not found") },
      }),
    });
    const last = JSON.parse(entries.at(-1)?.details as string);
    expect(last.error.message).toBe('Failed to connect to client search: timed out');
    expect(last.error.cause.message).toContain('not found');
    expect(JSON.stringify(entries)).not.toContain('opaque-quoted-session');
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

  it('redacts opaque active Runtime Scope values in errors, causes, codes, payloads and field names', () => {
    activateRuntimeScopeEnvironment({ API_KEY: 'opaque-scope-value' });
    writeLocalDiagnostic('error', 'backend.failed', {
      error: Object.assign(new Error('endpoint refused opaque-scope-value'), {
        cause: new Error('opaque-scope-value unavailable'),
        code: 'opaque-scope-value',
      }),
    });
    writeLocalDiagnostic('debug', 'tool.arguments', {
      arguments: { 'opaque-scope-value': 'value', query: 'opaque-scope-value' },
    });
    expect(JSON.stringify(entries)).not.toContain('opaque-scope-value');
    expect(JSON.stringify(entries)).toContain('[REDACTED]');
    expect(sanitizeHttpBody({ query: 'opaque-scope-value' })).not.toContain('opaque-scope-value');
  });
});
