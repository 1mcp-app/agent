import { fromJsonSchema } from '@modelcontextprotocol/server';

import { toolHeaderProjectionValidator } from './modernToolHeaderRegistry.js';

describe('modern tool header schema projection', () => {
  it('never compiles a provider schema and fails closed if asked to evaluate it', () => {
    // An invalid regular expression would make the SDK's default AJV compiler throw.
    const schema = { type: 'object', properties: { value: { type: 'string', pattern: '(' } } };
    const projected = fromJsonSchema(schema, toolHeaderProjectionValidator);
    expect(projected['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toBe(schema);
    expect(() => projected['~standard'].validate({ value: 'anything' })).toThrow(
      'Tool schema evaluation requires the gateway schema boundary',
    );
    expect(() => toolHeaderProjectionValidator.getValidator(schema)({ value: 'anything' })).toThrow(
      'Tool schema evaluation requires the gateway schema boundary',
    );
  });
});
