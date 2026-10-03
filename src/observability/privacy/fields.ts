import { createHmac, randomBytes } from 'node:crypto';
import { types } from 'node:util';

/** This key is intentionally neither exported nor loaded from configuration. */
const processKey = randomBytes(32);
export const MAX_STRING_BYTES = 256;
export const MAX_ARRAY_ENTRIES = 16;
export const MAX_EVENT_FIELDS = 24;
export const MAX_EVENT_BYTES = 8192;

export type IdentityType = 'server' | 'session' | 'client' | 'request';

/** Only the typed local-log normalizer calls this; never use for product identity. */
export function privateFingerprint(type: IdentityType, value: unknown): string | undefined {
  if (!['server', 'session', 'client', 'request'].includes(type)) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return undefined;
  return createHmac('sha256', processKey)
    .update(`1mcp:local-log:${type}:v1\0`)
    .update(value)
    .digest('hex')
    .slice(0, 32);
}

/** Read data properties only: instrumentation must never execute an untrusted getter. */
export function ownData(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || types.isProxy(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

const ERROR_CODES = [
  'EACCES',
  'ENOENT',
  'EADDRINUSE',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ABORT_ERR',
  'gateway_overloaded',
  'runtime_draining',
  'gateway_target_unavailable',
  'resource_not_found',
  'schema_evaluation_timeout',
  'schema_evaluation_unavailable',
  'gateway_protocol_error',
  'gateway_invalid_request_error',
  'gateway_authorization_error',
  'gateway_deadline_exceeded_error',
  'gateway_cancelled_error',
  'gateway_transport_error',
  'gateway_internal_error',
  '-32700',
  '-32600',
  '-32601',
  '-32602',
  '-32603',
  '-32002',
  '-32000',
] as const;
const ERROR_KINDS = [
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'AbortError',
  'TimeoutError',
  'protocol',
  'invalid-request',
  'authorization',
  'deadline-exceeded',
  'cancelled',
  'transport',
  'internal',
] as const;

export function errorFacts(error: unknown): { error_kind: string; error_code: string } {
  // Do not traverse prototypes, causes, messages, stacks, or SDK objects.
  const name = ownData(error, 'kind') ?? ownData(error, 'name');
  const rawCode = ownData(error, 'code');
  const code = typeof rawCode === 'number' && Number.isSafeInteger(rawCode) ? String(rawCode) : rawCode;
  return {
    error_kind: typeof name === 'string' && ERROR_KINDS.some((kind) => kind === name) ? name : 'other',
    error_code: typeof code === 'string' && ERROR_CODES.some((allowed) => allowed === code) ? code : 'other',
  };
}

/** Only for registry-owned descriptive constants, never request/backend text. */
export function boundedDescription(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= MAX_STRING_BYTES) return value;
  const marker = ' [truncated]';
  const budget = MAX_STRING_BYTES - Buffer.byteLength(marker);
  let result = '';
  let size = 0;
  for (const character of value) {
    const bytes = Buffer.byteLength(character);
    if (size + bytes > budget) break;
    result += character;
    size += bytes;
  }
  return result + marker;
}

export const CLOSED_VALUES = {
  method: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
    'HEAD',
    'initialize',
    'ping',
    'tools/list',
    'tools/call',
    'resources/list',
    'resources/read',
    'resources/templates/list',
    'prompts/list',
    'prompts/get',
    'logging/setLevel',
    'completion/complete',
    'sampling/createMessage',
    'elicitation/create',
    'roots/list',
    'other',
  ],
  transport: ['stdio', 'http', 'sse', 'streamable-http', 'other'],
  status: [
    'pending',
    'loading',
    'ready',
    'connected',
    'disconnected',
    'failed',
    'error',
    'disabled',
    'enabled',
    'stopped',
    'starting',
    'running',
    'completed',
    'cancelled',
    'other',
  ],
} as const;

export type FieldRule =
  'number' | 'boolean' | 'error' | `identity:${IdentityType}` | keyof typeof CLOSED_VALUES | 'methods';

export function normalizeField(rule: FieldRule, value: unknown): string | number | boolean | string[] | undefined {
  if (rule === 'number')
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
      ? value
      : undefined;
  if (rule === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (rule.startsWith('identity:')) return privateFingerprint(rule.slice(9) as IdentityType, value);
  if (rule === 'methods') {
    if (types.isProxy(value) || !Array.isArray(value)) return undefined;
    const result: string[] = [];
    for (let index = 0; index < Math.min(value.length, MAX_ARRAY_ENTRIES); index++) {
      const item = ownData(value, String(index));
      result.push(typeof item === 'string' && CLOSED_VALUES.method.some((entry) => entry === item) ? item : 'other');
    }
    return result;
  }
  if (rule === 'error') return undefined;
  const vocabulary: readonly string[] = CLOSED_VALUES[rule as keyof typeof CLOSED_VALUES];
  return typeof value === 'string' && vocabulary.includes(value) ? value : 'other';
}
