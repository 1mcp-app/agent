import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import { InteractiveSelector } from '@src/utils/ui/interactiveSelector.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

/**
 * Command arguments for test command
 */
export interface TestArguments extends GlobalOptions {
  _: string[];
  name: string;
}

/**
 * Build the test command configuration
 */
export function buildTestCommand(yargs: Argv) {
  return yargs.positional('name', {
    describe: 'Name of the preset to test',
    type: 'string',
    demandOption: true,
  });
}

/**
 * Test preset against current server configuration
 */
export async function testCommand(argv: TestArguments): Promise<void> {
  try {
    const presetManager = PresetManager.getInstance(argv['config-dir']);
    await presetManager.initialize();
    const selector = new InteractiveSelector();

    await previewPreset(argv.name, presetManager, selector);
  } catch (error) {
    logger.error('Preset test command failed', { error });
    printer.error(`Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

/**
 * Preview preset without saving
 */
async function previewPreset(name: string, presetManager: PresetManager, selector: InteractiveSelector): Promise<void> {
  if (!presetManager.hasPreset(name)) {
    selector.showError(`Preset '${name}' not found`);
    return;
  }

  try {
    const testResult = await presetManager.testPreset(name);
    await selector.testPreset(name, testResult);
  } catch (error) {
    selector.showError(`Failed to test preset: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
