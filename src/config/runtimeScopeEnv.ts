import fs from 'node:fs';
import path from 'node:path';

import { OAuthRequiredError } from '@src/core/client/types.js';

const ENV_FILE_NAME = '.env';
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REDACTED_RUNTIME_SCOPE_VALUE = '[REDACTED]';

interface ErrnoException extends Error {
  code?: string;
}

let activeRuntimeScopeEnvironment: Readonly<Record<string, string>> = Object.freeze({});

export class RuntimeScopeEnvError extends Error {
  constructor(
    public readonly filePath: string,
    reason: 'read' | 'parse',
    line?: number,
  ) {
    const detail = reason === 'parse' && line ? ` (line ${line})` : '';
    super(`Failed to ${reason} Runtime Scope environment file '${filePath}'${detail}`);
    this.name = 'RuntimeScopeEnvError';
  }
}

export function getRuntimeScopeEnvPath(configFilePath: string): string {
  return path.join(path.dirname(path.resolve(configFilePath)), ENV_FILE_NAME);
}

export function getRuntimeScopeEnvironment(): Readonly<Record<string, string>> {
  return activeRuntimeScopeEnvironment;
}

export function activateRuntimeScopeEnvironment(environment: Readonly<Record<string, string>>): void {
  activeRuntimeScopeEnvironment = Object.freeze({ ...environment });
}

/**
 * Returns the original Error when it contains no active Runtime Scope value.
 * Secret-bearing errors are replaced without retaining the original as cause.
 */
export function sanitizeRuntimeScopeError(error: unknown): Error {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const secrets = getActiveRuntimeScopeValues();
  if (secrets.length === 0 || !containsSecret(normalized, secrets, new WeakSet())) return normalized;

  return cloneSanitizedError(normalized, secrets, new WeakMap());
}

export function loadRuntimeScopeEnvironment(configFilePath: string): Record<string, string> {
  const filePath = getRuntimeScopeEnvPath(configFilePath);
  let source: string;

  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as ErrnoException).code === 'ENOENT') return {};
    throw new RuntimeScopeEnvError(filePath, 'read');
  }

  return parseRuntimeScopeEnvironment(source, filePath);
}

export function parseRuntimeScopeEnvironment(source: string, filePath: string): Record<string, string> {
  const environment: Record<string, string> = {};
  const lines = source.replace(/^\uFEFF/u, '').split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const assignment = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trimStart() : trimmed;
    const equalsIndex = assignment.indexOf('=');
    if (equalsIndex <= 0) throw new RuntimeScopeEnvError(filePath, 'parse', lineNumber);

    const key = assignment.slice(0, equalsIndex).trim();
    if (!ENV_KEY_PATTERN.test(key)) throw new RuntimeScopeEnvError(filePath, 'parse', lineNumber);

    environment[key] = parseValue(assignment.slice(equalsIndex + 1).trimStart(), filePath, lineNumber);
  }

  return environment;
}

function parseValue(value: string, filePath: string, lineNumber: number): string {
  if (!value) return '';

  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const closingIndex = findClosingQuote(value, quote);
    if (closingIndex < 0 || !/^(?:\s*(?:#.*)?)?$/u.test(value.slice(closingIndex + 1))) {
      throw new RuntimeScopeEnvError(filePath, 'parse', lineNumber);
    }
    const quoted = value.slice(1, closingIndex);
    return quote === '"'
      ? quoted
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
      : quoted;
  }

  const commentIndex = value.search(/\s#/u);
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trimEnd();
}

function findClosingQuote(value: string, quote: string): number {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] !== quote) continue;
    if (quote === "'" || countPrecedingBackslashes(value, index) % 2 === 0) return index;
  }
  return -1;
}

function countPrecedingBackslashes(value: string, index: number): number {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) count += 1;
  return count;
}

