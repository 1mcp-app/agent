import { PresetManager } from '../../utils/presetManager.js';
import { InteractiveSelector } from '../../utils/interactiveSelector.js';
import logger from '../../logger/logger.js';

/**
 * Command arguments for delete command
 */
interface DeleteArguments {
  _: string[];
  name: string;
}

/**
 * Delete an existing preset
 */
export async function deleteCommand(argv: DeleteArguments): Promise<void> {
  try {
    const presetManager = PresetManager.getInstance();
    await presetManager.initialize();
    const selector = new InteractiveSelector();

    await deletePreset(argv.name, presetManager, selector);
  } catch (error) {
    logger.error('Preset delete command failed', { error });
    console.error(`❌ Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    console.log(`✅ Preset '${name}' deleted successfully.\n`);
  } else {
    selector.showError(`Failed to delete preset '${name}'`);
  }
}
