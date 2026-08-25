import { describe, expect, it } from 'vitest';

import { registryOptionsFromArgv } from './options.js';

describe('registryOptionsFromArgv', () => {
  it('maps the shared registry CLI surface to the domain contract', () => {
    expect(
      registryOptionsFromArgv({
        url: 'https://registry.example.test',
        timeout: 4321,
        'cache-ttl': 123,
        'cache-max-size': 456,
        'cache-cleanup-interval': 789,
        proxy: 'http://proxy.example.test',
        'proxy-auth': 'user:password',
      }),
    ).toEqual({
      url: 'https://registry.example.test',
      timeout: 4321,
      cacheTtl: 123,
      cacheMaxSize: 456,
      cacheCleanupInterval: 789,
      proxy: 'http://proxy.example.test',
      proxyAuth: 'user:password',
    });
  });

  it('preserves omitted values for shared default resolution', () => {
    expect(registryOptionsFromArgv({})).toEqual({
      url: undefined,
      timeout: undefined,
      cacheTtl: undefined,
      cacheMaxSize: undefined,
      cacheCleanupInterval: undefined,
      proxy: undefined,
      proxyAuth: undefined,
    });
  });
});
