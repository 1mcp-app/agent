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
  } catch (_error) {
    logger.error('serveOptions.failed.to.parse.internal.tools.list.ee9cd62e', { error: _error });
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
    } catch (_error) {
      logger.warn('serveOptions.failed.to.load.presets.for.871e1a51', { error: _error });
    }

    if (presetLoaded && presetManager.hasPreset(parsedArgv.preset)) {
      selectorInput = { preset: parsedArgv.preset };
    } else if (presetLoaded) {
      logger.warn('serveOptions.preset.not.found.ignoring.preset.option.78f04add');
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

  for (const _warning of result.selection.compatibility.tagWarnings) {
    logger.warn('serveOptions.resolvestdiofilterconfig.diagnostic.5094434e');
  }

  if (result.selection.mode === 'preset') {
    logger.info('serveOptions.loaded.preset.for.stdio.transport.71846c5d');
  }

  return result.selection.runtimeConfig;
}

function logFilterSelectionError(error: FilterSelectionError): void {
  logger.error('serveOptions.logfilterselectionerror.diagnostic.bf2602b0');

  if (error.code === 'invalid_preset' && error.details) {
    logger.error('serveOptions.preset.tag.query.validation.failed.0851ef3c');
  }

  if (error.code === 'invalid_selector' && error.selector === 'filter') {
    logger.error('serveOptions.examples.d9ecfb49');
    logger.error('serveOptions.filter.web.api.database.or.logic.comma.separated.f732c461');
    logger.error('serveOptions.filter.web.and.database.and.logic.558ce26c');
    logger.error('serveOptions.filter.web.or.api.and.database.complex.expressions.4915f9cb');
  }
}
