import { runCliCommand } from '@src/commands/shared/commandRunner.js';
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
        .example('$0 instructions', 'Show the CLI-mode agent playbook and current servers')
        .example('$0 instructions --tags backend', 'Show CLI instructions for a filtered backend server set')
        .example('$0 instructions --preset development', 'Show CLI instructions using a preset')
        .epilogue('This command requires a running `1mcp serve` instance. Errors are written to stderr only.'),
    async (argv) => {
      const { instructionsCommand } = await import('./instructions.js');
      await runCliCommand(argv as Parameters<typeof instructionsCommand>[0], instructionsCommand);
    },
  );
}
