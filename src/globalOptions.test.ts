import { describe, expect, it } from 'vitest';
import yargs from 'yargs';

import { globalOptions } from './globalOptions.js';

describe('globalOptions', () => {
  it.each([{ args: [] }, { args: ['bootstrap'] }])(
    'leaves an absent project selector undefined for argv %j',
    ({ args }) => {
      expect(yargs(args).options(globalOptions).parseSync().project).toBeUndefined();
    },
  );

  it('parses repeated project selectors as labels', () => {
    const args = yargs(['--project', 'frontend', '--project', 'backend']).options(globalOptions).parseSync();
    expect(args.project).toEqual(['frontend', 'backend']);
  });

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
