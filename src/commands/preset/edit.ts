// Command functionality for preset edit
import { PresetManager } from '../../utils/presetManager.js';
import { InteractiveSelector } from '../../utils/interactiveSelector.js';
import { UrlGenerator } from '../../utils/urlGenerator.js';
import { GlobalOptions } from '../../globalOptions.js';
import logger from '../../logger/logger.js';

/**
 * Command arguments for the edit command
 */
interface EditArguments extends GlobalOptions {
  _: string[];
  name: string;
  description?: string;
}

/**
 * Preset edit command (interactive TUI for existing presets)
 */
export async function editCommand(argv: EditArguments): Promise<void> {
  try {
    // Initialize preset manager
    const presetManager = PresetManager.getInstance(argv['config-dir']);
    await presetManager.initialize();

    const selector = new InteractiveSelector();
    const urlGenerator = new UrlGenerator();

    // Show current preset configuration path
    console.log(`📁 Config directory: ${presetManager.getConfigPath()}\n`);

    // Load existing preset for editing
    if (!presetManager.hasPreset(argv.name)) {
      selector.showError(`Preset '${argv.name}' not found`);
      return;
    }

    const existingConfig = presetManager.getPreset(argv.name);
    if (!existingConfig) {
      selector.showError(`Failed to load preset '${argv.name}'`);
      return;
    }

    console.log(`📝 Editing preset: ${argv.name}`);
    if (existingConfig.description) {
      console.log(`   Description: ${existingConfig.description}`);
    }

    // Interactive server selection with existing config
    const result = await selector.selectServers(existingConfig, presetManager.getConfigPath());

    if (result.cancelled) {
      console.log('Operation cancelled.');
      process.exit(0);
    }

    // Save back to the same preset name, optionally updating description
    const updatedDescription = argv.description || existingConfig.description;

    await presetManager.savePreset(argv.name, {
      description: updatedDescription,
      strategy: result.strategy,
      tagQuery: result.tagQuery,
    });

    const url = urlGenerator.generatePresetUrl(argv.name);
    selector.showSaveSuccess(argv.name, url);
  } catch (error) {
    logger.error('Preset edit command failed', { error });
    console.error(`❌ Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}
