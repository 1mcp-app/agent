import { SchemaBoundary } from '@src/core/validation/schemaBoundary.js';
import { captureJson, SCHEMA_LIMITS } from '@src/core/validation/schemaPolicy.js';
import { JSON_VALUE_LIMITS, type JsonObject, RESPONSE_JSON_VALUE_LIMITS } from '@src/sdk/contracts/index.js';

import { captureCapabilityListResult } from './capabilityListCapture.js';
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

describe('tool result projection budget', () => {
  it('captures within a budget no tighter than the schema boundary tool output budget', () => {
    expect(RESPONSE_JSON_VALUE_LIMITS.maxDepth).toBeGreaterThanOrEqual(SCHEMA_LIMITS.depth);
    expect(RESPONSE_JSON_VALUE_LIMITS.maxNodes).toBeGreaterThanOrEqual(SCHEMA_LIMITS.instanceNodes);
    expect(RESPONSE_JSON_VALUE_LIMITS.maxTotalStringLength).toBeGreaterThanOrEqual(SCHEMA_LIMITS.outputBytes);
  });

  // tool_invoke returns the upstream result as both pretty-printed text and structuredContent.
  const toolInvokeResult = (blobLength: number) => {
    const result = {
      result: {
        content: [
          { type: 'text', text: 'file of image.png' },
          {
            type: 'resource',
            resource: { uri: 'file:///image.png', mimeType: 'image/png', blob: 'A'.repeat(blobLength) },
          },
        ],
      },
      server: 'files',
      tool: 'read_file',
    };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
  };

  it.each([
    ['legacy', projectLegacyToolResult],
    ['canonical', projectCanonicalToolResult],
  ])('projects %s tool_invoke results whose duplicated strings exceed the default JSON budget', (_label, project) => {
    const result = toolInvokeResult(JSON_VALUE_LIMITS.maxTotalStringLength / 2 + 1);

    expect(() => captureJson(result, false, true)).not.toThrow();
    expect(project(result)).toMatchObject(result);
  });

  it('counts the output budget in UTF-8 bytes while capture counts characters', () => {
    const text = '\u20ac'.repeat(Math.floor(SCHEMA_LIMITS.outputBytes / 3) + 1);
    const result = { content: [{ type: 'text', text }] };

    expect(text.length).toBeLessThan(SCHEMA_LIMITS.outputBytes);
    expect(captureCapabilityListResult('tools/call', result)).toEqual(result);
    expect(() => captureJson(result, false, true)).toThrow('schema_budget_exceeded');
  });

  it('leaves the size failure to the schema boundary output budget', () => {
    const result = toolInvokeResult(SCHEMA_LIMITS.outputBytes / 2);

    expect(() => captureJson(result, false, true)).toThrow('schema_budget_exceeded');
    expect(() => projectLegacyToolResult(result)).not.toThrow();
  });
});
