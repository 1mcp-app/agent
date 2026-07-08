import { ApiClient } from '@src/commands/shared/apiClient.js';
import { API_INSPECT_ENDPOINT } from '@src/constants/api.js';
import { RuntimeTargetStore } from '@src/domains/runtime-targets/runtimeTargetStore.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { resolveAuthRuntimeTarget, toAuthOAuthTokenReference } from './runtimeTargetContext.js';

export interface AuthStatusOptions extends GlobalOptions {
  context?: string;
  url?: string;
}

export async function authStatusCommand(options: AuthStatusOptions): Promise<void> {
  const { context, baseUrl, runtimeScopeId } = await resolveAuthRuntimeTarget(options, 'status');
  await showProfileStatus(context, runtimeScopeId, baseUrl);
}

async function showProfileStatus(context: string, runtimeScopeId: string, baseUrl: string): Promise<void> {
  const profile = toAuthOAuthTokenReference(new RuntimeTargetStore().getOAuthTokenReference(context, runtimeScopeId));
  if (!profile) {
    process.stdout.write(`No saved profile for ${context} (${baseUrl})\n`);
    return;
  }

  const profileUrl = profile.serverUrl ?? baseUrl;
  const savedAt = profile.savedAt === undefined ? 'unknown' : new Date(profile.savedAt).toLocaleString();
  process.stdout.write(`Profile: ${context} (${profileUrl})\n`);
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
