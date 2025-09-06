import { PresetManager } from '../../utils/presetManager.js';
import { InteractiveSelector } from '../../utils/interactiveSelector.js';
import { UrlGenerator } from '../../utils/urlGenerator.js';
import logger from '../../logger/logger.js';

/**
 * Command arguments for URL command
 */
interface UrlArguments {
  _: string[];
  name: string;
}

/**
 * Show URL for existing preset
 */
export async function urlCommand(argv: UrlArguments): Promise<void> {
  try {
    const presetManager = PresetManager.getInstance();
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
