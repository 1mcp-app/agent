import { PresetManager } from '../../utils/presetManager.js';
import { InteractiveSelector } from '../../utils/interactiveSelector.js';
import { GlobalOptions } from '../../globalOptions.js';
import logger from '../../logger/logger.js';

/**
 * Command arguments for test command
 */
interface TestArguments extends GlobalOptions {
  _: string[];
  name: string;
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
    console.error(`❌ Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
