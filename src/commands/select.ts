import type { Argv } from 'yargs';
import { PresetManager } from '../utils/presetManager.js';
import { InteractiveSelector } from '../utils/interactiveSelector.js';
import { UrlGenerator } from '../utils/urlGenerator.js';
import logger from '../logger/logger.js';

/**
 * Command arguments for the select command
 */
interface SelectArguments {
  _: string[];
  'preset-name'?: string;
  save?: string;
  load?: string;
  'url-only'?: boolean;
  url?: boolean;
  list?: boolean;
  delete?: string;
  preview?: boolean;
  description?: string;
}

/**
 * Unified select command for interactive server selection and preset management
 */
export async function selectCommand(argv: SelectArguments): Promise<void> {
  try {
    // Initialize preset manager
    const presetManager = PresetManager.getInstance();
    await presetManager.initialize();

    const selector = new InteractiveSelector();
    const urlGenerator = new UrlGenerator();

    // Handle different operation modes
    const presetName = argv['preset-name'] as string | undefined;

    // Mode: List presets
    if (argv.list) {
      await listPresets(presetManager, selector);
      return;
    }

    // Mode: Delete preset
    if (argv.delete) {
      await deletePreset(argv.delete, presetManager, selector);
      return;
    }

    // Mode: URL-only for existing preset
    if (argv['url-only'] && presetName) {
      await showPresetUrl(presetName, presetManager, selector, urlGenerator);
      return;
    }

    // Mode: Preview existing preset
    if (argv.preview && presetName) {
      await previewPreset(presetName, presetManager, selector);
      return;
    }

    // Mode: Load existing preset for editing
    let existingConfig;
    if (argv.load) {
      existingConfig = await loadPresetForEditing(argv.load, presetManager, selector);
      if (!existingConfig) {
        return; // Error already shown
      }
    }

    // Interactive server selection
    const result = await selector.selectServers(existingConfig);

    if (result.cancelled) {
      console.log('Operation cancelled.');
      process.exit(0);
    }

    // Handle saving
    let finalPresetName: string | undefined;

    if (argv.save) {
      // Save with specified name
      finalPresetName = argv.save;
      await savePreset(finalPresetName, result, argv.description, presetManager, selector, urlGenerator);
    } else if (argv.load) {
      // Save back to loaded preset
      finalPresetName = argv.load;
      await savePreset(finalPresetName, result, existingConfig?.description, presetManager, selector, urlGenerator);
    } else if (argv.url) {
      // Interactive save with URL display
      const saveResult = await selector.confirmSave();
      if (saveResult.save) {
        finalPresetName = saveResult.name;
        await savePreset(finalPresetName, result, saveResult.description, presetManager, selector, urlGenerator);
      }
    } else {
      // Just show preview without saving
      console.log('\n📋 Selection Summary:');
      console.log(`   Strategy: ${result.strategy}`);
      console.log(`   Query: ${JSON.stringify(result.tagQuery)}`);
      console.log('\nTo save this selection, use --save <name> or --url flags.');
    }
  } catch (error) {
    logger.error('Select command failed', { error });
    console.error(`❌ Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

/**
 * List available presets
 */
async function listPresets(presetManager: PresetManager, selector: InteractiveSelector): Promise<void> {
  const presets = presetManager.getPresetList();

  if (presets.length === 0) {
    selector.showError('No presets found. Create one with: 1mcp select --save <name>');
    return;
  }

  console.log('┌─────────────────── Available Presets ────────────────────┐');
  console.log('│                                                          │');

  for (const preset of presets) {
    const lastUsed = preset.lastUsed ? new Date(preset.lastUsed).toLocaleDateString() : 'never';
    const strategyDesc = getStrategyDescription(preset.strategy);

    const queryStr = JSON.stringify(preset.tagQuery);
    console.log(`│ ${preset.name.padEnd(20)} ${strategyDesc.padEnd(12)} query-based │`);
    console.log(`│ │ ${queryStr.slice(0, 54).padEnd(54)} │`);
    console.log(`│ │ Last used: ${lastUsed.padEnd(41)} │`);

    if (preset !== presets[presets.length - 1]) {
      console.log('│                                                          │');
    }
  }

  console.log('│                                                          │');
  console.log('│ Commands:                                                │');
  console.log('│   1mcp select <name> --url-only    Generate URL         │');
  console.log('│   1mcp select --load <name>        Edit preset          │');
  console.log('│   1mcp select --delete <name>      Delete preset        │');
  console.log('│   1mcp select <name> --preview     Test preset          │');
  console.log('└──────────────────────────────────────────────────────────┘\n');
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

/**
 * Load preset for editing
 */
async function loadPresetForEditing(
  name: string,
  presetManager: PresetManager,
  selector: InteractiveSelector,
): Promise<any> {
  if (!presetManager.hasPreset(name)) {
    selector.showError(`Preset '${name}' not found`);
    return null;
  }

  const preset = presetManager.getPreset(name);
  if (!preset) {
    selector.showError(`Failed to load preset '${name}'`);
    return null;
  }

  console.log(`\n📝 Editing preset: ${name}`);
  if (preset.description) {
    console.log(`   Description: ${preset.description}`);
  }

  return preset;
}

/**
 * Save preset with notifications
 */
async function savePreset(
  name: string,
  result: any,
  description: string | undefined,
  presetManager: PresetManager,
  selector: InteractiveSelector,
  urlGenerator: UrlGenerator,
): Promise<void> {
  await presetManager.savePreset(name, {
    description,
    strategy: result.strategy,
    tagQuery: result.tagQuery,
  });

  const url = urlGenerator.generatePresetUrl(name);
  selector.showSaveSuccess(name, url);
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

/**
 * Setup select command configuration for yargs
 */
export function setupSelectCommand(yargs: Argv): Argv {
  return yargs.command(
    'select [preset-name]',
    'Interactive server selection and preset management',
    (yargs) => {
      return yargs
        .positional('preset-name', {
          describe: 'Preset name to use with --url-only, --preview, etc.',
          type: 'string',
        })
        .option('save', {
          describe: 'Save selection as preset with specified name',
          type: 'string',
          alias: 's',
          conflicts: ['load'],
        })
        .option('load', {
          describe: 'Load existing preset for editing',
          type: 'string',
          alias: 'l',
          conflicts: ['save'],
        })
        .option('url-only', {
          describe: 'Generate URL from existing preset (non-interactive)',
          type: 'boolean',
          implies: 'preset-name',
        })
        .option('url', {
          describe: 'Show URL after interactive selection and save',
          type: 'boolean',
          alias: 'u',
          conflicts: ['url-only', 'list', 'delete', 'preview'],
        })
        .option('list', {
          describe: 'List available presets',
          type: 'boolean',
          conflicts: ['save', 'load', 'url', 'url-only', 'delete', 'preview'],
        })
        .option('delete', {
          describe: 'Delete preset by name',
          type: 'string',
          alias: 'd',
          conflicts: ['save', 'load', 'url', 'url-only', 'list', 'preview'],
        })
        .option('preview', {
          describe: 'Test/preview preset without starting server',
          type: 'boolean',
          alias: 'p',
          implies: 'preset-name',
          conflicts: ['save', 'load', 'url', 'url-only', 'list', 'delete'],
        })
        .option('description', {
          describe: 'Description for saved preset',
          type: 'string',
          implies: 'save',
        })
        .example([
          ['$0 select', 'Interactive server selection (temporary)'],
          ['$0 select --save development', 'Interactive selection and save as "development"'],
          ['$0 select --save dev --url', 'Select, save, and show URL'],
          ['$0 select --load development', 'Edit existing "development" preset'],
          ['$0 select development --url-only', 'Generate URL for existing preset'],
          ['$0 select --list', 'List all available presets'],
          ['$0 select --delete staging', 'Delete "staging" preset'],
          ['$0 select development --preview', 'Test "development" preset'],
        ])
        .group(['save', 'load', 'url', 'description'], 'Selection and Save Options:')
        .group(['list', 'delete', 'preview', 'url-only'], 'Preset Management Options:').epilogue(`
INTERACTIVE PRESET SYSTEM:

The select command provides an interactive interface for choosing MCP servers and
creating dynamic presets. Presets generate URLs like http://localhost:3050?preset=development
that automatically update when you modify the preset configuration.

WORKFLOW EXAMPLES:

1. Quick preset creation:
   1mcp select --save dev --url
   → Interactive selection → Save as 'dev' → Show URL

2. Update existing preset:
   1mcp select --load prod
   → Load 'prod' preset → Interactive modification → Save

3. Generate URL:
   1mcp select dev --url-only
   → http://localhost:3050?preset=dev

4. Manage presets:
   1mcp select --list           # List all presets
   1mcp select dev --preview    # Test preset
   1mcp select --delete old     # Delete preset

DYNAMIC UPDATES:
When you modify a preset, all clients using that preset's URL automatically
receive updated server configurations without needing to change their URLs.
        `);
    },
    async (argv) => {
      await selectCommand(argv as SelectArguments);
    },
  );
}
