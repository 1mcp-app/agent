import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import { PresetManager } from '@src/utils/config/presetManager.js';
import { InteractiveSelector } from '@src/utils/ui/interactiveSelector.js';
import { UrlGenerator } from '@src/utils/ui/urlGenerator.js';

import type { Argv } from 'yargs';

/**
 * Command arguments for URL command
 */
export interface UrlArguments extends GlobalOptions {
  _: string[];
  name: string;
}

/**
 * Build the url command configuration
 */
export function buildUrlCommand(yargs: Argv) {
  return yargs.positional('name', {
    describe: 'Name of the preset to generate URL for',
    type: 'string',
    demandOption: true,
  });
}

/**
 * Show URL for existing preset
 */
export async function urlCommand(argv: UrlArguments): Promise<void> {
  try {
    const presetManager = PresetManager.getInstance(argv['config-dir']);
    await presetManager.initialize();
    const selector = new InteractiveSelector();
    const urlGenerator = new UrlGenerator();

    await showPresetUrl(argv.name, presetManager, selector, urlGenerator);
  } catch (error) {
    logger.error('Preset URL command failed', { error });
    console.error(`❌ Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

/**
 * Show URL for existing preset
 */
async function showPresetUrl(
  name: string,
  presetManager: PresetManager,
  selector: InteractiveSelector,
  urlGenerator: UrlGenerator,
): Promise<void> {
  if (!presetManager.hasPreset(name)) {
    selector.showError(`Preset '${name}' not found`);
    return;
  }

  const urlResult = await urlGenerator.validateAndGeneratePresetUrl(name);

  if (!urlResult.valid) {
    selector.showError(urlResult.error || 'Failed to generate URL');
    return;
  }

  selector.showUrl(name, urlResult.url);
}
