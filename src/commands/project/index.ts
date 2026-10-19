import { setupPreparationCommands } from '@src/commands/preparation/index.js';
import { withGlobalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

export function setupProjectCommands(yargs: Argv): Argv {
  return withGlobalOptions(yargs).command('project', 'Manage project checkouts', (command) =>
    setupPreparationCommands(command).demandCommand(1, 'Please specify a project subcommand'),
  );
}
