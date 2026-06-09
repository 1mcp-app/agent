import { describe, expect, it } from 'vitest';

import { validateServerConfig } from './configParsingUtils.js';

describe('configParsingUtils', () => {
  it('rejects non-http urls for remote MCP transports', () => {
    expect(() =>
      validateServerConfig({
        type: 'http',
        url: 'file:///tmp/server',
      }),
    ).toThrow('Invalid URL format: file:///tmp/server');
  });
});
