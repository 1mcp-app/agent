import { SchemaBoundary } from '@src/core/validation/schemaBoundary.js';
import type { JsonObject } from '@src/sdk/contracts/index.js';

import { projectCanonicalToolResult, projectLegacyToolResult, projectLegacyTools } from './schemaProjection.js';

describe('official codec schema journeys across four era combinations', () => {
  it.each(
    ['legacy', 'modern'].flatMap((source) => ['legacy', 'modern'].map((destination) => ({ source, destination }))),
  )('$source upstream to $destination inbound preserves the evaluated contract', async ({ source, destination }) => {
    const boundary = new SchemaBoundary(1);
    try {
      const schema: JsonObject =
        source === 'modern'
          ? { type: 'array', items: { $ref: '#/$defs/n' }, $defs: { n: { type: 'integer' } } }
          : {
              type: 'object',
              properties: { result: { type: 'array', items: { $ref: '#/$defs/n' } } },
              required: ['result'],
              $defs: { n: { type: 'integer' } },
            };
      const natural = source === 'modern' ? [2] : { result: [2] };
      const binding = { routeKey: 'server/tool', generation: '1', profile: 'tool-output' as const };
      const sourceContract = await boundary.admit(schema, binding);
      expect(await boundary.evaluate(sourceContract, natural, binding)).toEqual({ valid: true });
      const listed = { tools: [{ name: 'tool', inputSchema: { type: 'object' }, outputSchema: schema }] };
      const projected = destination === 'legacy' ? projectLegacyTools(listed) : listed;
      const result = (destination === 'legacy' ? projectLegacyToolResult : projectCanonicalToolResult)(
        { content: [], structuredContent: natural },
        schema,
      );
      const advertised = (projected.tools as JsonObject[])[0].outputSchema;
      const destinationContract = await boundary.admit(advertised, binding);
      expect(await boundary.evaluate(destinationContract, result.structuredContent, binding)).toEqual({ valid: true });
      expect(natural).toEqual(source === 'modern' ? [2] : { result: [2] });
      if (source === 'modern' && destination === 'legacy') {
        expect(result.structuredContent).toEqual({ result: [2] });
        expect(JSON.stringify(advertised)).toContain('#/properties/result/$defs/n');
      }
      if (source === 'legacy') expect(result.structuredContent).toEqual({ result: [2] });
      if (source === 'modern') expect(result.content).toEqual([{ type: 'text', text: '[2]' }]);
    } finally {
      await boundary.shutdown();
    }
  });
});

it('does not accept malformed canonical content when bypassing the private v1 shape wrapper', () => {
  expect(() =>
    projectCanonicalToolResult({ content: [{ type: 'text', text: 42 }], structuredContent: [2] }, { type: 'array' }),
  ).toThrow('schema_output_invalid');
  expect(() => projectCanonicalToolResult({ content: [], resultType: 'input_required' })).toThrow(
    'schema_output_invalid',
  );
});
