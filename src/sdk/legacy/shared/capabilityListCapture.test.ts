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
});
