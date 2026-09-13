import { afterEach, describe, expect, it } from 'vitest';

import { SCHEMA_LIMITS, SchemaBoundary } from './schemaBoundary.js';
import { captureJson } from './schemaPolicy.js';

const binding = { routeKey: 'server/tool', generation: '1' };
const pools: SchemaBoundary[] = [];
const pool = () => {
  const boundary = new SchemaBoundary(1);
  pools.push(boundary);
  return boundary;
};
afterEach(async () => {
  await Promise.all(pools.splice(0).map((item) => item.shutdown()));
});
describe('isolated schema boundary', () => {
  it('accepts an explicit root id equal to the internal resolution base', async () => {
    const boundary = pool();
    const contract = await boundary.admit({ $id: 'https://schema.invalid/', type: 'number' }, binding);
    expect(await boundary.evaluate(contract, 3, binding)).toEqual({ valid: true });
  });
  it.each(['2020-12', '2019-09', 'draft-07', 'draft-06'])(
    'evaluates %s without mutation or defaults',
    async (dialect) => {
      const boundary = pool();
      const schema = {
        $schema: dialect.startsWith('draft-')
          ? `http://json-schema.org/${dialect}/schema#`
          : `https://json-schema.org/draft/${dialect}/schema`,
        type: 'object',
        properties: { x: { type: 'number', default: 3 } },
        additionalProperties: false,
      };
      const before = structuredClone(schema);
      const contract = await boundary.admit(schema, { ...binding, profile: 'tool-input' });
      expect(await boundary.evaluate(contract, {}, binding)).toEqual({ valid: true });
      const input = { x: '3', extra: true };
      expect(await boundary.evaluate(contract, input, { ...binding, mode: 'report-only' })).toMatchObject({
        valid: false,
        code: 'schema_input_invalid',
      });
      await expect(boundary.evaluate(contract, input, binding)).rejects.toThrow('schema_input_invalid');
      expect(input).toEqual({ x: '3', extra: true });
      expect(schema).toEqual(before);
      expect(Object.isFrozen(contract.source)).toBe(true);
    },
  );
  it('supports same-document references and fails closed on missing/external references', async () => {
    const boundary = pool();
    const contract = await boundary.admit(
      { type: 'object', properties: { x: { $ref: '#/$defs/value' } }, $defs: { value: { type: 'number' } } },
      binding,
    );
    await expect(boundary.evaluate(contract, { x: 'bad' }, binding)).rejects.toThrow('schema_input_invalid');
    await expect(boundary.admit({ $ref: 'https://private.invalid/secret' }, binding)).rejects.toThrow(
      'schema_reference_forbidden',
    );
    await expect(boundary.admit({ $ref: '#/$defs/missing' }, binding)).rejects.toThrow('schema_reference_unresolved');
    await expect(boundary.admit({ $schema: 'custom' }, binding)).rejects.toThrow('schema_unsupported_dialect');
    await expect(boundary.admit({ $vocabulary: { 'https://custom.invalid/vocab': true } }, binding)).rejects.toThrow(
      'schema_unsupported_vocabulary',
    );
  });
  it('rejects forged and stale route/generation contracts', async () => {
    const boundary = pool();
    const contract = await boundary.admit({}, binding);
    await expect(boundary.evaluate({ ...contract }, {}, binding)).rejects.toThrow('schema_invalid');
    await expect(boundary.evaluate(contract, {}, { ...binding, generation: '2' })).rejects.toThrow('schema_invalid');
  });
  it('bounds hostile regex execution without blocking the main event loop, then recovers', async () => {
    const boundary = pool();
    const contract = await boundary.admit({ type: 'string', pattern: '^(a+)+$' }, binding);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 5);
    await expect(boundary.evaluate(contract, 'a'.repeat(35) + '!', binding)).rejects.toThrow(
      'schema_evaluation_timeout',
    );
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(1);
    const healthy = await boundary.admit({ type: 'number' }, binding);
    expect(await boundary.evaluate(healthy, 3, binding)).toEqual({ valid: true });
  });
  it('bounds queued work and removes canceled jobs', async () => {
    const boundary = pool();
    const controller = new AbortController();
    const jobs = Array.from({ length: SCHEMA_LIMITS.queue + 1 }, () =>
      boundary.admit({}, { ...binding, signal: controller.signal }).catch((error) => error),
    );
    controller.abort();
    const results = await Promise.all(jobs);
    expect(results.every((result) => result instanceof Error)).toBe(true);
    expect(await boundary.admit({}, binding)).toHaveProperty('digest');
  });
  it('shuts down deterministically and rejects subsequent work', async () => {
    const boundary = pool();
    await boundary.admit({}, binding);
    await boundary.shutdown();
    await expect(boundary.admit({}, binding)).rejects.toThrow('schema_evaluation_unavailable');
  });
  it('captures only strict bounded JSON without invoking accessors', () => {
    let called = false;
    expect(() =>
      captureJson(
        Object.defineProperty({}, 'x', {
          enumerable: true,
          get() {
            called = true;
            return 1;
          },
        }),
        true,
      ),
    ).toThrow('schema_invalid');
    expect(called).toBe(false);
    const cycle: unknown[] = [];
    cycle.push(cycle);
    for (const value of [cycle, NaN, new Date(), undefined])
      expect(() => captureJson(value, false)).toThrow('schema_invalid');
    expect(() => captureJson('a'.repeat(SCHEMA_LIMITS.inputBytes + 1), false)).toThrow('schema_budget_exceeded');
    expect(() => captureJson(Array(SCHEMA_LIMITS.arrayEntries + 1).fill(null), false)).toThrow(
      'schema_budget_exceeded',
    );
    let deep: unknown = null;
    for (let i = 0; i <= SCHEMA_LIMITS.depth; i++) deep = { deep };
    expect(() => captureJson(deep, true)).toThrow('schema_budget_exceeded');
  });
});

