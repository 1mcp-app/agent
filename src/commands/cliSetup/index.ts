import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

export function setupCliSetupCommand(yargs: Argv): Argv {
  return yargs.command(
    'cli-setup',
    'Install 1MCP CLI hooks and reference files for Codex and Claude',
    (commandYargs) =>
      commandYargs
        .options(globalOptions || {})
        .option('scope', {
          describe: 'Setup scope',
          type: 'string',
          choices: ['global', 'repo', 'all'],
          default: 'global',
        })
        .option('codex', {
          describe: 'Install setup files for Codex only',
          type: 'boolean',
          default: false,
        })
        .option('claude', {
          describe: 'Install setup files for Claude only',
          type: 'boolean',
          default: false,
        })
        .option('repo-root', {
          describe: 'Repository root used for repo-scoped setup',
          type: 'string',
        })
        .check((argv) => {
          const selected = [argv.codex, argv.claude].filter(Boolean);
          if (selected.length === 0) {
            throw new Error('Specify exactly one client: use `--codex` or `--claude`.');
          }
          if (selected.length > 1) {
            throw new Error('Specify only one client at a time: use either `--codex` or `--claude`.');
          }
          return true;
        })
        .example('$0 cli-setup --codex', 'Install global Codex hooks and reference files')
        .example(
          '$0 cli-setup --claude --scope repo --repo-root .',
          'Install repo-local Claude hooks and reference files',
        )
        .example('$0 cli-setup --codex --scope all', 'Install global and repo-local Codex setup')
        .epilogue(
          'This command writes hook config and lightweight startup-file references. Errors are written to stderr only.',
        ),
    async (argv) => {
      const { configureGlobalLogger } = await import('@src/logger/configureGlobalLogger.js');
      const { cliSetupCommand } = await import('./cliSetup.js');

      configureGlobalLogger(argv, 'stdio');
      try {
        await cliSetupCommand(argv as Parameters<typeof cliSetupCommand>[0]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
      }
    },
  );
}
