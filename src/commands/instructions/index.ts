import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

export function setupInstructionsCommand(yargs: Argv): Argv {
  return yargs.command(
    'instructions',
    'Show CLI-mode instructions for AI agents using a running 1MCP serve instance',
    (commandYargs) =>
      commandYargs
        .options(globalOptions || {})
        .option('url', {
          alias: 'u',
          describe: 'Override auto-detected 1MCP server URL',
          type: 'string',
        })
        .option('preset', {
          alias: 'p',
          describe: 'Use a preset when querying the running 1MCP server',
          type: 'string',
        })
        .option('tag-filter', {
          alias: 'f',
          describe: 'Apply an advanced tag filter expression',
          type: 'string',
        })
        .option('tags', {
          describe: 'Apply simple comma-separated tags',
          type: 'array',
          string: true,
        })
        .option('write-startup-docs', {
          describe: 'Write 1MCP bootstrap instructions to repo startup docs such as AGENTS.md and CLAUDE.md',
          type: 'boolean',
          default: false,
        })
        .option('repo-root', {
          describe: 'Repository root used when writing startup docs',
          type: 'string',
        })
        .option('targets', {
          describe: 'Comma-separated startup doc targets to write: agents,claude',
          type: 'string',
        })
        .example('$0 instructions', 'Show the CLI-mode agent playbook and current servers')
        .example('$0 instructions --tags backend', 'Show CLI instructions for a filtered backend server set')
        .example('$0 instructions --preset development', 'Show CLI instructions using a preset')
        .example(
          '$0 instructions --write-startup-docs --repo-root .',
          'Write the 1MCP bootstrap playbook into AGENTS.md and CLAUDE.md',
        )
        .epilogue(
          'This command requires a running `1mcp serve` instance unless `--write-startup-docs` is used. Errors are written to stderr only.',
        ),
    async (argv) => {
      const { configureGlobalLogger } = await import('@src/logger/configureGlobalLogger.js');
      const { instructionsCommand } = await import('./instructions.js');

      configureGlobalLogger(argv, 'stdio');
      try {
        await instructionsCommand(argv as Parameters<typeof instructionsCommand>[0]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
      }
    },
  );
}
