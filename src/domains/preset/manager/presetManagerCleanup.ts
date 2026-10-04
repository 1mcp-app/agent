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
  logger.debug('presetManagerCleanup.starting.presetmanager.cleanup.aa7d3c68');

  try {
    if (state.reloadTimeout) {
      clearTimeout(state.reloadTimeout);
      logger.debug('presetManagerCleanup.cleared.pending.reload.timeout.71589886');
    }

    if (state.watcher) {
      state.watcher.close();
      logger.debug('presetManagerCleanup.stopped.watching.preset.file.d2b94074');
    }

    if (state.notificationCallbacks.size > 0) {
      const callbackCount = state.notificationCallbacks.size;
      state.notificationCallbacks.clear();
      logger.debug('presetManagerCleanup.cleared.notification.callbacks.83aa6c0b', { count: callbackCount });
    }

    if (typeof state.changeDetector.clear === 'function') {
      state.changeDetector.clear();
      logger.debug('presetManagerCleanup.cleared.change.detector.a4b42813');
    }

    if (state.presets.size > 0) {
      const presetCount = state.presets.size;
      state.presets.clear();
      logger.debug('presetManagerCleanup.cleared.presets.from.memory.2a42cc3c', { count: presetCount });
    }

    logger.debug('presetManagerCleanup.presetmanager.cleanup.completed.successfully.0047ca52');
  } catch (error) {
    logger.error('presetManagerCleanup.error.during.presetmanager.cleanup.ea747462', { error: error });
  }

  return { reloadTimeout: null, watcher: null };
}
