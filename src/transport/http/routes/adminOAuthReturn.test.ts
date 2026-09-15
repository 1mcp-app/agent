import { describe, expect, it } from 'vitest';

import { trustedAdminReturnOrigin } from './adminRoutes.js';

describe('trusted Admin OAuth return origins', () => {
  it.each(['http://localhost:3050', 'http://127.0.0.1:3050', 'http://[::1]:3050'])(
    'accepts the configured loopback aliases: %s',
    (origin) => {
      expect(trustedAdminReturnOrigin(origin, 'http://127.0.0.1:3050')).toBe(origin);
    },
  );
  it.each([
    undefined,
    'null',
    'HTTP://localhost:3050',
    'http://localhost:3050/',
    'http://localhost:3050?redirect=evil',
    'http://localhost:3050#fragment',
    ' http://localhost:3050',
    'file://localhost:3050',
    'https://evil.example',
    'http://localhost:3051',
    'https://localhost:3050',
    'http://localhost:3050/evil',
    'http://user@localhost:3050',
    'http://localhost.evil.example:3050',
    'http://127.0.0.2:3050',
  ])('rejects untrusted or non-origin input: %s', (origin) => {
    expect(trustedAdminReturnOrigin(origin, 'http://127.0.0.1:3050')).toBeUndefined();
  });
  it('preserves an explicitly configured external origin without allowing loopback substitution', () => {
    expect(trustedAdminReturnOrigin('https://console.example', 'https://console.example')).toBe(
      'https://console.example',
    );
    expect(trustedAdminReturnOrigin('http://localhost', 'https://console.example')).toBeUndefined();
    expect(trustedAdminReturnOrigin('https://other.example', 'https://console.example')).toBeUndefined();
  });
});
