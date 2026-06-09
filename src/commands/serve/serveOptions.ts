import { type FilterSelectionError, resolveFilterSelection } from '@src/core/filtering/filterSelection.js';
import { FlagManager } from '@src/core/flags/flagManager.js';
import type { InboundConnectionConfig } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import type { ServeOptions } from './serve.js';

export function parseCommaSeparatedList(value?: string): string[] {
  return value
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
}

export function parseInternalToolsList(value?: string): string[] {
  if (!value) {
    return [];
  }

  try {
    return FlagManager.getInstance().parseToolsList(value);
  } catch (error) {
    logger.error(`Failed to parse internal-tools list: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export async function resolveStdioFilterConfig(parsedArgv: ServeOptions): Promise<InboundConnectionConfig | null> {
  const PresetManager = (await import('@src/domains/preset/manager/presetManager.js')).PresetManager;
  const presetManager = PresetManager.getInstance(parsedArgv['config-dir']);

  let selectorInput: Parameters<typeof resolveFilterSelection>[0] = {};

  if (parsedArgv.preset) {
    let presetLoaded = false;
    try {
      await presetManager.loadPresetsWithoutWatcher();
      presetLoaded = true;
    } catch (error) {
      logger.warn(
        `Failed to load presets for '${parsedArgv.preset}': ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    if (presetLoaded && presetManager.hasPreset(parsedArgv.preset)) {
      selectorInput = { preset: parsedArgv.preset };
    } else if (presetLoaded) {
      logger.warn(`Preset '${parsedArgv.preset}' not found, ignoring preset option`);
    }
  }

  if (!selectorInput.preset && parsedArgv.filter !== undefined) {
    selectorInput = { filter: parsedArgv.filter };
  }

  const result = resolveFilterSelection(selectorInput, {
    presetLookup: {
      getPreset: (name) => {
        const preset = presetManager.getPreset(name);
        return preset
          ? {
              name,
              strategy: preset.strategy,
              tagQuery: preset.tagQuery,
            }
          : undefined;
      },
    },
  });

  if (!result.ok) {
    logFilterSelectionError(result.error);
    process.exit(1);
    return null;
  }

  for (const warning of result.selection.compatibility.tagWarnings) {
    logger.warn(warning);
  }

  if (result.selection.mode === 'preset') {
    const preset = presetManager.getPreset(result.selection.presetName!);
    logger.info(`Loaded preset '${result.selection.presetName}' for STDIO transport`, {
      strategy: preset?.strategy,
      tagQuery: result.selection.tagQuery,
    });
  }

  return result.selection.runtimeConfig;
}

function logFilterSelectionError(error: FilterSelectionError): void {
  logger.error(error.message);

  if (error.code === 'invalid_preset' && error.details) {
    logger.error('Preset tag query validation failed', error.details);
  }

  if (error.code === 'invalid_selector' && error.selector === 'filter') {
    logger.error('Examples:');
    logger.error('  --filter "web,api,database"           # OR logic (comma-separated)');
    logger.error('  --filter "web AND database"           # AND logic');
    logger.error('  --filter "(web OR api) AND database"  # Complex expressions');
  }
}
