import { describe, expect, it } from 'vitest';

import { validateToolArgs } from './runUtils.js';

describe('CLI schema preflight', () => {
  it('awaits isolated validation and never prints schema or arguments on failure', async () => {
    const schema = {
      type: 'object',
      required: ['secret'],
      properties: { secret: { type: 'string', const: 'private-schema-value' } },
    };
    expect(await validateToolArgs({ secret: 'private-schema-value' }, schema, 'server/tool')).toEqual({ valid: true });
    const failure = await validateToolArgs({ secret: 'private-input-value' }, schema, 'server/tool');
    expect(failure).toEqual({ valid: false, errorMessage: 'schema_input_invalid' });
    expect(JSON.stringify(failure)).not.toContain('private');
  });
});
