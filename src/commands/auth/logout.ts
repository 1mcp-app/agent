import { RuntimeTargetStore } from '@src/domains/runtime-targets/runtimeTargetStore.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import {
  AuthCommandError,
  requireAuthContext,
  resolveAuthRuntimeTarget,
  toAuthOAuthTokenReference,
} from './runtimeTargetContext.js';

export interface AuthLogoutOptions extends GlobalOptions {
  context?: string;
  url?: string;
  all?: boolean;
}

export async function authLogoutCommand(options: AuthLogoutOptions): Promise<void> {
  requireAuthContext(options, 'logout');

  if (options.all) {
    throw new AuthCommandError(
      'credential_all_unsupported',
      'auth logout --all is not supported for Runtime Target Context credentials',
      `1mcp auth logout --context ${options.context}`,
    );
  }

  const { context, baseUrl, runtimeScopeId } = await resolveAuthRuntimeTarget(options, 'logout');
  const store = new RuntimeTargetStore();
  const rawReference = store.getOAuthTokenReference(context, runtimeScopeId);
  const profile = toAuthOAuthTokenReference(rawReference);
  if (profile) {
    store.clearOAuthTokenReference(context, runtimeScopeId);
    process.stdout.write(`Removed profile for ${context} (${baseUrl})\n`);
  } else {
    process.stdout.write(`No saved profile for ${context} (${baseUrl})\n`);
  }
}
