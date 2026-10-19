import { stripVTControlCharacters } from 'node:util';

import { serverOptions, setupServeCommand } from '@src/commands/serve/index.js';

import chalk from 'chalk';
import { describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { helpWidth, styleHelp } from './help.js';

describe('help presentation', () => {
  it('keeps server options visible after rendering compact root help on the same parser', async () => {
    const parser = setupServeCommand(
      yargs([])
        .exitProcess(false)
        .help()
        .example('$0 serve', 'Start the HTTP server')
        .epilogue('Run 1mcp serve --help for all server options.')
        .command('$0', 'Default server', (command) =>
          command.options(serverOptions).group(Object.keys(serverOptions), 'Server options:'),
        ),
    );
    const outputs: string[] = [];
    for (const args of [['--help'], ['serve', '--help'], ['--help']]) {
      await parser.parseAsync(args, {}, (_error, _argv, text) => {
        outputs.push(styleHelp(text, false, 80));
      });
    }
    expect(outputs[0]).not.toContain('--async-max-retries');
    expect(outputs[1]).toContain('--async-max-retries');
    expect(outputs[1]).toContain('Loading:');
    expect(outputs[2]).not.toContain('--async-max-retries');
    expect(outputs[2]).toBe(outputs[0]);
  });
  it('stacks narrow help without splitting long flag names', async () => {
    const text = await yargs([])
      .wrap(null)
      .option('confirm-untrusted-template-context', {
        type: 'boolean',
        describe: 'Confirm legacy template context trust when listening on a non-loopback host',
        default: false,
      })
      .getHelp();
    const narrow = styleHelp(text, false, 60);
    expect(narrow).toContain('  --confirm-untrusted-template-context\n    Confirm');
    expect(narrow).toContain('[default: false]');
    expect(narrow.split('\n').every((line) => line.length <= 60)).toBe(true);
  });
  it('uses the terminal width up to 100 columns and 80 for pipes', () => {
    expect(helpWidth({ isTTY: true, columns: 60 })).toBe(60);
    expect(helpWidth({ isTTY: true, columns: 80 })).toBe(80);
    expect(helpWidth({ isTTY: true, columns: 120 })).toBe(100);
    expect(helpWidth({ isTTY: false, columns: 120 })).toBe(80);
    expect(helpWidth({ isTTY: true })).toBe(80);
  });

  it('reflows unwrapped cached help for redirected error output', () => {
    const text =
      'Options:\n  --confirm-untrusted-template-context  Confirm legacy template context trust when listening on a non-loopback host  [boolean]';
    const result = styleHelp(text, false, 80);
    expect(result).toContain('--confirm-untrusted-template-context');
    expect(result.split('\n').every((line) => line.length <= 80)).toBe(true);
  });

  it('styles headings and commands without changing text or spacing', () => {
    const previous = chalk.level;
    chalk.level = 1;
    vi.stubEnv('NO_COLOR', undefined);
    try {
      const text = 'Commands:\n  1mcp serve  Start the server\n\nGlobal options:\n  -h, --help  Show help';
      const styled = styleHelp(text, true);
      expect(styled).toContain('\u001b[36m');
      expect(styled).toContain('\u001b[1m1mcp serve');
      expect(styleHelp(text, false)).toBe(text);
      expect(stripVTControlCharacters(styled)).toBe(text);
    } finally {
      chalk.level = previous;
      vi.unstubAllEnvs();
    }
  });

  it('honors NO_COLOR even when the terminal supports color', () => {
    const previous = chalk.level;
    chalk.level = 1;
    vi.stubEnv('NO_COLOR', '1');
    try {
      expect(styleHelp('Commands:\n  1mcp serve', true, 80)).toBe('Commands:\n  1mcp serve');
    } finally {
      chalk.level = previous;
      vi.unstubAllEnvs();
    }
  });
});
