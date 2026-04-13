import { deleteAuthProfile, listAuthProfiles, normalizeServerUrl } from '@src/commands/shared/authProfileStore.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import { discoverServerWithPidFile } from '@src/utils/validation/urlDetection.js';

export interface AuthLogoutOptions extends GlobalOptions {
  url?: string;
  all?: boolean;
}

export async function authLogoutCommand(options: AuthLogoutOptions): Promise<void> {
  if (options.all) {
    const profiles = await listAuthProfiles(options['config-dir']);
    if (profiles.length === 0) {
      process.stdout.write('No saved profiles to remove.\n');
      return;
    }
    for (const profile of profiles) {
      await deleteAuthProfile(options['config-dir'], profile.serverUrl);
    }
    process.stdout.write(`Removed ${profiles.length} profile${profiles.length !== 1 ? 's' : ''}.\n`);
    return;
  }

  if (!options.url) {
    try {
      const { url: discoveredUrl, source } = await discoverServerWithPidFile(options['config-dir']);
      const baseUrl = normalizeServerUrl(discoveredUrl.replace(/\/mcp$/, ''));
      process.stderr.write(`Auto-detected server at ${baseUrl} (via ${source})\n`);
      const removed = await deleteAuthProfile(options['config-dir'], baseUrl);
      if (removed) {
        process.stdout.write(`Removed profile for ${baseUrl}\n`);
      } else {
        process.stdout.write(`No saved profile for ${baseUrl}\n`);
      }
      return;
    } catch {
      throw new Error('Specify --url <server-url> or --all. No running server detected for auto-discovery.');
    }
  }

  const baseUrl = normalizeServerUrl(options.url);
  const removed = await deleteAuthProfile(options['config-dir'], baseUrl);
  if (removed) {
    process.stdout.write(`Removed profile for ${baseUrl}\n`);
  } else {
    process.stdout.write(`No saved profile for ${baseUrl}\n`);
  }
}
