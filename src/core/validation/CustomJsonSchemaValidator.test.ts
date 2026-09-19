import { describe, expect, it } from 'vitest';

import { CustomJsonSchemaValidator } from './CustomJsonSchemaValidator.js';

describe('subordinate synchronous SDK validator', () => {
  it('never compiles, mutates or claims unvalidated data is valid', () => {
    const schema = Object.freeze({ type: 'object', $ref: '#/missing' });
    const input = Object.freeze({ private: 'secret' });
    expect(new CustomJsonSchemaValidator().getValidator(schema)(input)).toEqual({
      valid: false,
      errorMessage: 'schema_evaluation_unavailable',
    });
  });
});
