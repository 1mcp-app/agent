import {
  type ResolvableServeTargetOptions,
  type ResolvedServeTarget,
  resolveServeTarget,
} from '@src/commands/shared/serveTargetResolver.js';
import { fetchRuntimeIdentity } from '@src/domains/runtime-targets/runtimeIdentityVerification.js';
import { RuntimeTargetStore } from '@src/domains/runtime-targets/runtimeTargetStore.js';
import type { GlobalOptions } from '@src/globalOptions.js';
import { stripMcpSuffix } from '@src/utils/urlUtils.js';

import { normalizeServerUrl } from '../shared/authProfileStore.js';

export interface AuthRuntimeTargetOptions extends GlobalOptions {
  context?: string;
  url?: string;
}

export interface AuthRuntimeTarget {
  context: string;
  baseUrl: string;
  runtimeScopeId: string;
}

export interface AuthOAuthTokenReference {
  token: string;
  serverUrl?: string;
  savedAt?: number;
  label?: string;
}

export class AuthCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoveryCommand?: string,
  ) {
    super(message);
    this.name = 'AuthCommandError';
  }
}

export async function resolveAuthRuntimeTarget(
  options: AuthRuntimeTargetOptions,
  command: 'login' | 'logout' | 'status',
): Promise<AuthRuntimeTarget> {
  const context = requireAuthContext(options, command);
  const target = await resolveServeTarget({
    context,
    'config-dir': options['config-dir'],
  } as ResolvableServeTargetOptions & { context: string });
  const baseUrl = normalizeServerUrl(stripMcpSuffix(target.discoveredUrl));
  return {
    context,
    baseUrl,
    runtimeScopeId: await resolveRuntimeScopeId(target, baseUrl),
  };
}

export function requireAuthContext(options: AuthRuntimeTargetOptions, command: 'login' | 'logout' | 'status'): string {
  if (options.url) {
    throw new AuthCommandError(
      'credential_url_unsupported',
      'Auth credential commands require a named Runtime Target Context and do not accept --url',
    );
  }

  if (options.context) {
    return options.context;
  }

  const currentName = safeCurrentName();
  throw new AuthCommandError(
    'credential_context_required',
    'Auth credential commands require --context <name>',
    currentName ? `1mcp auth ${command} --context ${currentName}` : `1mcp auth ${command} --context <name>`,
  );
}

function safeCurrentName(): string | undefined {
  try {
    return new RuntimeTargetStore().current().name;
  } catch {
    return undefined;
  }
}

export function toAuthOAuthTokenReference(value: unknown): AuthOAuthTokenReference | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as Partial<AuthOAuthTokenReference>;
  if (typeof candidate.token !== 'string' || candidate.token.length === 0) {
    return undefined;
  }
  return {
    token: candidate.token,
    ...(typeof candidate.serverUrl === 'string' ? { serverUrl: candidate.serverUrl } : {}),
    ...(typeof candidate.savedAt === 'number' ? { savedAt: candidate.savedAt } : {}),
    ...(typeof candidate.label === 'string' ? { label: candidate.label } : {}),
  };
}

async function resolveRuntimeScopeId(
  target: ResolvedServeTarget<ResolvableServeTargetOptions & { context: string }>,
  baseUrl: string,
): Promise<string> {
  if (target.runtimeTargetContext?.runtimeScopeId) {
    return target.runtimeTargetContext.runtimeScopeId;
  }

  const identity = await fetchRuntimeIdentity(baseUrl);
  return identity.runtimeScopeId;
}
