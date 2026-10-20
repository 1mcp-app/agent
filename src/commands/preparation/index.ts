import { runCliCommand } from '@src/commands/shared/commandRunner.js';
import { withGlobalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

function options(yargs: Argv): Argv {
  return yargs
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
    })
    .option('format', { describe: 'Output format', choices: ['text', 'json'], type: 'string', default: 'text' });
}

export function setupPreparationCommands(yargs: Argv): Argv {
  const invoke = async (argv: unknown): Promise<void> => {
    const { preparationCommand } = await import('./preparation.js');
    await runCliCommand(argv as Parameters<typeof preparationCommand>[0], preparationCommand);
  };
  const start = (argv: unknown) => invoke({ ...(argv as object), action: 'prepare' });
  const controls = ['inspect', 'status', 'wait', 'cancel', 'retry'] as const;
  const jobOptions = (command: Argv) =>
    options(command)
      .positional('id', { type: 'string', describe: 'Preparation job id returned by project prepare or status' })
      .option('wait-ms', {
        type: 'number',
        describe: 'Bounded wait in milliseconds (wait only; runtime default when omitted)',
      });
  return withGlobalOptions(yargs).command('prepare', 'Prepare backends and manage jobs', (command) => {
    let family = command
      .command('$0 <backend>', 'Request preparation using runtime-owned permissions', options, start)
      .command(
        'start <backend>',
        'Request preparation, including for a backend named after a subcommand',
        options,
        start,
      );
    for (const action of controls) {
      let id = '[id]';
      if (action === 'inspect') id = '';
      if (action === 'wait' || action === 'cancel') id = '<id>';
      family = family.command(
        `${action} <backend> ${id}`.trim(),
        `${action} a runtime-owned preparation operation`,
        jobOptions,
        (argv) => invoke({ ...argv, action }),
      );
    }
    return family;
  });
}
