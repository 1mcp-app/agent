import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

export function setupAuthCommands(yargs: Argv): Argv {
  return yargs.command(
    'auth <subcommand>',
    'Manage authentication profiles for secured 1MCP serve instances',
    (commandYargs) => {
      commandYargs
        .command(
          'login',
          'Save a bearer token for a 1MCP server URL',
          (sub) =>
            sub
              .options(globalOptions || {})
              .option('url', {
                alias: 'u',
                describe: '1MCP server URL (auto-detected if omitted)',
                type: 'string',
              })
              .option('token', {
                alias: 't',
                describe: 'Bearer token (reads from stdin if omitted)',
                type: 'string',
              }),
          async (argv) => {
            const { configureGlobalLogger } = await import('@src/logger/configureGlobalLogger.js');
            const { authLoginCommand } = await import('./login.js');
            configureGlobalLogger(argv, 'stdio');
            try {
              await authLoginCommand(argv as Parameters<typeof authLoginCommand>[0]);
            } catch (error) {
              process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
              process.exit(1);
            }
          },
        )
        .command(
          'status',
          'Show saved authentication profiles',
          (sub) =>
            sub.options(globalOptions || {}).option('url', {
              alias: 'u',
              describe: 'Check a specific server URL',
              type: 'string',
            }),
          async (argv) => {
            const { configureGlobalLogger } = await import('@src/logger/configureGlobalLogger.js');
            const { authStatusCommand } = await import('./status.js');
            configureGlobalLogger(argv, 'stdio');
            try {
              await authStatusCommand(argv as Parameters<typeof authStatusCommand>[0]);
            } catch (error) {
              process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
              process.exit(1);
            }
          },
        )
        .command(
          'logout',
          'Remove a saved authentication profile',
          (sub) =>
            sub
              .options(globalOptions || {})
              .option('url', {
                alias: 'u',
                describe: 'Server URL to remove',
                type: 'string',
              })
              .option('all', {
                describe: 'Remove all saved profiles',
                type: 'boolean',
                default: false,
              }),
          async (argv) => {
            const { configureGlobalLogger } = await import('@src/logger/configureGlobalLogger.js');
            const { authLogoutCommand } = await import('./logout.js');
            configureGlobalLogger(argv, 'stdio');
            try {
              await authLogoutCommand(argv as Parameters<typeof authLogoutCommand>[0]);
            } catch (error) {
              process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
              process.exit(1);
            }
          },
        )
        .demandCommand(1, 'Specify a subcommand: login, status, or logout');
    },
  );
}
