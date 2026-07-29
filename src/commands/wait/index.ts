import { runCliCommand } from '@src/commands/shared/commandRunner.js';
import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

export function setupWaitCommand(yargs: Argv): Argv {
  return yargs.command(
    'wait [server]',
    'Wait for configured static MCP servers to become connected',
    (commandYargs) =>
      commandYargs
        .options(globalOptions || {})
        .positional('server', { describe: 'Configured static server to wait for', type: 'string' })
        .option('url', { alias: 'u', describe: 'Override auto-detected 1MCP server URL', type: 'string' })
        .option('context', { describe: 'Use a named Runtime Target Context', type: 'string' })
        .option('preset', { alias: 'p', describe: 'Filter the running server with a preset', type: 'string' })
        .option('tag-filter', { alias: 'f', describe: 'Apply an advanced tag filter expression', type: 'string' })
        .option('tags', { describe: 'Apply simple comma-separated tags', type: 'array', string: true })
        .option('timeout', { describe: 'Maximum wait time in milliseconds', type: 'number', default: 30_000 })
        .option('format', { describe: 'Output format', type: 'string', choices: ['toon', 'text', 'json'] })
        .example('$0 wait', 'Wait for all matching configured static servers')
        .example('$0 wait filesystem --timeout 60000', 'Wait for one configured static server'),
    async (argv) => {
      const { waitCommand } = await import('./wait.js');
      await runCliCommand(argv as Parameters<typeof waitCommand>[0], waitCommand);
    },
  );
}
