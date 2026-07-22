import fs from 'fs';
import path from 'path';

import { type ApplicationConfig, applicationConfigSchema } from '@src/core/types/transport.js';

import { z } from 'zod';

export interface BackgroundLaunchConfig {
  version: 1;
  claimId: string;
  appConfig: ApplicationConfig;
}

export const BACKGROUND_LAUNCH_CONFIG_FILE = 'background-launch.json';

const backgroundLaunchConfigSchema = z.object({
  version: z.literal(1),
  claimId: z.string().min(1),
  appConfig: applicationConfigSchema,
});

export function getBackgroundLaunchConfigPath(configDir: string): string {
  return path.join(configDir, BACKGROUND_LAUNCH_CONFIG_FILE);
}

export function backgroundLaunchConfigExists(configDir: string): boolean {
  return fs.existsSync(getBackgroundLaunchConfigPath(configDir));
}

export function writeBackgroundLaunchConfig(configDir: string, claimId: string, appConfig: ApplicationConfig): string {
  const filePath = getBackgroundLaunchConfigPath(configDir);
  const value = backgroundLaunchConfigSchema.parse({ version: 1, claimId, appConfig });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
  return filePath;
}

export function readBackgroundLaunchConfig(filePath: string): BackgroundLaunchConfig {
  return backgroundLaunchConfigSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export function cleanupBackgroundLaunchConfig(
  configDir: string,
  expectedClaimId: string,
  // Stale-generation removal is safe only while the caller has verified and
  // retained the Runtime Scope's exclusive owner.
  options: { removeStaleGeneration?: boolean } = {},
): boolean {
  const filePath = getBackgroundLaunchConfigPath(configDir);
  try {
    const current = readBackgroundLaunchConfig(filePath);
    if (current.claimId !== expectedClaimId && !options.removeStaleGeneration) return false;
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return true;
    throw error;
  }
}
