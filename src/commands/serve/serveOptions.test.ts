import { describe, expect, it } from 'vitest';

import { parseCommaSeparatedList } from './serveOptions.js';

describe('serveOptions', () => {
  it('drops empty comma-separated entries', () => {
    expect(parseCommaSeparatedList('web,, api, ,db')).toEqual(['web', 'api', 'db']);
  });
});
