import { withProjectSelectionOptions } from '@src/commands/shared/projectSelectionOptions.js';
import { withGlobalOptions } from '@src/globalOptions.js';
import { runProductCommand } from '@src/productTelemetry/commandScope.js';

import type { Argv } from 'yargs';

export function setupBootstrapCommand(yargs: Argv): Argv {
  return withGlobalOptions(yargs).command(
    'bootstrap',
    'Deliver agent hook instructions',
    (command) =>
      withProjectSelectionOptions(command)
        .env(false)

        .option('client', { type: 'string', choices: ['codex', 'claude'], demandOption: true })
        .option('event', {
          type: 'string',
          choices: ['SessionStart', 'SubagentStart', 'SessionEnd'],
          demandOption: true,
        })
        .option('url', { type: 'string', describe: 'Runtime URL' })
        .option('context', { type: 'string', describe: 'Named Runtime Target Context' })
        .option('preset', { type: 'string' })
        .option('tags', { type: 'array', string: true })
        .option('tag-filter', { type: 'string' })
        .epilogue(
          'Worker assignments come from dispatch instructions, never parent cwd or session identity. Disabled or untrusted hooks remain a delivery coverage gap.',
        ),
    async (argv) => {
      return runProductCommand('project', async () => {
        const { bootstrapCommand } = await import('./bootstrap.js');
        await bootstrapCommand(argv as Parameters<typeof bootstrapCommand>[0]);
      });
    },
  );
}
