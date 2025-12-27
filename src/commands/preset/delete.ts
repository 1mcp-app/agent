import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import { InteractiveSelector } from '@src/utils/ui/interactiveSelector.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

/**
 * Command arguments for delete command
 */
export interface DeleteArguments extends GlobalOptions {
  _: string[];
  name: string;
}

/**
 * Build the delete command configuration
 */
export function buildDeleteCommand(yargs: Argv) {
  return yargs.positional('name', {
    describe: 'Name of the preset to delete',
    type: 'string',
    demandOption: true,
  });
}

/**
 * Delete an existing preset
 */
export async function deleteCommand(argv: DeleteArguments): Promise<void> {
  try {
    const presetManager = PresetManager.getInstance(argv['config-dir']);
    await presetManager.initialize();
    const selector = new InteractiveSelector();

    await deletePreset(argv.name, presetManager, selector);
  } catch (error) {
    logger.error('Preset delete command failed', { error });
    printer.error(`Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

/**
 * Delete a preset
 */
async function deletePreset(name: string, presetManager: PresetManager, selector: InteractiveSelector): Promise<void> {
  if (!presetManager.hasPreset(name)) {
    selector.showError(`Preset '${name}' not found`);
    return;
  }

  const deleted = await presetManager.deletePreset(name);

  if (deleted) {
    printer.success(`Preset '${name}' deleted successfully.`);
    printer.blank();
  } else {
    selector.showError(`Failed to delete preset '${name}'`);
  }
}
