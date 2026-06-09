import { promises as fs } from 'fs';

import { getConfigDir } from '@src/constants.js';
import { PresetConfig, PresetStorage } from '@src/domains/preset/types/presetTypes.js';

export async function ensurePresetConfigDirectory(configDirOption?: string): Promise<void> {
  const configDir = getConfigDir(configDirOption);
  try {
    await fs.mkdir(configDir, { recursive: true });
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error) {
      const errorCode = (error as Error & { code?: string }).code;
      if (errorCode !== undefined && errorCode !== 'EEXIST') {
        throw error;
      }
      return;
    }

    throw error;
  }
}

export async function writePresetStorage(
  configPath: string,
  presets: Map<string, PresetConfig>,
  configDirOption?: string,
): Promise<void> {
  await ensurePresetConfigDirectory(configDirOption);

  const storage: PresetStorage = {
    version: '1.0.0',
    presets: Object.fromEntries(presets.entries()) as Record<string, PresetConfig>,
  };

  await fs.writeFile(configPath, JSON.stringify(storage, null, 2), 'utf-8');
}
