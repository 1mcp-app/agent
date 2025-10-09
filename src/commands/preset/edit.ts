// Command functionality for preset edit
import type { Argv } from 'yargs';
import { PresetManager } from '@src/utils/config/presetManager.js';
import { InteractiveSelector } from '@src/utils/ui/interactiveSelector.js';
import { UrlGenerator } from '@src/utils/ui/urlGenerator.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';

/**
 * Command arguments for the edit command
 */
export interface EditArguments extends GlobalOptions {
  _: string[];
  name: string;
  description?: string;
}

/**
 * Build the edit command configuration
 */
export function buildEditCommand(yargs: Argv) {
  return yargs
    .positional('name', {
      describe: 'Name of the preset to edit',
      type: 'string',
      demandOption: true,
    })
    .option('description', {
      describe: 'Update description for the preset',
      type: 'string',
    });
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
