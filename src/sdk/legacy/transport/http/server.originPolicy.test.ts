import { describe, expect, it } from 'vitest';

import { createModernHttpRequestPolicy } from './server.js';

function config(values: { externalUrl?: string; host: string }) {
  return {
    get: (key: 'externalUrl' | 'host') => values[key],
  } as never;
}

describe('configured modern HTTP origin policy', () => {
  it('allows the exact normalized external origin independently from host allowlisting', () => {
    const policy = createModernHttpRequestPolicy(
      config({ externalUrl: 'https://MCP.Example.com:8443/api', host: '0.0.0.0' }),
    );

    expect(policy.allowsHost('mcp.example.com:8443')).toBe(true);
    expect(policy.allowsOrigin('https://mcp.example.com:8443', 'mcp.example.com:8443')).toBe(true);
  });

  it.each(['http://mcp.example.com:8443', 'https://mcp.example.com:9443'])(
    'rejects the same hostname with a different configured scheme or port: %s',
    (origin) => {
      const policy = createModernHttpRequestPolicy(
        config({ externalUrl: 'https://mcp.example.com:8443/api', host: '0.0.0.0' }),
      );

      expect(policy.allowsHost('mcp.example.com:8443')).toBe(true);
      expect(policy.allowsOrigin(origin, 'mcp.example.com:8443')).toBe(false);
    },
  );

  it('normalizes a default configured port before comparing origins', () => {
    const policy = createModernHttpRequestPolicy(
      config({ externalUrl: 'https://mcp.example.com:443/api', host: '0.0.0.0' }),
    );

    expect(policy.allowsOrigin('https://mcp.example.com', 'mcp.example.com')).toBe(true);
  });
});
