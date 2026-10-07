import { toJsonValue } from '@src/sdk/contracts/index.js';

import { describe, expect, it } from 'vitest';

import { createMcpParamHeaders, scanMcpParamDeclarations } from './mcpParamHeaders.js';

function headers(value: unknown, type = 'string') {
  const scan = scanMcpParamDeclarations({ type: 'object', properties: { value: { type, 'x-mcp-header': 'Value' } } });
  if (!scan.valid) throw new Error(scan.reason);
  return createMcpParamHeaders(scan.declarations, value === undefined ? {} : toJsonValue({ value }));
}

describe('schema-derived Mcp-Param headers', () => {
  it.each([
    ['literal', 'literal'],
    ['internal space', 'internal space'],
    ['internal\ttab', 'internal\ttab'],
    ['', '=?base64??='],
    ['Hello, 世界', '=?base64?SGVsbG8sIOS4lueVjA==?='],
    [' padded ', '=?base64?IHBhZGRlZCA=?='],
    ['\tvalue', '=?base64?CXZhbHVl?='],
    ['line\r\nbreak', '=?base64?bGluZQ0KYnJlYWs=?='],
    ['control\u0001', '=?base64?Y29udHJvbAE=?='],
    ['=?base64?SGVsbG8=?=', '=?base64?PT9iYXNlNjQ/U0dWc2JHOD0/PQ==?='],
  ])('encodes %j without HTTP normalization or sentinel ambiguity', (value, expected) => {
    expect(headers(value)).toEqual({ 'Mcp-Param-Value': expected });
  });

  it.each([
    [42, 'integer', '42'],
    [-10, 'integer', '-10'],
    [Number.MAX_SAFE_INTEGER, 'integer', String(Number.MAX_SAFE_INTEGER)],
    [Number.MIN_SAFE_INTEGER, 'integer', String(Number.MIN_SAFE_INTEGER)],
    [false, 'boolean', 'false'],
    [true, 'boolean', 'true'],
  ])('encodes primitive %j as its declared %s type', (value, type, expected) => {
    expect(headers(value, type)).toEqual({ 'Mcp-Param-Value': expected });
  });

  it.each([
    [undefined, 'string'],
    [null, 'string'],
    [{}, 'string'],
    [[], 'string'],
    [false, 'string'],
    ['42', 'integer'],
  ])('omits absent, null, or incompatible primitive %j', (value, type) => {
    expect(headers(value, type)).toEqual({});
  });

  it.each([3.14, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1])(
    'rejects an unsafe integer without including its value in the error',
    (value) => {
      try {
        headers(value, 'integer');
        expect.fail('Unsafe integer must reject');
      } catch (failure) {
        expect(failure).toEqual({
          kind: 'protocol',
          code: '-32602',
          message: 'Header integer parameter must be a safe integer',
        });
      }
    },
  );

  it('mirrors only statically reachable annotated properties, including nested properties', () => {
    const scan = scanMcpParamDeclarations({
      type: 'object',
      properties: {
        query: { type: 'string' },
        settings: { type: 'object', properties: { region: { type: 'string', 'x-mcp-header': 'Region' } } },
      },
    });
    expect(scan.valid).toBe(true);
    if (!scan.valid) return;
    expect(createMcpParamHeaders(scan.declarations, { query: 'private', settings: { region: 'us-west1' } })).toEqual({
      'Mcp-Param-Region': 'us-west1',
    });
  });

  it.each(['', 'bad name', 'bad:name', 'bad\r\nname', 'Bad\n', 'Bad\r', 'Bad\r\n', 'Bad\u2028', 'Bad\u2029'])(
    'rejects unsafe HTTP suffix %j',
    (name) => {
      expect(scanMcpParamDeclarations({ properties: { value: { type: 'string', 'x-mcp-header': name } } }).valid).toBe(
        false,
      );
    },
  );

  // The pinned header contract excludes number even though the SDK accepts that primitive schema type.
  it.each(['number', 'object', 'array', ['string', 'null'], null])('rejects unsupported schema type %j', (type) => {
    expect(
      scanMcpParamDeclarations(toJsonValue({ properties: { value: { type, 'x-mcp-header': 'Value' } } })).valid,
    ).toBe(false);
  });

  it('rejects case-insensitive duplicate suffixes at different nesting depths', () => {
    expect(
      scanMcpParamDeclarations({
        properties: {
          value: { type: 'string', 'x-mcp-header': 'Region' },
          nested: { properties: { value: { type: 'string', 'x-mcp-header': 'region' } } },
        },
      }).valid,
    ).toBe(false);
  });

  it.each([
    'items',
    'additionalItems',
    'contentSchema',
    'oneOf',
    'anyOf',
    'allOf',
    'not',
    'if',
    'additionalProperties',
    '$defs',
    'dependentSchemas',
    'dependencies',
  ])('rejects annotations beneath %s without following references', (keyword) => {
    const annotation = { properties: { value: { type: 'string', 'x-mcp-header': 'Value' } } };
    let sub: unknown = annotation;
    if (['oneOf', 'anyOf', 'allOf'].includes(keyword)) sub = [annotation];
    if (['$defs', 'dependentSchemas', 'dependencies'].includes(keyword)) sub = { child: annotation };
    expect(scanMcpParamDeclarations(toJsonValue({ [keyword]: sub })).valid).toBe(false);
  });

  it('ignores property dependency arrays and annotation data outside schema keywords', () => {
    const annotation = { properties: { value: { type: 'string', 'x-mcp-header': 'Value' } } };
    expect(
      scanMcpParamDeclarations({
        dependencies: { value: ['other'] },
        default: annotation,
        examples: [annotation],
        customMetadata: annotation,
      }),
    ).toEqual({ valid: true, declarations: [] });
  });

  it('does not read inherited argument properties', () => {
    const scan = scanMcpParamDeclarations({ properties: { toString: { type: 'string', 'x-mcp-header': 'Value' } } });
    if (!scan.valid) throw new Error(scan.reason);
    expect(createMcpParamHeaders(scan.declarations, {})).toEqual({});
  });
});
