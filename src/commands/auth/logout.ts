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
  allLocal?: boolean;
  'all-local'?: boolean;
}

export async function authLogoutCommand(options: AuthLogoutOptions): Promise<void> {
  const context = requireAuthContext(options, 'logout');

  if (options.all) {
    throw new AuthCommandError(
      'credential_all_unsupported',
      'auth logout --all is not supported for Runtime Target Context credentials',
      `1mcp auth logout --context ${options.context}`,
    );
  }

  if (options.allLocal || options['all-local']) {
    if (context !== 'local') {
      throw new AuthCommandError(
        'credential_all_local_context_required',
        'auth logout --all-local can only be used with --context local',
        '1mcp auth logout --context local --all-local',
      );
    }
    const cleared = new RuntimeTargetStore().clearLocalOAuthTokenReferences();
    if (cleared === 0) {
      process.stdout.write('No saved local authentication profiles.\n');
    } else {
      process.stdout.write(`Removed ${cleared} local authentication profile${cleared !== 1 ? 's' : ''}.\n`);
    }
    return;
  }

  const { baseUrl, runtimeScopeId } = await resolveAuthRuntimeTarget(options, 'logout');
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
