import type { FSWatcher } from 'fs';

import { PresetServerChangeDetector } from '@src/domains/preset/services/presetServerChangeDetector.js';
import { PresetConfig } from '@src/domains/preset/types/presetTypes.js';
import logger from '@src/logger/logger.js';

export interface PresetManagerCleanupState {
  reloadTimeout: ReturnType<typeof setTimeout> | null;
  watcher: FSWatcher | null;
  notificationCallbacks: Set<(presetName: string) => Promise<void>>;
  changeDetector: PresetServerChangeDetector;
  presets: Map<string, PresetConfig>;
}

export async function cleanupPresetManagerState(
  state: PresetManagerCleanupState,
): Promise<{ reloadTimeout: null; watcher: null }> {
  logger.debug('Starting PresetManager cleanup');

  try {
    if (state.reloadTimeout) {
      clearTimeout(state.reloadTimeout);
      logger.debug('Cleared pending reload timeout');
    }

    if (state.watcher) {
      state.watcher.close();
      logger.debug('Stopped watching preset file');
    }

    if (state.notificationCallbacks.size > 0) {
      const callbackCount = state.notificationCallbacks.size;
      state.notificationCallbacks.clear();
      logger.debug('Cleared notification callbacks', { count: callbackCount });
    }

    if (typeof state.changeDetector.clear === 'function') {
      state.changeDetector.clear();
      logger.debug('Cleared change detector');
    }

    if (state.presets.size > 0) {
      const presetCount = state.presets.size;
      state.presets.clear();
      logger.debug('Cleared presets from memory', { count: presetCount });
    }

    logger.debug('PresetManager cleanup completed successfully');
  } catch (error) {
    logger.error('Error during PresetManager cleanup', { error });
  }

  return { reloadTimeout: null, watcher: null };
}
