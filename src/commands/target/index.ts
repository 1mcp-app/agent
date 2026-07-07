import { runCliCommand } from '@src/commands/shared/commandRunner.js';
import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

export function setupTargetCommands(yargs: Argv): Argv {
  return yargs.command('target <subcommand>', 'Manage Runtime Target Contexts', (commandYargs) => {
    commandYargs
      .command(
        'add <name> <url>',
        'Add or replace a verified Runtime Target Context',
        (sub) =>
          sub
            .options(globalOptions || {})
            .positional('name', {
              describe: 'Runtime target context name',
              type: 'string',
            })
            .positional('url', {
              describe: 'Runtime base URL',
              type: 'string',
            })
            .option('use', {
              describe: 'Select the target after successful verification',
              type: 'boolean',
              default: false,
            })
            .option('display-name', {
              describe: 'Human display label for the target',
              type: 'string',
            })
            .option('replace', {
              describe: 'Replace metadata for an existing target after verification',
              type: 'boolean',
              default: false,
            })
            .option('accept-new-identity', {
              describe: 'Accept a runtimeScopeId change during replacement',
              type: 'boolean',
              default: false,
            }),
        async (argv) => {
          const { targetAddCommand } = await import('./target.js');
          await runCliCommand(argv as Parameters<typeof targetAddCommand>[0], targetAddCommand);
        },
      )
      .command(
        'use <name>',
        'Select the current Runtime Target Context',
        (sub) =>
          sub.options(globalOptions || {}).positional('name', {
            describe: 'Runtime target context name',
            type: 'string',
          }),
        async (argv) => {
          const { targetUseCommand } = await import('./target.js');
          await runCliCommand(argv as Parameters<typeof targetUseCommand>[0], targetUseCommand);
        },
      )
      .command(
        'current',
        'Show the effective current Runtime Target Context',
        (sub) => sub.options(globalOptions || {}),
        async (argv) => {
          const { targetCurrentCommand } = await import('./target.js');
          await runCliCommand(argv as Parameters<typeof targetCurrentCommand>[0], targetCurrentCommand);
        },
      )
      .command(
        'list',
        'List Runtime Target Contexts without contacting runtimes',
        (sub) => sub.options(globalOptions || {}),
        async (argv) => {
          const { targetListCommand } = await import('./target.js');
          await runCliCommand(argv as Parameters<typeof targetListCommand>[0], targetListCommand);
        },
      )
      .command(
        'inspect <name>',
        'Show detailed Runtime Target Context metadata',
        (sub) =>
          sub.options(globalOptions || {}).positional('name', {
            describe: 'Runtime target context name',
            type: 'string',
          }),
        async (argv) => {
          const { targetInspectCommand } = await import('./target.js');
          await runCliCommand(argv as Parameters<typeof targetInspectCommand>[0], targetInspectCommand);
        },
      )
      .command(
        'delete <name>',
        'Delete a stored Runtime Target Context',
        (sub) =>
          sub
            .options(globalOptions || {})
            .positional('name', {
              describe: 'Runtime target context name',
              type: 'string',
            })
            .option('force', {
              describe: 'Delete even when the target is current',
              type: 'boolean',
              default: false,
            }),
        async (argv) => {
          const { targetDeleteCommand } = await import('./target.js');
          await runCliCommand(argv as Parameters<typeof targetDeleteCommand>[0], targetDeleteCommand);
        },
      )
      .command(
        'rename <old> <new>',
        'Rename a stored Runtime Target Context',
        (sub) =>
          sub
            .options(globalOptions || {})
            .positional('old', {
              describe: 'Existing runtime target context name',
              type: 'string',
            })
            .positional('new', {
              describe: 'New runtime target context name',
              type: 'string',
            }),
        async (argv) => {
          const { targetRenameCommand } = await import('./target.js');
          await runCliCommand(argv as Parameters<typeof targetRenameCommand>[0], targetRenameCommand);
        },
      )
      .command(
        'verify <name>',
        'Verify Runtime Identity for a target',
        (sub) =>
          sub.options(globalOptions || {}).positional('name', {
            describe: 'Runtime target context name',
            type: 'string',
          }),
        async (argv) => {
          const { targetVerifyCommand } = await import('./target.js');
          await runCliCommand(argv as Parameters<typeof targetVerifyCommand>[0], targetVerifyCommand);
        },
      )
      .demandCommand(1, 'Specify a subcommand: add, use, current, list, inspect, delete, rename, or verify');
  });
}