function getActiveRuntimeScopeValues(): string[] {
  return [...new Set(Object.values(activeRuntimeScopeEnvironment).filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length,
  );
}

function redactString(value: string, secrets: readonly string[]): string {
  return secrets.reduce((redacted, secret) => redacted.split(secret).join(REDACTED_RUNTIME_SCOPE_VALUE), value);
}

function containsSecret(value: unknown, secrets: readonly string[], seen: WeakSet<object>): boolean {
  if (typeof value === 'string') return secrets.some((secret) => value.includes(secret));
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);

  if (value instanceof Error) {
    if (containsSecret(value.name, secrets, seen) || containsSecret(value.message, secrets, seen)) return true;
    if (value.stack && containsSecret(value.stack, secrets, seen)) return true;
    for (const special of errorDiagnosticValues(value)) {
      if (containsSecret(special, secrets, seen)) return true;
    }
  }

  for (const { key, value: nested } of enumerableDataProperties(value)) {
    const keyDescription = typeof key === 'symbol' ? key.description : key;
    if ((keyDescription && containsSecret(keyDescription, secrets, seen)) || containsSecret(nested, secrets, seen)) {
      return true;
    }
  }
  return false;
}

function cloneSanitizedError(error: Error, secrets: readonly string[], seen: WeakMap<object, unknown>): Error {
  const replacement = new Error(redactString(error.message, secrets));
  const prototype = Object.getPrototypeOf(error) as object | null;
  Object.setPrototypeOf(replacement, prototype);
  seen.set(error, replacement);
  replacement.name = redactString(error.name, secrets);
  if (error.stack) replacement.stack = redactString(error.stack, secrets);

  copyErrorDiagnosticProperty(error, replacement, 'cause', secrets, seen);
  copyErrorDiagnosticProperty(error, replacement, 'errors', secrets, seen);
  for (const property of enumerableDataProperties(error)) {
    if (property.key === 'cause' || property.key === 'errors') continue;
    defineSanitizedProperty(replacement, property, secrets, seen);
  }
  return replacement;
}

function cloneSanitizedValue(value: unknown, secrets: readonly string[], seen: WeakMap<object, unknown>): unknown {
  if (typeof value === 'string') return redactString(value, secrets);
  if (!value || typeof value !== 'object') return value;
  const existing = seen.get(value);
  if (existing) return existing;
  if (value instanceof Error) return cloneSanitizedError(value, secrets, seen);

  const replacement: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {};
  seen.set(value, replacement);
  for (const property of enumerableDataProperties(value)) {
    defineSanitizedProperty(replacement, property, secrets, seen);
  }
  return replacement;
}

interface DiagnosticProperty {
  key: string | symbol;
  value: unknown;
  enumerable: boolean;
}

function enumerableDataProperties(value: object): DiagnosticProperty[] {
  const properties: DiagnosticProperty[] = [];
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable && 'value' in descriptor) {
      properties.push({ key, value: descriptor.value as unknown, enumerable: descriptor.enumerable });
    }
  }
  return properties;
}

function errorDiagnosticValues(error: Error): unknown[] {
  const values: unknown[] = [];
  for (const key of ['cause', 'errors']) {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (descriptor && 'value' in descriptor) values.push(descriptor.value as unknown);
  }
  return values;
}

function copyErrorDiagnosticProperty(
  source: Error,
  target: Error,
  key: 'cause' | 'errors',
  secrets: readonly string[],
  seen: WeakMap<object, unknown>,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor || !('value' in descriptor)) return;
  Object.defineProperty(target, key, {
    value: cloneSanitizedValue(descriptor.value, secrets, seen),
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function defineSanitizedProperty(
  target: object,
  property: DiagnosticProperty,
  secrets: readonly string[],
  seen: WeakMap<object, unknown>,
): void {
  const operational = isOAuthClientReference(target, property);
  const safeKey = sanitizePropertyKey(property.key, secrets);
  Object.defineProperty(target, safeKey, {
    value: operational ? property.value : cloneSanitizedValue(property.value, secrets, seen),
    enumerable: property.enumerable && !operational && typeof safeKey === 'string',
    configurable: true,
    writable: true,
  });
}

function sanitizePropertyKey(key: string | symbol, secrets: readonly string[]): string | symbol {
  if (typeof key === 'string') return redactString(key, secrets);
  if (!key.description) return key;
  const safeDescription = redactString(key.description, secrets);
  return safeDescription === key.description ? key : Symbol(safeDescription);
}

function isOAuthClientReference(target: object, property: DiagnosticProperty): boolean {
  return (
    target instanceof OAuthRequiredError &&
    property.key === 'client' &&
    Boolean(property.value && typeof property.value === 'object')
  );
}
