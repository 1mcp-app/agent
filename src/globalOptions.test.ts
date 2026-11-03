import { globalOptions, withGlobalOptions } from '@src/globalOptions.js';

import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('does not expose project selectors globally', () => {
    expect(globalOptions).not.toHaveProperty('project');
    expect(globalOptions).not.toHaveProperty('project-set');
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

describe('test suppression CLI boundary', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps explicit launcher suppression despite a command-line false', async () => {
    vi.stubEnv('ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED', 'true');
    let observed: unknown;
    const parser = withGlobalOptions(yargs([]).env('ONE_MCP').exitProcess(false).strict()).command(
      'probe',
      'fixture',
      () => {},
      (argv) => {
        observed = argv['product-telemetry-test-suppressed'];
      },
    );
    await parser.parseAsync(['probe', '--product-telemetry-test-suppressed=false']);
    expect(observed).toBe(true);
  });

  it('does not infer suppression from generic test or CI variables', async () => {
    vi.stubEnv('ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED', 'false');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('TEST_MODE', 'true');
    vi.stubEnv('CI', 'true');
    expect(
      (await withGlobalOptions(yargs([]).env('ONE_MCP').exitProcess(false)).parseAsync([]))[
        'product-telemetry-test-suppressed'
      ],
    ).toBe(false);
  });
});

describe('typed product telemetry options', () => {
  it.each([
    ['--product-telemetry=true', true],
    ['--product-telemetry=false', false],
    ['--no-product-telemetry', false],
    ['--product-telemetry=1', true],
    ['--product-telemetry=no', false],
  ])('parses %s', async (arg, enabled) => {
    expect((await withGlobalOptions(yargs([]).exitProcess(false)).parseAsync([arg]))['product-telemetry']).toBe(
      enabled,
    );
  });
  it('rejects invalid option values', async () => {
    expect(() =>
      withGlobalOptions(
        yargs([])
          .exitProcess(false)
          .fail((message, error) => {
            throw error ?? new Error(message);
          }),
      ).parseSync(['--product-telemetry=maybe']),
    ).toThrow('boolean');
  });
});