describe('accepted schema safety limits', () => {
  it.each([
    ['required', { required: Array.from({ length: 1025 }, (_, i) => String(i)) }],
    ['enumValues', { enum: Array.from({ length: 1025 }, (_, i) => i) }],
    ['branches', { allOf: Array.from({ length: 1025 }, () => ({})) }],
    ['regexBytes', { pattern: 'a'.repeat(1025) }],
    ['regexes', { patternProperties: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [String(i), {}])) }],
    [
      'references',
      { properties: Object.fromEntries(Array.from({ length: 257 }, (_, i) => [String(i), { $ref: '#' }])) },
    ],
  ])('rejects exceeded %s inside worker admission', async (_limit, schema) => {
    await expect(pool().admit(schema, binding)).rejects.toThrow('schema_budget_exceeded');
  });
  it('enforces exact serialized byte limits and plain object/property/node bounds', () => {
    for (const [schema, output, max] of [
      [true, false, SCHEMA_LIMITS.schemaBytes],
      [false, false, SCHEMA_LIMITS.inputBytes],
      [false, true, SCHEMA_LIMITS.outputBytes],
    ] as const) {
      expect(captureJson('a'.repeat(max - 2), schema, output).json.length).toBe(max);
      expect(() => captureJson('a'.repeat(max - 1), schema, output)).toThrow('schema_budget_exceeded');
    }
    expect(() => captureJson(Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [i, null])), true)).toThrow(
      'schema_budget_exceeded',
    );
    expect(() => captureJson(Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [i, null])), false)).toThrow(
      'schema_budget_exceeded',
    );
    expect(() =>
      captureJson(
        Array.from({ length: 100 }, () => Array(100).fill(null)),
        true,
      ),
    ).toThrow('schema_budget_exceeded');
    expect(() =>
      captureJson(
        Array.from({ length: 1000 }, () => Array(100).fill(null)),
        false,
      ),
    ).toThrow('schema_budget_exceeded');
  });
  it('recovers after an unexpected worker exit and a running cancellation', async () => {
    const boundary = pool();
    const contract = await boundary.admit({ type: 'string', pattern: '^(a+)+$' }, binding);
    const controller = new AbortController();
    const pending = boundary.evaluate(contract, 'a'.repeat(35) + '!', { ...binding, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('schema_evaluation_unavailable');
    await boundary.admit({}, binding);
    const slots = (boundary as unknown as { slots: Set<{ worker: { terminate(): Promise<number> } }> }).slots;
    await [...slots][0].worker.terminate();
    expect(await boundary.admit({}, binding)).toHaveProperty('digest');
  });
});

describe('dialect and canonical capture regressions', () => {
  it('keeps draft06 conditionals and OpenAPI nullable as annotations', async () => {
    const boundary = pool();
    const draft06 = await boundary.admit(
      { $schema: 'http://json-schema.org/draft-06/schema#', if: true, then: false },
      binding,
    );
    expect(await boundary.evaluate(draft06, 123, binding)).toEqual({ valid: true });
    const source = { type: 'string', nullable: true };
    const string = await boundary.admit(source, binding);
    await expect(boundary.evaluate(string, null, binding)).rejects.toThrow('schema_input_invalid');
    expect(source).toEqual({ type: 'string', nullable: true });
    const modern = await boundary.admit({ type: 'object', dependencies: { x: ['y'] } }, binding);
    expect(await boundary.evaluate(modern, { x: 1 }, binding)).toEqual({ valid: true });
  });
  it('resolves a same-document id with an empty fragment', async () => {
    const boundary = pool();
    const contract = await boundary.admit(
      {
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: 'https://example.com/schema#',
        definitions: { x: { type: 'number' } },
        $ref: '#/definitions/x',
      },
      binding,
    );
    expect(await boundary.evaluate(contract, 3, binding)).toEqual({ valid: true });
  });
  it('canonicalizes numeric-looking keys lexically and rejects proxies before their traps', () => {
    expect(captureJson({ '2': 'b', '10': 'a' }, true).json).toBe('{"10":"a","2":"b"}');
    let ran = false;
    const proxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          ran = true;
          throw new Error('private trap');
        },
      },
    );
    expect(() => captureJson(proxy, true)).toThrow('schema_invalid');
    expect(ran).toBe(false);
  });
});

it('analyzes referenced annotation targets without treating opaque annotations as schemas', async () => {
  const boundary = pool();
  const contract = await boundary.admit({ $ref: '#/x', x: { type: 'string', nullable: true } }, binding);
  await expect(boundary.evaluate(contract, null, binding)).rejects.toThrow('schema_input_invalid');
  await expect(boundary.admit({ $ref: '#/x', x: { pattern: 'a'.repeat(1025) } }, binding)).rejects.toThrow(
    'schema_budget_exceeded',
  );
  const old = await boundary.admit(
    { $schema: 'http://json-schema.org/draft-06/schema#', if: { $ref: 'https://external.invalid' }, then: false },
    binding,
  );
  expect(await boundary.evaluate(old, 123, binding)).toEqual({ valid: true });
  const annotation = await boundary.admit(
    { type: 'object', default: { nullable: true, $ref: 'https://external.invalid' } },
    binding,
  );
  expect(await boundary.evaluate(annotation, {}, binding)).toEqual({ valid: true });
});
