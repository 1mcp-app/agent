import { describe, expect, it } from 'vitest';

import { isLoopbackHost, resolveTemplateContextTrust } from './templateContextTrust.js';

describe('serve template context trust', () => {
  it('uses CLI over TOML and defaults to verified', () => {
    expect(
      resolveTemplateContextTrust({
        cliTrust: 'disabled',
        configTrust: 'legacy',
        host: '127.0.0.1',
        confirmUntrusted: false,
        transport: 'http',
      }),
    ).toBe('disabled');
    expect(
      resolveTemplateContextTrust({
        host: '127.0.0.1',
        confirmUntrusted: false,
        transport: 'http',
      }),
    ).toBe('verified');
  });

  it('requires explicit confirmation for legacy trust on a non-loopback HTTP host', () => {
    expect(() =>
      resolveTemplateContextTrust({
        configTrust: 'legacy',
        host: '0.0.0.0',
        confirmUntrusted: false,
        transport: 'http',
      }),
    ).toThrow(/--confirm-untrusted-template-context/);

    expect(
      resolveTemplateContextTrust({
        configTrust: 'legacy',
        host: '0.0.0.0',
        confirmUntrusted: true,
        transport: 'http',
      }),
    ).toBe('legacy');
  });

  it('recognizes loopback host forms', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.1.2.3')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
  });
});
