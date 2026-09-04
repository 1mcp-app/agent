export type JsonPrimitive = null | boolean | number | string;
export type JsonArray = JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/** Finite resource budgets applied while validating and cloning foreign values. */
export const JSON_VALUE_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 10_000,
  maxTotalStringLength: 1_000_000,
});

export class InvalidJsonValueError extends TypeError {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`Invalid JSON value at ${path}: ${reason}`);
    this.name = 'InvalidJsonValueError';
  }
}

interface CloneState {
  nodes: number;
  stringLength: number;
  readonly ancestors: WeakSet<object>;
}

function fail(path: string, reason: string): never {
  throw new InvalidJsonValueError(path, reason);
}

function consumeNode(state: CloneState, path: string): void {
  state.nodes += 1;
  if (state.nodes > JSON_VALUE_LIMITS.maxNodes) {
    fail(path, `node limit of ${JSON_VALUE_LIMITS.maxNodes} exceeded`);
  }
}

function consumeString(state: CloneState, path: string, value: string): void {
  state.stringLength += value.length;
  if (state.stringLength > JSON_VALUE_LIMITS.maxTotalStringLength) {
    fail(path, `total string length limit of ${JSON_VALUE_LIMITS.maxTotalStringLength} exceeded`);
  }
}

function childPath(path: string, key: string): string {
  return `${path}[${JSON.stringify(key)}]`;
}

function cloneArray(value: unknown[], path: string, depth: number, state: CloneState): JsonArray {
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
      fail(path, 'arrays must not have symbol or extra properties');
    }
  }

  const result: JsonArray = [];
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${path}[${index}]`;
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor) fail(itemPath, 'sparse arrays are not supported');
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail(itemPath, 'array elements must be own enumerable data properties');
    }
    result.push(cloneValue(descriptor.value as unknown, itemPath, depth + 1, state));
  }
  return result;
}

function cloneObject(value: object, path: string, depth: number, state: CloneState): JsonObject {
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, 'only Object.prototype and null-prototype objects are supported');
  }

  const result: JsonObject = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail(path, 'symbol properties are not supported');

    const propertyPath = childPath(path, key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) fail(propertyPath, 'non-enumerable properties are not supported');
    if (!('value' in descriptor)) fail(propertyPath, 'accessor properties are not supported');

    consumeString(state, propertyPath, key);
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: cloneValue(descriptor.value as unknown, propertyPath, depth + 1, state),
      writable: true,
    });
  }
  return result;
}

function cloneValue(value: unknown, path: string, depth: number, state: CloneState): JsonValue {
  if (depth > JSON_VALUE_LIMITS.maxDepth) {
    fail(path, `depth limit of ${JSON_VALUE_LIMITS.maxDepth} exceeded`);
  }
  consumeNode(state, path);

  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    consumeString(state, path, value);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'numbers must be finite');
    if (Object.is(value, -0)) fail(path, 'negative zero is not supported');
    return value;
  }
  if (typeof value !== 'object') fail(path, `${typeof value} values are not supported`);
  if (state.ancestors.has(value)) fail(path, 'cyclic values are not supported');

  state.ancestors.add(value);
  try {
    return Array.isArray(value) ? cloneArray(value, path, depth, state) : cloneObject(value, path, depth, state);
  } finally {
    state.ancestors.delete(value);
  }
}

/** Validates an unknown boundary value and returns a detached plain JSON clone. */
export function toJsonValue(value: unknown): JsonValue {
  return cloneValue(value, '$', 0, { ancestors: new WeakSet(), nodes: 0, stringLength: 0 });
}

export function isJsonValue(value: unknown): value is JsonValue {
  try {
    toJsonValue(value);
    return true;
  } catch (error) {
    if (error instanceof InvalidJsonValueError) return false;
    throw error;
  }
}
