import { JSONRPCMessageSchema as V2JSONRPCMessageSchema } from '@modelcontextprotocol/core';

import { CallToolRequestSchema as V1CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { isJsonValue, JSON_VALUE_LIMITS, type JsonValue, toJsonValue } from './jsonValue.js';

function expectInvalid(value: unknown, reason: string, path?: string): void {
  const expected =
    path === undefined
      ? { reason: expect.stringContaining(reason) }
      : { path, reason: expect.stringContaining(reason) };
  expect(() => toJsonValue(value)).toThrowError(expect.objectContaining(expected));
}

function createGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function generatedJsonValue(random: () => number, depth = 0): JsonValue {
  const choice = depth >= 5 ? Math.floor(random() * 4) : Math.floor(random() * 6);
  switch (choice) {
    case 0:
      return null;
    case 1:
      return random() >= 0.5;
    case 2:
      return Math.floor(random() * 20_000) / 10 - 1_000;
    case 3:
      return `value-${Math.floor(random() * 1_000_000)}`;
    case 4:
      return Array.from({ length: Math.floor(random() * 5) }, () => generatedJsonValue(random, depth + 1));
    default: {
      const result: Record<string, JsonValue> = {};
      for (let index = 0; index < Math.floor(random() * 5); index += 1) {
        result[`key-${depth}-${index}`] = generatedJsonValue(random, depth + 1);
      }
      return result;
    }
  }
}

describe('toJsonValue', () => {
  it('accepts the supported JSON domain and returns a defensive plain clone', () => {
    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype.safe = true;
    const source = { array: [null, false, 'text', 1.25, nullPrototype], nested: { value: 7 } };

    const result = toJsonValue(source);

    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect((result as Record<string, JsonValue>).array).not.toBe(source.array);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    source.nested.value = 99;
    expect((result as { nested: { value: number } }).nested.value).toBe(7);
  });

  it('round-trips deterministic generated nested values without sharing identity', () => {
    const random = createGenerator(0x1_4d43_5026);

    for (let index = 0; index < 250; index += 1) {
      const source = generatedJsonValue(random);
      const clone = toJsonValue(source);
      expect(clone).toEqual(source);
      expect(JSON.parse(JSON.stringify(clone))).toEqual(clone);
      expect(isJsonValue(source)).toBe(true);
      if (source !== null && typeof source === 'object') expect(clone).not.toBe(source);
    }
  });

  it.each([
    ['undefined', undefined, 'undefined values'],
    ['bigint', 1n, 'bigint values'],
    ['symbol', Symbol('value'), 'symbol values'],
    ['function', () => undefined, 'function values'],
    ['NaN', Number.NaN, 'numbers must be finite'],
    ['positive infinity', Number.POSITIVE_INFINITY, 'numbers must be finite'],
    ['negative infinity', Number.NEGATIVE_INFINITY, 'numbers must be finite'],
    ['negative zero', -0, 'negative zero'],
    ['Date', new Date(0), 'only Object.prototype'],
    ['Map', new Map(), 'only Object.prototype'],
    ['Set', new Set(), 'only Object.prototype'],
    ['Error', new Error('foreign'), 'only Object.prototype'],
    ['v1 Zod schema', V1CallToolRequestSchema, 'only Object.prototype'],
    ['v2 Zod schema', V2JSONRPCMessageSchema, 'only Object.prototype'],
    ['class instance', new (class ForeignValue {})(), 'only Object.prototype'],
  ])('rejects %s', (_name, value, reason) => {
    expectInvalid(value, reason, '$');
    expect(isJsonValue(value)).toBe(false);
  });

  it('rejects sparse arrays', () => {
    expectInvalid(new Array(1), 'sparse arrays', '$[0]');
  });

  it('rejects array extra properties', () => {
    const value = [1] as number[] & { extra?: boolean };
    value.extra = true;
    expectInvalid(value, 'extra properties', '$');
  });

  it('rejects cycles at the offending path', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expectInvalid(value, 'cyclic values', '$["self"]');
  });

  it('rejects accessors without invoking them', () => {
    const getter = vi.fn(() => 1);
    const value = Object.defineProperty({}, 'secret', { enumerable: true, get: getter });
    expectInvalid(value, 'accessor properties', '$["secret"]');
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects non-enumerable properties', () => {
    const value = Object.defineProperty({}, 'hidden', { enumerable: false, value: true });
    expectInvalid(value, 'non-enumerable properties', '$["hidden"]');
  });

  it('rejects symbol properties', () => {
    expectInvalid({ [Symbol('hidden')]: true }, 'symbol properties', '$');
  });

  it('enforces the documented depth limit', () => {
    let value: unknown = null;
    for (let index = 0; index <= JSON_VALUE_LIMITS.maxDepth; index += 1) value = [value];
    expectInvalid(value, 'depth limit');
  });

  it('enforces the documented node limit', () => {
    expectInvalid(
      Array.from({ length: JSON_VALUE_LIMITS.maxNodes }, () => null),
      'node limit',
    );
  });

  it('enforces the documented aggregate string limit across keys and values', () => {
    expectInvalid('x'.repeat(JSON_VALUE_LIMITS.maxTotalStringLength + 1), 'string length limit');
  });
});
