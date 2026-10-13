import { JSON_VALUE_LIMITS, toJsonValue } from '@src/sdk/contracts/index.js';

import { captureCapabilityListResult } from './capabilityListCapture.js';

describe('capability list capture', () => {
  it('quarantines malformed template syntax without changing healthy siblings or opaque JSON', () => {
    const healthy = {
      name: 'healthy',
      uriTemplate: 'file:///{path}{?query*}',
      _meta: { 'example.com/data': [null, { unknown: true }] },
      extensions: { 'example.com/future': { opaque: 1 } },
    };
    const result = {
      resourceTemplates: [
        healthy,
        { name: 'broken', uriTemplate: 'file:///{' },
        { name: 'other', uriTemplate: 'test:///{x}' },
      ],
      nextCursor: 'next',
      extra: { unknown: true },
    };
    expect(captureCapabilityListResult('resources/templates/list', result)).toEqual({
      ...result,
      resourceTemplates: [healthy, null, result.resourceTemplates[2]],
    });
    expect(result.resourceTemplates[1]).toEqual({ name: 'broken', uriTemplate: 'file:///{' });
  });

  it.each(['file:///{path}', 'file:///{+path}', 'file:///{path:3}', 'file:///{?query*}', 'file:///literal%2Fpath'])(
    'preserves supported template %s verbatim',
    (uriTemplate) => {
      const result = { resourceTemplates: [{ name: 'template', uriTemplate, unknown: [{ nested: true }] }] };
      const captured = captureCapabilityListResult('resources/templates/list', result);
      expect(captured).toEqual(result);
      expect(captured).not.toBe(result);
    },
  );

  it('leaves structural validation to per-object catalog capture', () => {
    const result = { resourceTemplates: [null, 1, {}, { uriTemplate: false }] };
    expect(captureCapabilityListResult('resources/templates/list', result)).toEqual(result);
  });

  it('does not interpret template-shaped unknown fields in other operation results', () => {
    const result = { resourceTemplates: [{ uriTemplate: 'file:///{' }] };
    expect(captureCapabilityListResult('tools/list', result)).toEqual(result);
  });

  it('captures a SmartSheet-sized tool list above the default JSON node limit', () => {
    const makeTool = (index: number) => ({
      name: `tool_${index}`,
      description: 'An upstream SmartSheet tool',
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: 73 }, (_, propertyIndex) => [
            `parameter_${propertyIndex}`,
            { type: 'string', description: 'A parameter' },
          ]),
        ),
      },
    });
    const result = { tools: Array.from({ length: 49 }, (_, index) => makeTool(index)) };

    expect(() => toJsonValue(result, JSON_VALUE_LIMITS)).toThrow('node limit');
    const captured = captureCapabilityListResult('tools/list', result);
    expect(captured).toEqual(result);
    expect(captured).not.toBe(result);
  });

  it('honors an explicit smaller limit for capability lists', () => {
    const result = { tools: [{ name: 'tool' }] };
    const limits = { ...JSON_VALUE_LIMITS, maxNodes: 1 };

    expect(() => captureCapabilityListResult('tools/list', result, limits)).toThrow('node limit');
  });

  it('keeps tool-call results under the ordinary JSON node limit', () => {
    const result = { content: Array.from({ length: JSON_VALUE_LIMITS.maxNodes }, () => null) };

    expect(() => captureCapabilityListResult('tools/call', result)).toThrow('node limit');
  });
});
