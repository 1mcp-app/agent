import { runCliCommand } from '@src/commands/shared/commandRunner.js';
import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

export function setupAdminCommands(yargs: Argv): Argv {
  return yargs.command(
    'admin <subcommand>',
    'Manage CLI Admin sessions for Runtime Target Contexts',
    (commandYargs) => {
      commandYargs
        .command(
          'login',
          'Create a CLI Admin session for a Runtime Target Context',
          (sub) =>
            sub
              .options(globalOptions || {})
              .option('context', {
                describe: 'Runtime Target Context name',
                type: 'string',
              })
              .option('url', {
                describe: 'Unsupported for admin credential commands; use --context',
                type: 'string',
              })
              .option('username', {
                describe: 'Admin username',
                type: 'string',
              })
              .option('password', {
                describe: 'Admin password',
                type: 'string',
              })
              .option('json', {
                describe: 'Write machine-readable JSON output',
                type: 'boolean',
                default: false,
              }),
          async (argv) => {
            const { adminLoginCommand } = await import('./admin.js');
            await runCliCommand(argv as Parameters<typeof adminLoginCommand>[0], adminLoginCommand);
          },
        )
        .command(
          'status',
          'Show CLI Admin session status for a Runtime Target Context',
          (sub) =>
            sub
              .options(globalOptions || {})
              .option('context', {
                describe: 'Runtime Target Context name',
                type: 'string',
              })
              .option('url', {
                describe: 'Unsupported for admin credential commands; use --context',
                type: 'string',
              })
              .option('json', {
                describe: 'Write machine-readable JSON output',
                type: 'boolean',
                default: false,
              }),
          async (argv) => {
            const { adminStatusCommand } = await import('./admin.js');
            await runCliCommand(argv as Parameters<typeof adminStatusCommand>[0], adminStatusCommand);
          },
        )
        .command(
          'logout',
          'Revoke a CLI Admin session for a Runtime Target Context',
          (sub) =>
            sub
              .options(globalOptions || {})
              .option('context', {
                describe: 'Runtime Target Context name',
                type: 'string',
              })
              .option('url', {
                describe: 'Unsupported for admin credential commands; use --context',
                type: 'string',
              })
              .option('forget', {
                describe: 'Clear only the local Admin Session reference without confirming runtime revocation',
                type: 'boolean',
                default: false,
              })
              .option('json', {
                describe: 'Write machine-readable JSON output',
                type: 'boolean',
                default: false,
              }),
          async (argv) => {
            const { adminLogoutCommand } = await import('./admin.js');
            await runCliCommand(argv as Parameters<typeof adminLogoutCommand>[0], adminLogoutCommand);
          },
        )
        .demandCommand(1, 'Specify a subcommand: login, status, or logout');
    },
  );
}
