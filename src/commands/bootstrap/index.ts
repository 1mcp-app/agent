import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

export function setupBootstrapCommand(yargs: Argv): Argv {
  return yargs.command(
    'bootstrap',
    'Deliver bounded SessionStart or SubagentStart instructions to Codex or Claude hooks',
    (command) =>
      command
        .env(false)
        .options(globalOptions)
        .option('client', { type: 'string', choices: ['codex', 'claude'], demandOption: true })
        .option('event', { type: 'string', choices: ['SessionStart', 'SubagentStart'], demandOption: true })
        .option('project', {
          type: 'array',
          string: true,
          describe: 'Explicit absolute worker checkout, or selected labels with --project-set',
        })
        .option('project-set', { type: 'string', describe: 'Explicit absolute worker project-set definition path' })
        .option('url', { type: 'string', describe: 'Runtime URL' })
        .option('context', { type: 'string', describe: 'Named Runtime Target Context' })
        .option('preset', { type: 'string' })
        .option('tags', { type: 'array', string: true })
        .option('tag-filter', { type: 'string' })
        .epilogue(
          'Worker assignments come from dispatch instructions, never parent cwd or session identity. Disabled or untrusted hooks remain a delivery coverage gap.',
        ),
    async (argv) => {
      const { bootstrapCommand } = await import('./bootstrap.js');
      await bootstrapCommand(argv as Parameters<typeof bootstrapCommand>[0]);
    },
  );
}
