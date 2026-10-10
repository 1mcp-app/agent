import { runCliCommand } from '@src/commands/shared/commandRunner.js';
import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

function options(yargs: Argv): Argv {
  return yargs
    .options(globalOptions)
    .positional('backend', {
      describe: 'Configured backend name (available even before tool discovery)',
      type: 'string',
    })
    .option('url', { describe: 'Override detected Aggregated Runtime URL', type: 'string' })
    .option('context', { describe: 'Named Runtime Target Context', type: 'string' })
    .option('preset', { describe: 'Filter the runtime with a preset', type: 'string' })
    .option('tag-filter', { describe: 'Advanced tag filter expression', type: 'string' })
    .option('tags', { describe: 'Simple comma-separated tags', type: 'array', string: true })
    .option('operation', {
      describe: 'Operation-specific readiness to inspect or prepare',
      type: 'string',
      default: 'query',
    })
    .option('format', { describe: 'Output format', choices: ['text', 'json'], type: 'string', default: 'text' });
}

export function setupPreparationCommands(yargs: Argv): Argv {
  const invoke = async (argv: unknown): Promise<void> => {
    const { preparationCommand } = await import('./preparation.js');
    await runCliCommand(argv as Parameters<typeof preparationCommand>[0], preparationCommand);
  };
  return yargs
    .command(
      'prepare <backend>',
      'Explicitly prepare a selected checkout using runtime-owned permissions',
      options,
      (argv) => invoke({ ...argv, action: 'prepare' }),
    )
    .command(
      'preparation <action> <backend> [id]',
      'Inspect, wait, cancel, or retry a runtime-owned preparation operation',
      (command) =>
        options(command)
          .positional('action', { type: 'string', choices: ['status', 'wait', 'cancel', 'retry'] })
          .positional('id', { type: 'string', describe: 'Preparation operation id returned by prepare or status' })
          .option('wait-ms', {
            type: 'number',
            describe: 'Bounded wait in milliseconds (runtime default when omitted)',
          }),
      invoke,
    );
}
