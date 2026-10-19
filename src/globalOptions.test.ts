import { globalOptions, withGlobalOptions } from '@src/globalOptions.js';

import { describe, expect, it } from 'vitest';
import yargs from 'yargs';

describe('global CLI options', () => {
  it('registers once and survives repeated nested parses', async () => {
    const parser = withGlobalOptions(yargs([]).exitProcess(false).help().alias('help', 'h'));
    withGlobalOptions(parser);
    parser.command('group', 'A group', (group) =>
      withGlobalOptions(group).command('leaf', 'A leaf', (leaf) => withGlobalOptions(leaf)),
    );

    for (let attempt = 0; attempt < 2; attempt++) {
      let output = '';
      await parser.parseAsync(['group', 'leaf', '-h'], {}, (_error, _argv, text) => {
        output = text;
      });
      expect(output).toContain('-c, --config');
      expect(output).not.toContain('-c, -c');
      expect(output.match(/"debug"/g)).toHaveLength(1);
      expect(output.match(/Global options:/g)).toHaveLength(1);
    }
  });

  it('accepts inherited global flags before and after a subcommand', async () => {
    const parser = withGlobalOptions(yargs([]).exitProcess(false).strict()).command('leaf', 'A leaf');
    for (const args of [
      ['--config', 'test.json', 'leaf'],
      ['leaf', '-c', 'test.json'],
    ]) {
      expect((await parser.parseAsync(args)).config).toBe('test.json');
    }
  });
});

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
