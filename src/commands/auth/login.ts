import { ApiClient } from '@src/commands/shared/apiClient.js';
import { API_INSPECT_ENDPOINT } from '@src/constants/api.js';
import { RuntimeTargetStore } from '@src/domains/runtime-targets/runtimeTargetStore.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { resolveAuthRuntimeTarget } from './runtimeTargetContext.js';

export interface AuthLoginOptions extends GlobalOptions {
  context?: string;
  url?: string;
  token?: string;
}

export async function authLoginCommand(options: AuthLoginOptions): Promise<void> {
  const { context, baseUrl, runtimeScopeId } = await resolveAuthRuntimeTarget(options, 'login');

  // Probe without auth — if it succeeds, auth is disabled
  const probeClient = new ApiClient({ baseUrl });
  const probeResponse = await probeClient.get(API_INSPECT_ENDPOINT);
  if (probeResponse.ok) {
    process.stdout.write(`Auth is not required on ${baseUrl} (auth is disabled). No login needed.\n`);
    return;
  }

  // Resolve token: explicit flag > stdin > localhost auto-generate
  let token = options.token || (await readTokenFromStdin());

  if (!token && isLocalhostUrl(baseUrl)) {
    token = await tryCliTokenGeneration(baseUrl);
  }

  if (!token) {
    throw new Error(
      'No token provided. Use --token or pipe a token via stdin.\n' +
        `To get a token, visit ${baseUrl}/oauth or run the OAuth flow.`,
    );
  }

  // Validate token
  const client = new ApiClient({ baseUrl, bearerToken: token });
  const response = await client.get(API_INSPECT_ENDPOINT);

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Authentication failed: token was rejected by ${baseUrl}`);
  }

  if (!response.ok && response.status !== 0) {
    process.stderr.write(`Warning: server returned HTTP ${response.status}, saving token anyway.\n`);
  }

  new RuntimeTargetStore().setOAuthTokenReference(context, runtimeScopeId, {
    serverUrl: baseUrl,
    token,
    savedAt: Date.now(),
    label: context,
  });

  process.stdout.write(`Saved authentication profile for ${context} (${baseUrl})\n`);
}

function isLocalhostUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

async function tryCliTokenGeneration(baseUrl: string): Promise<string | null> {
  try {
    const client = new ApiClient({ baseUrl });
    const response = await client.post<{ token?: string; authRequired?: boolean }>('/api/auth/cli-token', {});
    if (response.ok && response.data?.token) {
      process.stderr.write('Auto-generated CLI token for localhost.\n');
      return response.data.token;
    }
  } catch {
    // endpoint not available, fall through
  }
  return null;
}

async function readTokenFromStdin(): Promise<string | null> {
  if (process.stdin.isTTY) {
    return null;
  }
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim() || null);
    });
    process.stdin.on('error', () => resolve(null));
  });
}
