import { describe, expect, it } from 'vitest';

import { globalOptions } from './globalOptions.js';

describe('globalOptions', () => {
  it('does not expose registry command options globally', () => {
    const registryGlobalOptions = [
      'registry-url',
      'registry-timeout',
      'registry-cache-ttl',
      'registry-cache-max-size',
      'registry-cache-cleanup-interval',
      'registry-proxy',
      'registry-proxy-auth',
    ];

    expect(Object.keys(globalOptions)).not.toEqual(expect.arrayContaining(registryGlobalOptions));
  });
});
