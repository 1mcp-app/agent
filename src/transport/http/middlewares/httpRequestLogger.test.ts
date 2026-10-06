import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseHttpResponseBody, sanitizeHttpBody, sanitizeHttpPath } from '@src/logger/httpDiagnostics.js';
import { configureLogger } from '@src/logger/logger.js';

import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpRequestBodyLogger, httpRequestLogger } from './httpRequestLogger.js';

const directories: string[] = [];
afterEach(() => {
  configureLogger({ transport: 'stdio' });
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function setup(level = 'debug') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'http-diagnostics-'));
  directories.push(directory);
  const file = path.join(directory, 'runtime.log');
  configureLogger({ logLevel: level, logFile: file, transport: 'stdio' });
  const app = express();
  app.use(httpRequestLogger);
  app.use(express.json());
  app.use(httpRequestBodyLogger);
  const read = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
  const entries = () =>
    read()
      .split('\n')
      .filter((line) => line.includes('http-diagnostic'))
      .map((line) => JSON.parse(line.slice(line.indexOf('{'))) as Record<string, unknown>);
  return { app, read, entries };
}

describe('local HTTP diagnostics', () => {
  it('records paired endpoints and sanitized request/response bodies through the actual file sink', async () => {
    const { app, read, entries } = setup();
    app.post('/mcp', (_req, res) =>
      res.status(400).json({
        error: { code: -32602, message: 'invalid argument' },
        access_token: 'response-token-canary',
        password: 'password-canary',
        cookie: 'cookie-canary',
      }),
    );
    await request(app)
      .post('/mcp?code=query-code-canary')
      .send({
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'visible query', apiKey: 'key-canary' } },
        authorization: 'Bearer bearer-canary',
        code_verifier: 'pkce-canary',
        state: 'state-canary',
        token: 123456789,
      })
      .expect(400);
    await vi.waitFor(() => expect(entries()).toHaveLength(6));
    const events = entries();
    expect(new Set(events.map((entry) => entry.requestId)).size).toBe(1);
    expect(events.every((entry) => entry.path === '/mcp')).toBe(true);
    expect(events.find((entry) => entry.statusCode === 400 && entry.aborted !== undefined)).toMatchObject({
      method: 'POST',
      contentType: 'application/json',
      rpcMethod: 'tools/call',
      aborted: false,
    });
    expect(read()).toContain('visible query');
    expect(read()).toContain('invalid argument');
    expect(read()).toContain('-32602');
    for (const secret of [
      'query-code-canary',
      'key-canary',
      'pkce-canary',
      'state-canary',
      'bearer-canary',
      'response-token-canary',
      'password-canary',
      'cookie-canary',
      '123456789',
    ])
      expect(read()).not.toContain(secret);
    expect(read()).not.toContain('trace_id');
  });

  it('distinguishes concurrent requests and suppresses bodies at info level', async () => {
    const { app, read, entries } = setup('info');
    app.get('/health', (_req, res) => res.json({ diagnostic: 'body-canary' }));
    await Promise.all([request(app).get('/health'), request(app).get('/health')]);
    await vi.waitFor(() => expect(entries()).toHaveLength(6));
    expect(new Set(entries().map((entry) => entry.requestId)).size).toBe(2);
    expect(read()).not.toContain('body-canary');
    expect(read()).not.toContain('http.response-body');
  });

  it('records parsed request context and body while the handler is still pending', async () => {
    const { app, entries } = setup();
    let reply: (() => void) | undefined;
    app.post('/pending', (_req, res) => {
      reply = () => {
        res.json({ done: true });
      };
    });
    const pending = request(app)
      .post('/pending')
      .send({
        method: 'tools/call',
        params: { arguments: { query: 'pending-visible' } },
      })
      .then(() => undefined);
    try {
      await vi.waitFor(() =>
        expect(entries().some((entry) => String(entry.body).includes('pending-visible'))).toBe(true),
      );
      expect(entries().some((entry) => entry.rpcMethod === 'tools/call')).toBe(true);
      expect(entries().some((entry) => entry.statusCode !== undefined)).toBe(false);
    } finally {
      reply?.();
      await pending;
    }
  });

  it('preserves split buffers, encoded strings, callbacks, and response bytes', async () => {
    const { app, entries } = setup();
    const callback = vi.fn();
    app.get('/split', (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.write(Buffer.from('{"visible":'));
      res.end('22e7958c227d', 'hex', callback);
    });
    const response = await request(app).get('/split').expect(200);
    expect(response.body).toEqual({ visible: '界' });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(entries()).toHaveLength(5));
    expect(entries().find((entry) => typeof entry.responseBytes === 'number')?.responseBytes).toBe(
      Buffer.byteLength('{"visible":"界"}'),
    );
    expect(entries().find((entry) => entry.body && String(entry.body).includes('界'))).toBeDefined();
  });

  it('omits oversized bodies and sanitizes complete JSON SSE frames', async () => {
    const { app, read, entries } = setup();
    app.get('/large', (_req, res) => res.json({ value: 'large-canary'.repeat(1000) }));
    app.get('/stream', (_req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.end('data: {"token":"stream-token-canary"}\n\n');
    });
    await request(app).get('/large').expect(200);
    await request(app).get('/stream').expect(200);
    await vi.waitFor(() => expect(entries()).toHaveLength(10));
    expect(read()).not.toContain('large-canary');
    expect(read()).not.toContain('stream-token-canary');
    expect(entries().filter((entry) => entry.bodyOmitted === true)).toHaveLength(1);
  });

  it('logs disconnects once and preserves write backpressure without touching info-level body getters', async () => {
    const { entries } = setup('info');
    const trap = vi.fn(() => {
      throw new Error('getter-canary');
    });
    const req = { method: 'GET', originalUrl: '/mcp' };
    Object.defineProperty(req, 'body', { get: trap });
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      writableFinished: false,
      getHeader: vi.fn(() => 'text/event-stream'),
      write: vi.fn((_chunk: unknown) => false),
      end: vi.fn(),
    });
    const write = res.write;
    httpRequestLogger(req as Request, res as unknown as Response, vi.fn());
    expect(res.write('data: safe')).toBe(false);
    expect(write).toHaveBeenCalledWith('data: safe');
    res.emit('close');
    res.emit('finish');
    await vi.waitFor(() => expect(entries()).toHaveLength(2));
    expect(entries()[1]).toMatchObject({ aborted: true });
    expect(trap).not.toHaveBeenCalled();
  });

  it('never invokes getters, proxies, or toJSON while sanitizing bounded cyclic bodies', () => {
    const trap = vi.fn(() => {
      throw new Error('unsafe getter');
    });
    const input: Record<string, unknown> = { visible: 'value', toJSON: trap };
    input.self = input;
    Object.defineProperty(input, 'payload', { get: trap });
    expect(sanitizeHttpBody(input)).toContain('value');
    expect(sanitizeHttpBody(input)).toContain('[CIRCULAR]');
    expect(sanitizeHttpBody(new Proxy({}, { ownKeys: trap }))).toContain('[UNAVAILABLE]');
    expect(trap).not.toHaveBeenCalled();
    expect(Buffer.byteLength(sanitizeHttpBody({ text: '界'.repeat(10000) }))).toBeLessThanOrEqual(8192);
    expect(
      sanitizeHttpBody({ token: 123456, code: 123456, error: { code: -32600 }, signature: 'proof-canary' }),
    ).not.toContain('123456');
    expect(sanitizeHttpBody({ signature: 'proof-canary' })).not.toContain('proof-canary');
    expect(sanitizeHttpPath('/mcp?token=query-canary')).toBe('/mcp');
    expect(sanitizeHttpPath('/token%3Dencoded-canary')).not.toContain('encoded-canary');
    expect(parseHttpResponseBody('data: {"token":"partial-canary"}', 'text/event-stream')).toEqual({
      body: '[OMITTED: incomplete SSE frame]',
      omitted: true,
    });
    expect(parseHttpResponseBody('data: /messages?sessionId=raw-session\n\n', 'text/event-stream')).toEqual({
      body: ['[OMITTED: non-JSON SSE data]'],
      omitted: true,
    });
  });
});
