import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileStorageService } from '@src/auth/storage/fileStorageService.js';
import { SessionRepository } from '@src/auth/storage/sessionRepository.js';
import { LoadingState, LoadingStateTracker } from '@src/core/loading/loadingStateTracker.js';
import { writeBackgroundLaunchConfig } from '@src/core/server/backgroundLaunchConfig.js';
import { writeBackgroundSupervisorState } from '@src/core/server/backgroundRuntimeSupervisorState.js';
import { BackendLogBroker } from '@src/domains/backend-logs/backendLogBroker.js';
import { createBackendLogProjection } from '@src/domains/backend-logs/backendLogProjection.js';
import { staticBackendLogSource } from '@src/domains/backend-logs/backendLogSource.js';
import {
  createGatewayFailure,
  gatewayFailureToMcp,
  gatewayFailureToProblem,
  gatewayFailureToToolResult,
} from '@src/gateway/contracts/gatewayFailure.js';
import { toImmutableJsonValue } from '@src/gateway/contracts/immutableJson.js';
import { appendSupervisorEvent } from '@src/logger/backgroundSupervisorLogger.js';
import logger, { configureLogger, errorIf, writeBackendDiagnostic } from '@src/logger/logger.js';
import { enhanceServerWithLogging } from '@src/logger/mcpLoggingEnhancer.js';
import { sanitizeForLogging } from '@src/logger/secureLogger.js';
import { httpRequestLogger } from '@src/transport/http/middlewares/httpRequestLogger.js';
import { ManagedStdioStderrEvent } from '@src/transport/managedStdioStderrEvent.js';

import { transformSync } from 'esbuild';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  boundedDescription,
  errorFacts,
  MAX_EVENT_BYTES,
  MAX_EVENT_FIELDS,
  normalizeField,
  ownData,
  privateFingerprint,
} from '../privacy/fields.js';
import { withMcpTraceContext } from '../tracing/context.js';
import { normalizeEvent } from './normalize.js';
import { EVENT_REGISTRY, type EventName } from './registry.js';

