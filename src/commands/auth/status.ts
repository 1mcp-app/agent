import { ApiClient } from '@src/commands/shared/apiClient.js';
import { listAuthProfiles, loadAuthProfile, normalizeServerUrl } from '@src/commands/shared/authProfileStore.js';
import { API_INSPECT_ENDPOINT } from '@src/constants/api.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import { discoverServerWithPidFile } from '@src/utils/validation/urlDetection.js';

export interface AuthStatusOptions extends GlobalOptions {
  url?: string;
}

export async function authStatusCommand(options: AuthStatusOptions): Promise<void> {
  if (options.url) {
    await showProfileStatus(options['config-dir'], normalizeServerUrl(options.url));
    return;
  }

  // Try auto-discovery first
  try {
    const { url: discoveredUrl, source } = await discoverServerWithPidFile(options['config-dir']);
    const baseUrl = normalizeServerUrl(discoveredUrl.replace(/\/mcp$/, ''));
    process.stderr.write(`Auto-detected server at ${baseUrl} (via ${source})\n`);
    await showProfileStatus(options['config-dir'], baseUrl);
    return;
  } catch {
    // No server found, fall through to list all profiles
  }

  const profiles = await listAuthProfiles(options['config-dir']);
  if (profiles.length === 0) {
    process.stdout.write('No saved authentication profiles.\n');
    return;
  }

  process.stdout.write(`Saved profiles (${profiles.length}):\n`);
  for (const profile of profiles) {
    const savedAt = new Date(profile.savedAt).toLocaleString();
    process.stdout.write(`  - ${profile.serverUrl}  (saved ${savedAt})\n`);
  }
}

async function showProfileStatus(configDir: string | undefined, baseUrl: string): Promise<void> {
  const profile = await loadAuthProfile(configDir, baseUrl);
  if (!profile) {
    process.stdout.write(`No saved profile for ${baseUrl}\n`);
    return;
  }

  const savedAt = new Date(profile.savedAt).toLocaleString();
  process.stdout.write(`Profile: ${baseUrl}\n`);
  process.stdout.write(`  Saved: ${savedAt}\n`);

  const client = new ApiClient({ baseUrl, bearerToken: profile.token });
  const response = await client.get(API_INSPECT_ENDPOINT);
  if (response.ok) {
    process.stdout.write(`  Status: connected\n`);
  } else if (response.status === 401 || response.status === 403) {
    process.stdout.write(`  Status: token rejected (HTTP ${response.status})\n`);
  } else {
    process.stdout.write(`  Status: unreachable (${response.error ?? `HTTP ${response.status}`})\n`);
  }
}
