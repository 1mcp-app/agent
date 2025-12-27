// Interactive command functionality for smart preset mode
import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import { InteractiveSelector } from '@src/utils/ui/interactiveSelector.js';
import printer from '@src/utils/ui/printer.js';
import { UrlGenerator } from '@src/utils/ui/urlGenerator.js';

/**
 * Command arguments for the interactive command
 */
export interface InteractiveArguments extends GlobalOptions {
  _: string[];
}

/**
 * Smart interactive preset command - auto-detects existing presets and offers options
 */
export async function interactiveCommand(argv: InteractiveArguments): Promise<void> {
  try {
    // Initialize preset manager
    const presetManager = PresetManager.getInstance(argv['config-dir']);
    await presetManager.initialize();

    const selector = new InteractiveSelector();
    const urlGenerator = new UrlGenerator();

    // Show current preset configuration path
    printer.info(`Config directory: ${presetManager.getConfigPath()}`);
    printer.blank();

    // Check if we should offer to load existing presets
    const availablePresets = presetManager.getPresetList();
    let existingConfig;

    if (availablePresets.length > 0) {
      const selectedAction = await offerPresetSelection(availablePresets, selector);
      if (selectedAction === 'cancel') {
        printer.info('Operation cancelled.');
        return;
      } else if (selectedAction === 'new') {
        // Continue with new preset creation
      } else {
        // Load the selected preset for editing
        const preset = presetManager.getPreset(selectedAction);
        if (!preset) {
          selector.showError(`Failed to load preset '${selectedAction}'`);
          return;
        }

        printer.info(`Editing preset: ${selectedAction}`);
        if (preset.description) {
          printer.blank();
          printer.keyValue({ Description: preset.description });
        }
        existingConfig = preset;
      }
    }

    // Interactive server selection
    const result = await selector.selectServers(existingConfig, presetManager.getConfigPath());

    if (result.cancelled) {
      printer.info('Operation cancelled.');
      return;
    }

    // Handle saving
    if (existingConfig) {
      // Save back to existing preset
      await presetManager.savePreset(existingConfig.name, {
        description: existingConfig.description,
        strategy: result.strategy,
        tagQuery: result.tagQuery,
      });

      const url = urlGenerator.generatePresetUrl(existingConfig.name);
      selector.showSaveSuccess(existingConfig.name, url);
    } else {
      // New preset - ask for save details
      const saveResult = await selector.confirmSave();
      if (saveResult.save) {
        await presetManager.savePreset(saveResult.name, {
          description: saveResult.description,
          strategy: result.strategy,
          tagQuery: result.tagQuery,
        });

        const url = urlGenerator.generatePresetUrl(saveResult.name);
        selector.showSaveSuccess(saveResult.name, url);
      } else {
        // Just show preview without saving
        printer.blank();
        printer.title('Selection Summary');
        printer.keyValue({
          Strategy: result.strategy,
          Query: JSON.stringify(result.tagQuery),
        });
        printer.blank();
        printer.info('To save this selection, run the command with a specific name.');
      }
    }
  } catch (error) {
    logger.error('Preset interactive command failed', { error });
    printer.error(`Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

/**
 * Interface for preset information
 */
interface PresetInfo {
  name: string;
  strategy: string;
  description?: string;
}

/**
 * Offer preset selection when existing presets are found
 */
async function offerPresetSelection(availablePresets: PresetInfo[], selector: InteractiveSelector): Promise<string> {
  printer.info('Found existing presets. What would you like to do?');
  printer.blank();

  // Show available presets
  for (let i = 0; i < availablePresets.length; i++) {
    const preset = availablePresets[i];
    const strategyDesc = getStrategyDescription(preset.strategy);

    printer.info(`${i + 1}. ${preset.name} (${strategyDesc})`);
    if (preset.description) {
      printer.raw(`      ${preset.description}`);
    }
  }

  printer.info(`${availablePresets.length + 1}. Create new preset`);
  printer.info(`${availablePresets.length + 2}. Cancel`);
  printer.blank();

  const choice = await selector.getChoice('Select an option:', 1, availablePresets.length + 2);

  if (choice <= availablePresets.length) {
    return availablePresets[choice - 1].name;
  } else if (choice === availablePresets.length + 1) {
    return 'new';
  } else {
    return 'cancel';
  }
}

/**
 * Get human-readable strategy description
 */
function getStrategyDescription(strategy: string): string {
  switch (strategy) {
    case 'or':
      return 'OR logic';
    case 'and':
      return 'AND logic';
    case 'advanced':
      return 'Advanced';
    default:
      return strategy;
  }
}
