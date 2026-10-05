import { randomBytes } from 'node:crypto';

import {
  HTTP_BODY_CAPTURE_BYTES,
  httpContentType,
  parseHttpResponseBody,
  sanitizeHttpBody,
  sanitizeHttpPath,
} from '@src/logger/httpDiagnostics.js';
import logger, { writeHttpDiagnostic } from '@src/logger/logger.js';
import { normalizeField, ownData } from '@src/observability/privacy/fields.js';

import type { NextFunction, Request, Response } from 'express';

const requestBodyLoggers = new WeakMap<Response, () => void>();

/** Run immediately after body parsers, before authentication or backend dispatch. */
export function httpRequestBodyLogger(_req: Request, res: Response, next: NextFunction): void {
  requestBodyLoggers.get(res)?.();
  next();
}

/** Sanitized local request/response diagnostics; bodies are captured only at debug level. */
export function httpRequestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const fields = {
    requestId: randomBytes(16).toString('hex'),
    method: typeof req.method === 'string' ? req.method : 'unknown',
    path: sanitizeHttpPath(ownData(req, 'originalUrl')),
  };
  const captureBodies = logger.isDebugEnabled();
  let requestLogged = false;
  let completed = false;
  let responseStarted = false;
  let responseBytes = 0;
  let bodyOmitted = false;
  const chunks: Buffer[] = [];
  writeHttpDiagnostic('info', 'http.request', fields);
  requestBodyLoggers.set(res, logRequestBody);

  function logRequestBody(): void {
    if (requestLogged) return;
    requestLogged = true;
    const rpcMethod = ownData(ownData(req, 'body'), 'method');
    if (typeof rpcMethod === 'string') {
      writeHttpDiagnostic('info', 'http.request-context', {
        ...fields,
        rpcMethod: String(normalizeField('method', rpcMethod)),
      });
    }
    if (!captureBodies) return;
    writeHttpDiagnostic('debug', 'http.request-body', {
      ...fields,
      contentType: httpContentType(ownData(ownData(req, 'headers'), 'content-type')),
      body: sanitizeHttpBody(ownData(req, 'body')),
    });
  }

  function capture(chunk: unknown, encoding: unknown): void {
    logRequestBody();
    if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) return;
    const charset = typeof encoding === 'string' && Buffer.isEncoding(encoding) ? encoding : 'utf8';
    const bytes = typeof chunk === 'string' ? Buffer.byteLength(chunk, charset) : chunk.byteLength;
    responseBytes += bytes;
    if (bytes === 0) return;
    if (!captureBodies || bodyOmitted) return;
    if (responseBytes > HTTP_BODY_CAPTURE_BYTES) {
      bodyOmitted = true;
      chunks.length = 0;
      return;
    }
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, charset) : Buffer.from(chunk));
  }

  const originalWrite = res.write;
  const originalEnd = res.end;
  const originalWriteHead = res.writeHead;
  if (typeof originalWriteHead === 'function') {
    res.writeHead = function (this: Response, ...args: unknown[]): Response {
      const result = Reflect.apply(originalWriteHead, this, args) as Response;
      if (!responseStarted) {
        responseStarted = true;
        logRequestBody();
        writeHttpDiagnostic('info', 'http.response-start', {
          ...fields,
          statusCode: res.statusCode,
          duration: Date.now() - startTime,
          contentType: httpContentType(res.getHeader('content-type')),
          rpcMethod: String(normalizeField('method', ownData(ownData(req, 'body'), 'method'))),
        });
      }
      return result;
    } as Response['writeHead'];
  }
  res.write = function (this: Response, ...args: unknown[]): boolean {
    capture(args[0], args[1]);
    return Reflect.apply(originalWrite, this, args) as boolean;
  } as Response['write'];
  res.end = function (this: Response, ...args: unknown[]): Response {
    capture(args[0], args[1]);
    return Reflect.apply(originalEnd, this, args) as Response;
  } as Response['end'];

  function complete(aborted: boolean): void {
    if (completed) return;
    completed = true;
    requestBodyLoggers.delete(res);
    logRequestBody();
    const contentType = httpContentType(res.getHeader('content-type'));
    writeHttpDiagnostic('info', 'http.response', {
      ...fields,
      statusCode: res.statusCode,
      duration: Date.now() - startTime,
      responseBytes,
      contentType,
      aborted,
      rpcMethod: String(normalizeField('method', ownData(ownData(req, 'body'), 'method'))),
    });
    if (captureBodies) {
      let body: unknown = '[OMITTED: non-text response]';
      let parseOmitted = false;
      const textual = ['application/json', 'text/event-stream', 'text/plain', 'text/html'].includes(contentType);
      const encoding = res.getHeader('content-encoding');
      const encoded = encoding !== undefined && encoding !== 'identity';
      if (!bodyOmitted && textual && !aborted && !encoded) {
        const text = Buffer.concat(chunks).toString('utf8');
        const parsed = parseHttpResponseBody(text, contentType);
        body = parsed.body;
        parseOmitted = parsed.omitted;
      }
      if (bodyOmitted) body = '[OMITTED: response exceeds 8192 bytes]';
      if (encoded) body = '[OMITTED: encoded response]';
      if (aborted) body = '[OMITTED: incomplete response]';
      writeHttpDiagnostic('debug', 'http.response-body', {
        ...fields,
        body: sanitizeHttpBody(body),
        bodyOmitted: bodyOmitted || !textual || aborted || encoded || parseOmitted,
      });
    }
    chunks.length = 0;
    res.write = originalWrite;
    res.end = originalEnd;
    res.writeHead = originalWriteHead;
  }
  res.once('finish', () => complete(false));
  res.once('close', () => complete(!res.writableFinished));
  next();
}
