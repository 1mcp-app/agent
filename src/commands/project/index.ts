import { setupPreparationCommands } from '@src/commands/preparation/index.js';
import { runCliCommand } from '@src/commands/shared/commandRunner.js';
import { withProjectSelectionOptions } from '@src/commands/shared/projectSelectionOptions.js';
import { withGlobalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

export function setupProjectCommands(yargs: Argv): Argv {
  return withGlobalOptions(yargs).command('project', 'Manage project checkouts', (command) => {
    let family = setupPreparationCommands(command);
    for (const action of ['release', 'drain', 'status', 'resume', 'recover'] as const) {
      family = family.command(
        action,
        `${action} selected checkout runtime resources`,
        (builder) => {
          if (action === 'recover') return builder;
          const selected = withProjectSelectionOptions(builder)
            .option('url', { type: 'string', describe: 'Runtime URL' })
            .option('context', { type: 'string', describe: 'Named Runtime Target Context' })
            .option('expected-runtime-scope', { type: 'string', hidden: true })
            .option('terminal-cleanup', { type: 'boolean', hidden: true })
            .option('preset', { type: 'string', describe: 'Runtime filter preset' })
            .option('tags', { type: 'array', string: true, describe: 'Runtime tag filter' })
            .option('tag-filter', { type: 'string', describe: 'Advanced tag filter' })
            .option('format', {
              type: 'string',
              choices: ['text', 'json'],
              default: 'text',
              describe: 'Output format',
            });
          if (action !== 'drain') return selected;
          return selected.option('wait-ms', {
            type: 'number',
            describe: 'Drain wait budget, 0–60000 ms; timeout keeps admission closed',
          });
        },
        async (argv) => {
          const { projectCommand } = await import('./project.js');
          await runCliCommand({ ...argv, action } as Parameters<typeof projectCommand>[0], projectCommand);
        },
      );
    }
    return family.demandCommand(1, 'Please specify a project subcommand');
  });
}
