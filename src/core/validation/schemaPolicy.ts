import { types } from 'node:util';

/** Accepted safety baseline. Scheduling optimizations and operator controls are intentionally deferred. */
export const SCHEMA_LIMITS = Object.freeze({
  schemaBytes: 256 * 1024,
  toolSchemaBytes: 512 * 1024,
  depth: 64,
  schemaNodes: 10_000,
  properties: 1024,
  required: 1024,
  references: 256,
  branches: 1024,
  regexes: 128,
  regexBytes: 1024,
  enumValues: 1024,
  inputBytes: 1024 * 1024,
  outputBytes: 4 * 1024 * 1024,
  instanceNodes: 100_000,
  arrayEntries: 10_000,
  instanceProperties: 10_000,
  compileMs: 250,
  evaluateMs: 50,
  queue: 128,
  heapMb: 128,
  stackMb: 4,
  shutdownMs: 5000,
});
export type SchemaFailureCode =
  | 'schema_invalid'
  | 'schema_unsupported_dialect'
  | 'schema_unsupported_vocabulary'
  | 'schema_reference_forbidden'
  | 'schema_reference_unresolved'
  | 'schema_budget_exceeded'
  | 'schema_compile_failed'
  | 'schema_evaluation_timeout'
  | 'schema_evaluation_unavailable'
  | 'schema_input_invalid'
  | 'schema_output_invalid'
  | 'schema_projection_unrepresentable';
export class SchemaBoundaryError extends Error {
  constructor(
    public readonly code: SchemaFailureCode,
    public readonly retryable = false,
    public readonly phase: 'admission' | 'input' | 'output' = code === 'schema_output_invalid' ? 'output' : 'admission',
  ) {
    super(code);
    this.name = 'SchemaBoundaryError';
  }
}

/** Inspect descriptors before reading values: capture cannot execute a caller's accessor. */
export function captureJson(value: unknown, schema: boolean, output = false): { value: unknown; json: string } {
  let nodes = 0;
  let bytes = 0;
  const active = new Set<object>();
  const maxBytes = schema ? SCHEMA_LIMITS.schemaBytes : output ? SCHEMA_LIMITS.outputBytes : SCHEMA_LIMITS.inputBytes;
  const fail = () => {
    throw new SchemaBoundaryError('schema_budget_exceeded');
  };
  const capture = (item: unknown, depth: number): unknown => {
    if (++nodes > (schema ? SCHEMA_LIMITS.schemaNodes : SCHEMA_LIMITS.instanceNodes) || depth > SCHEMA_LIMITS.depth)
      fail();
    if (item === null || typeof item === 'boolean' || typeof item === 'string' || typeof item === 'number') {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new SchemaBoundaryError('schema_invalid');
      bytes += typeof item === 'string' ? Buffer.byteLength(item) + 2 : JSON.stringify(item).length;
      if (bytes > maxBytes) fail();
      if (
        typeof item === 'string' &&
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(item)
      )
        throw new SchemaBoundaryError('schema_invalid');
      return item;
    }
    if (typeof item !== 'object' || types.isProxy(item) || active.has(item))
      throw new SchemaBoundaryError('schema_invalid');
    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      throw new SchemaBoundaryError('schema_invalid');
    active.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors).filter((key) => !(array && key === 'length'));
    if (
      keys.length >
      (array ? SCHEMA_LIMITS.arrayEntries : schema ? SCHEMA_LIMITS.properties : SCHEMA_LIMITS.instanceProperties)
    )
      fail();
    if (array && keys.length !== item.length) throw new SchemaBoundaryError('schema_invalid');
    const result: Record<string, unknown> | unknown[] = array ? [] : (Object.create(null) as Record<string, unknown>);
    if (keys.some((key) => typeof key !== 'string')) throw new SchemaBoundaryError('schema_invalid');
    for (const key of keys.sort()) {
      if (typeof key !== 'string') throw new SchemaBoundaryError('schema_invalid');
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !('value' in descriptor)) throw new SchemaBoundaryError('schema_invalid');
      if (array && !/^(0|[1-9][0-9]*)$/.test(key)) throw new SchemaBoundaryError('schema_invalid');
      if (!array) bytes += Buffer.byteLength(key) + 3;
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(key))
        throw new SchemaBoundaryError('schema_invalid');
      if (bytes > maxBytes) fail();
      Object.defineProperty(result, key, { value: capture(descriptor.value, depth + 1), enumerable: true });
    }
    active.delete(item);
    return Object.freeze(result);
  };
  const copy = capture(value, 0);
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return '[' + item.map(canonical).join(',') + ']';
    if (item !== null && typeof item === 'object')
      return (
        '{' +
        Object.keys(item)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + canonical((item as Record<string, unknown>)[key]))
          .join(',') +
        '}'
      );
    return JSON.stringify(item);
  };
  const json = canonical(copy);
  if (Buffer.byteLength(json) > maxBytes) fail();
  return { value: copy, json };
}
