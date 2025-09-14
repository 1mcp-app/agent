import type { Argv } from 'yargs';
import { globalOptions } from '../../globalOptions.js';

// Import argument types for type safety
import type { EditArguments } from './edit.js';
import type { CreateArguments } from './create.js';
import type { ShowArguments } from './show.js';
import type { ListArguments } from './list.js';
import type { UrlArguments } from './url.js';
import type { DeleteArguments } from './delete.js';
import type { TestArguments } from './test.js';
import type { InteractiveArguments } from './interactive.js';

// Import builder functions from command implementations
import { buildEditCommand } from './edit.js';
import { buildCreateCommand } from './create.js';
import { buildShowCommand } from './show.js';
import { buildListCommand } from './list.js';
import { buildUrlCommand } from './url.js';
import { buildDeleteCommand } from './delete.js';
import { buildTestCommand } from './test.js';

/**
 * Setup preset command configuration for yargs
 */
export function setupPresetCommands(yargs: Argv): Argv {
  // Merge global options with existing config-dir structure
  const mergedOptions = {
    ...(globalOptions || {}),
    // config-dir is already included in globalOptions, so no need to duplicate
  };

  return yargs.command(
    'preset',
    'Manage server presets for dynamic filtering',
    (yargs) => {
      return yargs
        .options(mergedOptions)
        .command({
          command: 'edit <name>',
          describe: 'Edit existing preset interactively',
          builder: (yargs) => buildEditCommand(yargs.options(mergedOptions)),
          handler: async (argv) => {
            const { editCommand } = await import('./edit.js');
            await editCommand(argv as EditArguments);
          },
        })
        .command({
          command: 'create <name>',
          describe: 'Create preset with filter expression',
          builder: (yargs) => buildCreateCommand(yargs.options(mergedOptions)),
          handler: async (argv) => {
            const { createCommand } = await import('./create.js');
            await createCommand(argv as CreateArguments);
          },
        })
        .command({
          command: 'show <name>',
          describe: 'Show detailed information about a preset',
          builder: (yargs) => buildShowCommand(yargs.options(mergedOptions)),
          handler: async (argv) => {
            const { showCommand } = await import('./show.js');
            await showCommand(argv as ShowArguments);
          },
        })
        .command({
          command: 'list',
          describe: 'List all available presets',
          builder: (yargs) => buildListCommand(yargs.options(mergedOptions)),
          handler: async (argv) => {
            const { listCommand } = await import('./list.js');
            await listCommand(argv as ListArguments);
          },
        })
        .command({
          command: 'url <name>',
          describe: 'Generate URL for existing preset',
          builder: (yargs) => buildUrlCommand(yargs.options(mergedOptions)),
          handler: async (argv) => {
            const { urlCommand } = await import('./url.js');
            await urlCommand(argv as UrlArguments);
          },
        })
        .command({
          command: 'delete <name>',
          describe: 'Delete an existing preset',
          builder: (yargs) => buildDeleteCommand(yargs.options(mergedOptions)),
          handler: async (argv) => {
            const { deleteCommand } = await import('./delete.js');
            await deleteCommand(argv as DeleteArguments);
          },
        })
        .command({
          command: 'test <name>',
          describe: 'Test preset against current server configuration',
          builder: (yargs) => buildTestCommand(yargs.options(mergedOptions)),
          handler: async (argv) => {
            const { testCommand } = await import('./test.js');
            await testCommand(argv as TestArguments);
          },
        })
        .demandCommand(0, 'Use --help for available commands')
        .example([
          ['$0 preset', 'Smart interactive mode - create new or edit existing'],
          ['$0 preset edit development', 'Edit existing "development" preset'],
          ['$0 preset create dev --filter "web,database"', 'Create preset with simple filter'],
          ['$0 preset create prod --filter "web AND database"', 'Create preset with AND logic'],
          ['$0 preset create secure --filter "(web OR api) AND NOT experimental"', 'Complex filter'],
          ['$0 preset list', 'List all available presets'],
          ['$0 preset show development', 'Show full details of "development" preset'],
          ['$0 preset url development', 'Generate URL for existing preset'],
          ['$0 preset delete staging', 'Delete "staging" preset'],
          ['$0 preset test development', 'Test "development" preset'],
        ]).epilogue(`
PRESET MANAGEMENT SYSTEM:

The preset command provides both interactive (TUI) and command-line approaches to manage
server filtering presets. Presets generate URLs like http://localhost:3050/mcp?preset=development
that automatically update when you modify the preset configuration.

WORKFLOW EXAMPLES:

1. Smart interactive approach:
   1mcp preset
   → Auto-detects existing presets → Offers to edit or create new

2. Direct editing:
   1mcp preset edit dev
   → Interactive editing of existing 'dev' preset

3. Command-line creation:
   1mcp preset create dev --filter "web,database,api"
   → Quick preset creation with comma-separated tags (OR logic)

4. Complex expressions:
   1mcp preset create prod --filter "web AND database AND monitoring"
   → AND logic for strict requirements

   1mcp preset create flexible --filter "(web OR api) AND database"
   → Mixed boolean expressions

5. Management:
   1mcp preset list           # List all presets
   1mcp preset url dev        # Get client URL
   1mcp preset test dev       # Test against servers
   1mcp preset delete old     # Remove unused preset

FILTER EXPRESSIONS:
- Simple (OR logic): "web,api,database"
- AND logic: "web AND database"
- Complex: "(web OR api) AND database AND NOT experimental"

DYNAMIC UPDATES:
When you modify a preset, all clients using that preset's URL automatically
receive updated server configurations without needing to change their URLs.
        `);
    },
    async (argv) => {
      // Smart interactive mode when no subcommand is provided
      const { interactiveCommand } = await import('./interactive.js');
      await interactiveCommand(argv as InteractiveArguments);
    },
  );
}
