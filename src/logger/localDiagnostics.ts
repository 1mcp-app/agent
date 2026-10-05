import { types } from 'node:util';

import { ownData } from '@src/observability/privacy/fields.js';

import { sanitizeHttpBody } from './httpDiagnostics.js';
import logger, { writeLocalDiagnosticRecord } from './logger.js';

export type LocalDiagnosticLevel = 'info' | 'debug' | 'warn' | 'error';
export type LocalDiagnosticEvent =
  `${'backend' | 'tool' | 'config' | 'schema' | 'capability' | 'oauth' | 'session'}.${string}`;
export interface LocalDiagnosticRecord {
  readonly level: LocalDiagnosticLevel;
  readonly event: LocalDiagnosticEvent;
  readonly details: string;
}
const admittedRecords = new WeakSet<object>();

/** Only records produced by the bounded sanitizer may reach the local sink. */
export function isLocalDiagnosticRecord(record: LocalDiagnosticRecord): boolean {
  return admittedRecords.has(record);
}

function diagnosticText(value: string): string {
  if (Buffer.byteLength(value) > 32768) return '[OMITTED: oversized string]';
  // Error text may contain credential URLs or headers, even outside structured fields.
  return value
    .replace(/\bhttps?:\/\/[^\s<>"']+/gi, (url) => {
      try {
        const parsed = new URL(url);
        parsed.username = '';
        parsed.password = '';
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
      } catch {
        return '[OMITTED: invalid URL]';
      }
    })
    .replace(/\b(?:authorization|(?:set-)?cookie)\s*[:=][^\r\n]*/gi, '[REDACTED HEADER]');
}

function errorSnapshot(error: unknown, debug: boolean, depth = 0): unknown {
  if (depth >= 4) return '[TRUNCATED: error causes]';
  if (typeof error === 'string') return diagnosticText(error);
  if (!error || typeof error !== 'object' || types.isProxy(error)) return '[UNAVAILABLE: error]';
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  // No caller accessors, SDK serialization hooks, or arbitrary prototype fields.
  let name = ownData(error, 'name');
  if (name === undefined && types.isNativeError(error)) {
    const prototype: unknown = Object.getPrototypeOf(error);
    if (prototype && typeof prototype === 'object' && !types.isProxy(prototype)) name = ownData(prototype, 'name');
  }
  if (typeof name === 'string') result.name = diagnosticText(name);
  const message = ownData(error, 'message');
  if (typeof message === 'string') result.message = diagnosticText(message);
  const code = ownData(error, 'code');
  if (typeof code === 'string' || typeof code === 'number') result.errorCode = code;
  const cause = ownData(error, 'cause');
  if (cause !== undefined) result.cause = errorSnapshot(cause, debug, depth + 1);
  if (debug) {
    const stack = ownData(error, 'stack');
    if (typeof stack === 'string') result.stack = diagnosticText(stack);
  }
  return result;
}

/** Fail-open local diagnostics, separate from typed events, trace context, and exporters. */
export function writeLocalDiagnostic(
  level: LocalDiagnosticLevel,
  event: LocalDiagnosticEvent,
  fields: Record<string, unknown> | (() => Record<string, unknown>),
): void {
  try {
    if (!logger.isLevelEnabled(level)) return;
    if (!/^(backend|tool|config|schema|capability|oauth|session)\.[a-z][a-z0-9.-]{0,95}$/.test(event)) return;
    const input = typeof fields === 'function' ? fields() : fields;
    let nodes = 0;
    function snapshot(value: unknown, depth: number): unknown {
      if (++nodes > 256 || depth > 6) return '[TRUNCATED]';
      if (typeof value === 'string') return diagnosticText(value);
      if (!value || typeof value !== 'object') return value;
      if (types.isProxy(value)) return '[UNAVAILABLE]';
      if (types.isNativeError(value)) return errorSnapshot(value, level === 'debug');
      if (ArrayBuffer.isView(value)) return '[OMITTED: binary data]';
      if (Array.isArray(value)) {
        const count = Math.min(value.length, 256 - nodes);
        const values = Array.from({ length: count }, (_, index) => snapshot(ownData(value, String(index)), depth + 1));
        if (count < value.length) values.push('[TRUNCATED]');
        return values;
      }
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(value)) {
        if (nodes >= 256) break;
        const data = ownData(value, key);
        result[diagnosticText(key)] =
          key === 'error' ? errorSnapshot(data, level === 'debug') : snapshot(data, depth + 1);
      }
      return result;
    }
    const record: LocalDiagnosticRecord = Object.freeze({
      level,
      event,
      details: sanitizeHttpBody(snapshot(input, 0)),
    });
    admittedRecords.add(record);
    writeLocalDiagnosticRecord(record);
  } catch {
    // Diagnostic failures must never change request, recovery, or reload behavior.
  }
}