const forbidden = [
  'credential-CANARY-3ad912',
  'authorization-code-CANARY-7bcb01',
  'oauth-state-CANARY-03ca81',
  'pkce-verifier-CANARY-ac2013',
  'token-CANARY-593ecd',
  'exporter-secret-CANARY-dd104a',
  'body-CANARY-d3315c',
  'argument-CANARY-bdba00',
  'result-CANARY-e891ff',
  'prompt-CANARY-da81ab',
  'schema-CANARY-ef08d3',
  'content-CANARY-cf8190',
  'https://uri-CANARY-810ccf.invalid/',
  '/path-CANARY-590012/private',
  '203.0.113.173',
  'header-CANARY-749bc0',
  '00-1234567890abcdef1234567890abcdef-abcdef1234567890-01',
  'identity-CANARY-ffaa32',
  'error-message-CANARY-001122',
  'error-stack-CANARY-223344',
  'nested-cause-CANARY-778899',
];
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  configureLogger({ transport: 'stdio' });
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('typed local instrumentation privacy', () => {
  it('adds exactly three standard correlation fields only while valid operation context is active', async () => {
    const carrier = '00-1234567890abcdef1234567890abcdef-abcdef1234567890-01';
    expect(normalizeEvent('runtime.cli-failed')).not.toHaveProperty('trace_id');
    await withMcpTraceContext({ _meta: { traceparent: carrier, baggage: forbidden[0] } }, async () => {
      await Promise.resolve();
      expect(normalizeEvent('runtime.cli-failed')).toEqual({
        event: 'runtime.cli-failed',
        message: 'CLI execution failed',
        trace_id: '1234567890abcdef1234567890abcdef',
        span_id: 'abcdef1234567890',
        trace_flags: '01',
      });
    });
    expect(normalizeEvent('runtime.cli-failed')).not.toHaveProperty('trace_id');
    await withMcpTraceContext({ _meta: { traceparent: 'invalid', baggage: forbidden[0] } }, async () => {
      expect(normalizeEvent('runtime.cli-failed')).not.toHaveProperty('trace_id');
    });
  });
  it('rejects unknown messages, keeps registry constants immutable, and discards unknown fields', () => {
    expect(normalizeEvent(forbidden[0], { error: forbidden[1] })).toBeUndefined();
    const result = normalizeEvent('runtime.cli-failed', {
      error: { kind: 'transport', code: 'ECONNRESET', message: forbidden[0], cause: forbidden[1] },
      unknown: forbidden[2],
    });
    expect(result).toEqual({
      event: 'runtime.cli-failed',
      message: 'CLI execution failed',
      error_kind: 'transport',
      error_code: 'ECONNRESET',
    });
    expect(Object.isFrozen(EVENT_REGISTRY)).toBe(true);
    // @ts-expect-error Empty event schemas reject arbitrary metadata at compile time too.
    logger.info('logger.deprecated-level', { secret: forbidden[0] });
    // @ts-expect-error Numeric event facts cannot receive request text.
    logger.info('supervisor.runtime-ready', { runtimePid: forbidden[0] });
    for (const definition of Object.values(EVENT_REGISTRY)) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.fields)).toBe(true);
    }
  });

  it('retains bounded process acquisition facts and rejects arbitrary diagnostic text', () => {
    expect(
      normalizeEvent('processIdentity.acquisition-failed', {
        platform: 'win32',
        pid: 123,
        elapsedMs: 3000,
        code: 'ETIMEDOUT',
        message: forbidden[0],
        stderr: forbidden[1],
      }),
    ).toEqual({
      event: 'processIdentity.acquisition-failed',
      message: 'Process birth evidence acquisition failed',
      platform: 'win32',
      pid: 123,
      elapsedMs: 3000,
      code: 'ETIMEDOUT',
    });
    expect(
      normalizeEvent('processIdentity.acquisition-failed', { platform: forbidden[0], code: forbidden[1] }),
    ).toMatchObject({ platform: 'other', code: 'other' });
  });

  it('preserves protocol stdout when the actual file logger runs in stdio mode', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stdio-local-logs-'));
    directories.push(directory);
    const logFile = path.join(directory, 'runtime.log');
    const output: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    });
    configureLogger({ logFile, transport: 'stdio' });
    logger.info('runtime.cli-failed', { error: new Error(forbidden[0]) });
    await vi.waitFor(() => expect(fs.readFileSync(logFile, 'utf8')).toContain('CLI execution failed'));
    stdout.mockRestore();
    expect(output).toEqual([]);
    expect(fs.readFileSync(logFile, 'utf8')).not.toContain(forbidden[0]);
  });

  it('does not invoke getters, proxy traps, coercions, or cyclic error causes', () => {
    const trap = vi.fn(() => {
      throw new Error(forbidden[0]);
    });
    const proxy = new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, ownKeys: trap });
    const error = { message: forbidden[0], stack: forbidden[1], cause: undefined as unknown, toString: trap };
    error.cause = error;
    const getter = Object.defineProperty({}, 'error', { get: trap });
    for (const input of [getter, proxy, null, undefined, 123, { error }, { error: proxy }]) {
      expect(() => normalizeEvent('runtime.cli-failed', input)).not.toThrow();
    }
    expect(ownData(proxy, 'message')).toBeUndefined();
    expect(normalizeField('methods', new Proxy([], { get: trap }))).toBeUndefined();
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expect(() => normalizeField('methods', revoked.proxy)).not.toThrow();
    expect(normalizeField('methods', revoked.proxy)).toBeUndefined();
    expect(errorFacts(proxy)).toEqual({ error_kind: 'other', error_code: 'other' });
    expect(trap).not.toHaveBeenCalled();
  });

  it('uses closed gateway failure facts and never keeps arbitrary codes or error text', () => {
    expect(
      errorFacts({
        kind: 'deadline-exceeded',
        code: 'schema_evaluation_timeout',
        message: forbidden[0],
        data: forbidden[1],
      }),
    ).toEqual({ error_kind: 'deadline-exceeded', error_code: 'schema_evaluation_timeout' });
    expect(errorFacts({ kind: forbidden[0], code: forbidden[1] })).toEqual({
      error_kind: 'other',
      error_code: 'other',
    });
    expect(errorFacts({ code: -32602 })).toEqual({ error_kind: 'other', error_code: '-32602' });
  });

  it('bounds Unicode, numeric values, vocabulary arrays, fields, and complete events', () => {
    for (const text of ['界'.repeat(1000), '😀'.repeat(1000), 'a'.repeat(1000)]) {
      const bounded = boundedDescription(text);
      expect(Buffer.byteLength(bounded)).toBeLessThanOrEqual(256);
      expect(bounded.endsWith(' [truncated]')).toBe(true);
      expect(bounded).not.toContain('\ufffd');
    }
    expect(normalizeField('methods', ['tools/call', forbidden[0], ...Array(100).fill('ping')])).toEqual([
      'tools/call',
      'other',
      ...Array(14).fill('ping'),
    ]);
    for (const number of [NaN, Infinity, Number.MAX_VALUE]) expect(normalizeField('number', number)).toBeUndefined();
    for (const event of Object.keys(EVENT_REGISTRY) as EventName[]) {
      const result = normalizeEvent(event);
      expect(result).toBeDefined();
      expect(Object.keys(result!).length).toBeLessThanOrEqual(MAX_EVENT_FIELDS);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(MAX_EVENT_BYTES);
    }
  });

  it('separates private identity types and rotates the cryptorandom key between processes', () => {
    const value = forbidden[0];
    expect(privateFingerprint('server', value)).toMatch(/^[a-f0-9]{32}$/);
    expect(privateFingerprint('server', value)).toBe(privateFingerprint('server', value));
    expect(
      new Set(['server', 'session', 'request', 'client'].map((type) => privateFingerprint(type as 'server', value)))
        .size,
    ).toBe(4);
    expect(privateFingerprint('server', 'a'.repeat(4097))).toBeUndefined();
    const source = fs.readFileSync(path.join(import.meta.dirname, '../privacy/fields.ts'), 'utf8');
    const code = transformSync(source, { loader: 'ts', format: 'esm' }).code;
    const run = () =>
      execFileSync(
        process.execPath,
        ['--input-type=module', '-e', `${code}\nconsole.log(privateFingerprint('server', 'rotation-fixture'));`],
        { encoding: 'utf8' },
      ).trim();
    expect(run()).not.toBe(run());
  });

  it('captures real console and file transports for every registered event and adversarial corpus', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'typed-local-logs-'));
    directories.push(directory);
    const logFile = path.join(directory, 'runtime.log');
    const consoleOutput: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      consoleOutput.push(String(chunk));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      consoleOutput.push(String(chunk));
      return true;
    });
    configureLogger({ logLevel: 'debug', logFile, transport: 'http' });
    const allSecrets = forbidden.join(' ');
    const nestedError = {
      name: allSecrets,
      code: allSecrets,
      message: allSecrets,
      stack: allSecrets,
      cause: { payload: allSecrets },
    };
    for (const [event, definition] of Object.entries(EVENT_REGISTRY)) {
      const fields: Record<string, unknown> = { unknown: allSecrets, headers: allSecrets, traceparent: allSecrets };
      for (const [key, rule] of Object.entries(definition.fields))
        fields[key] = rule === 'error' ? nestedError : allSecrets;
      logger.info(event as EventName, fields);
    }
    const storage = new FileStorageService(directory);
    try {
      new SessionRepository(storage).create(forbidden[0], forbidden[12], [forbidden[5]], 60_000);
    } finally {
      storage.shutdown();
    }
    const tracker = new LoadingStateTracker();
    tracker.startLoading([forbidden[17]]);
    tracker.updateServerState(forbidden[17], LoadingState.AwaitingOAuth, {
      authorizationUrl: forbidden[12],
      error: new Error(allSecrets),
    });
    tracker.updateServerState(forbidden[17], LoadingState.Failed, { error: new Error(allSecrets) });
    tracker.reset();
    const notification = {
      method: 'notifications/message',
      params: {
        payload: allSecrets,
        self: undefined as unknown,
        toJSON: () => {
          throw new Error(allSecrets);
        },
      },
    };
    notification.params.self = notification.params;
    const forward = vi.fn().mockResolvedValue(undefined);
    const server = {
      setRequestHandler: vi.fn(),
      setNotificationHandler: vi.fn(),
      notification: forward,
      transport: {},
    };
    enhanceServerWithLogging(server as never);
    await server.notification(notification);
    expect(forward).toHaveBeenCalledWith(notification);
    sanitizeForLogging(
      Object.defineProperty({}, 'value', {
        enumerable: true,
        get: () => {
          throw new Error(allSecrets);
        },
      }),
    );
    errorIf(() => {
      throw new Error(allSecrets);
    });
    // @ts-expect-error Deliberately exercise untyped caller input at the runtime boundary.
    logger.info(forbidden[0] as EventName, { unknown: allSecrets });
    await vi.waitFor(() => expect(fs.readFileSync(logFile, 'utf8')).toContain('Conditional logging callback failed'));
    stdout.mockRestore();
    stderr.mockRestore();
    const output = consoleOutput.join('') + fs.readFileSync(logFile, 'utf8');
    for (const value of forbidden) expect(output).not.toContain(value);
    expect(output).not.toContain('"unknown"');
    expect(output).not.toContain('traceparent');
    expect(output).toContain('runtime.cli-failed');
    expect(output).toContain('fingerprint');
    expect(output).toContain('sessionRepository.created.session.for.client');
    expect(output).toContain('loadingStateTracker.server.state.changed');
    expect(output).toContain('mcpLoggingEnhancer.mcp.notification');
    for (const line of fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean))
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
  });

  it('captures actual supervisor append output without nested exits or source messages', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-local-logs-'));
    directories.push(directory);
    const logFile = path.join(directory, 'supervisor.log');
    appendSupervisorEvent(logFile, {
      at: forbidden[0],
      event: 'runtime-exit',
      supervisorPid: 123,
      runtimePid: 456,
      exit: { at: forbidden[1], code: 1, signal: forbidden[2], error: forbidden.join(' ') },
    });
    const output = fs.readFileSync(logFile, 'utf8');
    if (process.platform !== 'win32') expect(fs.statSync(logFile).mode & 0o777).toBe(0o600);
    expect(JSON.parse(output)).toEqual({
      event: 'supervisor.runtime-exit',
      message: 'Background supervisor runtime-exit',
      supervisorPid: 123,
      runtimePid: 456,
      exitCode: 1,
      error_kind: 'other',
      error_code: 'other',
    });
    for (const value of forbidden) expect(output).not.toContain(value);
  });

  it('keeps a simultaneously logged fingerprint out of persisted config/state/credentials and public projections', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fingerprint-destinations-'));
    directories.push(directory);
    const logFile = path.join(directory, 'local.log');
    configureLogger({ logLevel: 'debug', logFile, transport: 'stdio' });
    const value = forbidden[17];
    const fingerprint = privateFingerprint('session', value)!;
    logger.info('template-context.audit', { sessionId: value });
    const configPath = writeBackgroundLaunchConfig(directory, 'fixture-claim', { transport: 'stdio' });
    const state = {
      version: 1 as const,
      status: 'running' as const,
      supervisorPid: 123,
      runtimePid: 456,
      restartAttempt: 0,
      lastExit: null,
      nextRetryAt: null,
      readyAt: null,
      updatedAt: new Date().toISOString(),
    };
    writeBackgroundSupervisorState(directory, state);
    const storage = new FileStorageService(directory);
    try {
      new SessionRepository(storage).create(value, 'fixture://resource', ['fixture-scope'], 60_000);
    } finally {
      storage.shutdown();
    }
    const failure = createGatewayFailure({
      kind: 'transport',
      code: 'gateway_target_unavailable',
      message: 'Gateway unavailable',
    });
    const publicResults = [
      gatewayFailureToMcp(failure),
      gatewayFailureToProblem(failure),
      gatewayFailureToToolResult(failure),
      toImmutableJsonValue({ contents: [{ uri: 'fixture://resource', text: 'resource-result' }] }),
    ];
    const retained = [
      fs.readFileSync(configPath, 'utf8'),
      fs.readFileSync(path.join(directory, 'background-runtime.json'), 'utf8'),
      JSON.stringify(publicResults),
    ];
    const readFiles = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) readFiles(file);
        else if (file !== logFile) retained.push(fs.readFileSync(file, 'utf8'));
      }
    };
    readFiles(directory);
    for (const output of retained) {
      expect(output).not.toContain(fingerprint);
      expect(output).not.toContain('_fingerprint');
    }
    await withMcpTraceContext(
      { _meta: { traceparent: '00-1234567890abcdef1234567890abcdef-abcdef1234567890-01' } },
      async () => {
        const { getActiveTraceCorrelation, injectTraceContext } = await import('../tracing/context.js');
        logger.info('template-context.audit', { sessionId: value });
        expect(JSON.stringify(getActiveTraceCorrelation())).not.toContain(fingerprint);
        expect(JSON.stringify(injectTraceContext({}))).not.toContain(fingerprint);
      },
    );
    await vi.waitFor(() => expect(fs.readFileSync(logFile, 'utf8')).toContain(fingerprint));
  });

  it('does not inspect HTTP bodies, headers, addresses, or paths to instrument the request', async () => {
    const trap = vi.fn(() => {
      throw new Error(forbidden[0]);
    });
    const request = Object.create(null);
    for (const key of ['path', 'headers', 'body', 'query', 'ip']) Object.defineProperty(request, key, { get: trap });
    request.method = 'POST';
    const response = { statusCode: 200, end: vi.fn().mockReturnThis() };
    const next = vi.fn();
    expect(() => httpRequestLogger(request as Request, response as unknown as Response, next)).not.toThrow();
    response.end();
    expect(next).toHaveBeenCalledOnce();
    expect(trap).not.toHaveBeenCalled();
  });

  it('preserves sanitized backend diagnosis in a separate sink without trace fields or telemetry events', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-local-logs-'));
    directories.push(directory);
    const logFile = path.join(directory, 'runtime.log');
    configureLogger({ logLevel: 'debug', logFile, transport: 'stdio' });
    const broker = new BackendLogBroker();
    const source = staticBackendLogSource('backend-source-local-only');
    broker.registerSource(source);
    const project = createBackendLogProjection({ broker, source });
    await withMcpTraceContext(
      { _meta: { traceparent: '00-1234567890abcdef1234567890abcdef-abcdef1234567890-01' } },
      async () => {
        project(ManagedStdioStderrEvent.Line, {
          serverName: source.canonicalName,
          source: 'backend-stderr',
          line: 'backend-diagnostic-local-only api_key=backend-secret',
        });
      },
    );
    writeBackendDiagnostic({ content: forbidden[0] } as never);
    await vi.waitFor(() => expect(fs.readFileSync(logFile, 'utf8')).toContain('backend-diagnostic-local-only'));
    const output = fs.readFileSync(logFile, 'utf8');
    expect(output).toContain('backend-source-local-only');
    expect(output).toContain('api_key=[REDACTED]');
    expect(output).not.toContain('backend-secret');
    expect(output).not.toContain(forbidden[0]);
    expect(output).not.toContain('trace_id');
    expect(output).not.toContain('span_id');
    expect(output).not.toContain('fingerprint');
    expect(normalizeEvent(broker.snapshot().entries[0], broker.snapshot().entries[0])).toBeUndefined();
  });
});
