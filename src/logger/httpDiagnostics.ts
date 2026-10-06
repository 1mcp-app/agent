import { types } from 'node:util';

import { ownData } from '@src/observability/privacy/fields.js';

import { redactRuntimeScopeDiagnosticText } from './diagnosticRedaction.js';
import { sanitizeForLogging } from './secureLogger.js';

export const HTTP_BODY_CAPTURE_BYTES = 8192;
const MAX_NODES = 256;
const MAX_DEPTH = 6;
const MAX_INPUT_STRING_BYTES = 32768;
const SENSITIVE_KEY =
  /authorization|cookie|password|passwd|secret|token|api.?key|private.?key|credential|signature|nonce|proof|verifier|challenge|session.?id|baggage|^state$|^code$/i;

export type HttpDiagnosticEvent =
  | 'http.request'
  | 'http.request-context'
  | 'http.response-start'
  | 'http.response'
  | 'http.request-body'
  | 'http.response-body';
export interface HttpDiagnosticFields {
  requestId: string;
  method: string;
  path: string;
  statusCode?: number;
  duration?: number;
  aborted?: boolean;
  contentType?: string;
  body?: string;
  bodyOmitted?: boolean;
  responseBytes?: number;
  rpcMethod?: string;
}

/** Local-only diagnostic snapshot: no getters, proxies, toJSON, or caller objects survive. */
export function sanitizeHttpBody(value: unknown): string {
  let nodes = 0;
  const seen = new WeakSet<object>();
  function copy(input: unknown, depth: number): unknown {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return '[TRUNCATED]';
    if (input === null || input === undefined) return input ?? null;
    if (typeof input === 'string') {
      if (Buffer.byteLength(input) > MAX_INPUT_STRING_BYTES) return '[OMITTED: oversized string]';
      return sanitizeForLogging(redactRuntimeScopeDiagnosticText(input));
    }
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    if (typeof input === 'boolean') return input;
    if (typeof input !== 'object' || types.isProxy(input)) return '[UNAVAILABLE]';
    if (ArrayBuffer.isView(input)) return '[OMITTED: binary body]';
    if (seen.has(input)) return '[CIRCULAR]';
    seen.add(input);
    if (Array.isArray(input)) {
      const length = Math.min(input.length, MAX_NODES - nodes);
      const result = Array.from({ length }, (_, index) => copy(ownData(input, String(index)), depth + 1));
      if (length < input.length) result.push('[TRUNCATED]');
      return result;
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(input)) {
      if (nodes >= MAX_NODES) {
        result['[TRUNCATED]'] = true;
        break;
      }
      const data = ownData(input, key);
      const sanitizedKey =
        Buffer.byteLength(key) > 1024 ? '[OVERSIZED_KEY]' : sanitizeForLogging(redactRuntimeScopeDiagnosticText(key));
      const safeKey = typeof sanitizedKey === 'string' ? sanitizedKey : '[KEY]';
      const numericErrorCode = key === 'code' && typeof data === 'number' && data < 0;
      if (SENSITIVE_KEY.test(key) && !numericErrorCode) {
        nodes++;
        result[safeKey] = '[REDACTED]';
      } else {
        result[safeKey] = copy(data, depth + 1);
      }
    }
    return result;
  }
  const serialized = JSON.stringify(copy(value, 0));
  // Never cut through a secret or a JSON value: oversized snapshots are omitted wholesale.
  return Buffer.byteLength(serialized) <= HTTP_BODY_CAPTURE_BYTES ? serialized : '[OMITTED: body exceeds 8192 bytes]';
}

export function sanitizeHttpPath(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  // Query values can carry OAuth codes and tokens; retain only the endpoint.
  const path = value.split('?', 1)[0];
  if (Buffer.byteLength(path) > 1024) return '[OMITTED: oversized path]';
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return '[OMITTED: invalid encoded path]';
  }
  const sanitized = sanitizeForLogging(decoded);
  return typeof sanitized === 'string' ? sanitized : 'unknown';
}

export function httpContentType(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const mediaType = value.split(';', 1)[0].trim().toLowerCase();
  return ['application/json', 'text/event-stream', 'text/plain', 'text/html', 'application/octet-stream'].includes(
    mediaType,
  )
    ? mediaType
    : 'other';
}

/** Extract complete JSON SSE data frames; never retain opaque endpoint or partial frames. */
export function parseHttpResponseBody(text: string, contentType: string): { body: unknown; omitted: boolean } {
  if (contentType === 'text/event-stream') {
    if (text && !/\r?\n\r?\n$/.test(text)) return { body: '[OMITTED: incomplete SSE frame]', omitted: true };
    let omitted = false;
    const body = text.split(/\r?\n\r?\n/).flatMap((frame) => {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) return [];
      try {
        return [JSON.parse(data) as unknown];
      } catch {
        omitted = true;
        return ['[OMITTED: non-JSON SSE data]'];
      }
    });
    return { body, omitted };
  }
  if (contentType === 'application/json') {
    try {
      return { body: JSON.parse(text) as unknown, omitted: false };
    } catch {
      return { body: '[OMITTED: invalid JSON response]', omitted: true };
    }
  }
  return { body: text, omitted: false };
}
