import { withGlobalOptions } from '@src/globalOptions.js';
import { runProductCommand } from '@src/productTelemetry/commandScope.js';

import type { Argv } from 'yargs';

import type { CreateArguments } from './create.js';
import { buildCreateCommand } from './create.js';
import type { DeleteArguments } from './delete.js';
import { buildDeleteCommand } from './delete.js';
// Import argument types for type safety
import type { EditArguments } from './edit.js';
// Import builder functions from command implementations
import { buildEditCommand } from './edit.js';
import type { InteractiveArguments } from './interactive.js';
import type { ListArguments } from './list.js';
import { buildListCommand } from './list.js';
import type { ShowArguments } from './show.js';
import { buildShowCommand } from './show.js';
import type { TestArguments } from './test.js';
import { buildTestCommand } from './test.js';
import type { UrlArguments } from './url.js';
import { buildUrlCommand } from './url.js';

/**
 * Setup preset command configuration for yargs
 */
export function setupPresetCommands(yargs: Argv): Argv {
  return withGlobalOptions(yargs).command(
    'preset',
    'Manage server filtering presets',
    (yargs) => {
      return yargs
        .command({
          command: 'edit <name>',
          describe: 'Edit existing preset interactively',
          builder: buildEditCommand,
          handler: async (argv) => {
            return runProductCommand('preset', async () => {
              const { editCommand } = await import('./edit.js');
              await editCommand(argv as EditArguments);
            });
          },
        })
        .command({
          command: 'create <name>',
          describe: 'Create preset with filter expression',
          builder: buildCreateCommand,
          handler: async (argv) => {
            return runProductCommand('preset', async () => {
              const { createCommand } = await import('./create.js');
              await createCommand(argv as CreateArguments);
            });
          },
        })
        .command({
          command: 'show <name>',
          describe: 'Show detailed information about a preset',
          builder: buildShowCommand,
          handler: async (argv) => {
            return runProductCommand('preset', async () => {
              const { showCommand } = await import('./show.js');
              await showCommand(argv as ShowArguments);
            });
          },
        })
        .command({
          command: 'list',
          describe: 'List all available presets',
          builder: buildListCommand,
          handler: async (argv) => {
            return runProductCommand('preset', async () => {
              const { listCommand } = await import('./list.js');
              await listCommand(argv as ListArguments);
            });
          },
        })
        .command({
          command: 'url <name>',
          describe: 'Generate URL for existing preset',
          builder: buildUrlCommand,
          handler: async (argv) => {
            return runProductCommand('preset', async () => {
              const { urlCommand } = await import('./url.js');
              await urlCommand(argv as UrlArguments);
            });
          },
        })
        .command({
          command: 'delete <name>',
          describe: 'Delete an existing preset',
          builder: buildDeleteCommand,
          handler: async (argv) => {
            return runProductCommand('preset', async () => {
              const { deleteCommand } = await import('./delete.js');
              await deleteCommand(argv as DeleteArguments);
            });
          },
        })
        .command({
          command: 'test <name>',
          describe: 'Test preset against current server configuration',
          builder: buildTestCommand,
          handler: async (argv) => {
            return runProductCommand('preset', async () => {
              const { testCommand } = await import('./test.js');
              await testCommand(argv as TestArguments);
            });
          },
        })
        .demandCommand(0, 'Use --help for available commands')
        .example([
          ['$0 preset', 'Smart interactive mode - create new or edit existing'],
          ['$0 preset create dev --filter "web,database"', 'Create preset with simple filter'],
          ['$0 preset create prod --filter "web AND database"', 'Create preset with AND logic'],
          ['$0 preset list', 'List all available presets'],
          ['$0 preset url development', 'Generate URL for existing preset'],
        ])
        .epilogue(
          'Presets save server filters and provide reusable client URLs.\nComma-separated tags use OR logic; expressions also support AND, OR, NOT, and parentheses.\nRun 1mcp preset to create or edit interactively.',
        );
    },
    async (argv) => {
      return runProductCommand('preset', async () => {
        // Smart interactive mode when no subcommand is provided
        const { interactiveCommand } = await import('./interactive.js');
        await interactiveCommand(argv as InteractiveArguments);
      });
    },
  );
}
