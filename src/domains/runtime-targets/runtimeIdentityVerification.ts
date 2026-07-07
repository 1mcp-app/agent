import type { RuntimeTargetObservedIdentity, StoredRuntimeTarget } from './runtimeTargetStore.js';

const RUNTIME_IDENTITY_PATH = '/.well-known/1mcp/runtime-identity';

export interface RuntimeIdentityFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type RuntimeIdentityFetch = (
  url: string,
  init: {
    method: 'GET';
    headers: { Accept: 'application/json' };
    credentials: 'omit';
  },
) => Promise<RuntimeIdentityFetchResponse>;

export interface RuntimeIdentityWarning {
  code: 'warning_external_url_mismatch';
  message: string;
}

export interface VerifiedRuntimeIdentity {
  identity: RuntimeTargetObservedIdentity;
  warnings: RuntimeIdentityWarning[];
}

export class RuntimeTargetIdentityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoveryCommand?: string,
  ) {
    super(message);
    this.name = 'RuntimeTargetIdentityError';
  }
}

export async function fetchRuntimeIdentity(
  baseUrl: string,
  options: { fetch?: RuntimeIdentityFetch } = {},
): Promise<RuntimeTargetObservedIdentity> {
  const fetchImpl = options.fetch ?? defaultFetch;
  const response = await fetchImpl(new URL(RUNTIME_IDENTITY_PATH, baseUrl).toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });

  if (!response.ok) {
    throw new RuntimeTargetIdentityError(
      'identity_unreachable',
      `Runtime identity endpoint returned HTTP ${response.status}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RuntimeTargetIdentityError('identity_invalid', 'Runtime identity endpoint did not return JSON');
  }
  return parseRuntimeIdentity(body);
}

export async function verifyRuntimeIdentityForTarget(input: {
  target: Pick<StoredRuntimeTarget, 'name' | 'url' | 'observedIdentity'>;
  fetch?: RuntimeIdentityFetch;
}): Promise<VerifiedRuntimeIdentity> {
  const identity = await fetchRuntimeIdentity(input.target.url, { fetch: input.fetch });
  const expectedRuntimeScopeId = input.target.observedIdentity?.runtimeScopeId;

  if (expectedRuntimeScopeId && expectedRuntimeScopeId !== identity.runtimeScopeId) {
    throw new RuntimeTargetIdentityError(
      'identity_runtime_scope_mismatch',
      'Runtime target identity changed; refusing to use stored credentials',
      `1mcp target add ${input.target.name} ${input.target.url} --replace --accept-new-identity`,
    );
  }

  return {
    identity,
    warnings: externalUrlWarnings(input.target.url, identity),
  };
}

export async function verifyNamedRemoteTargetAttachment(input: {
  target: Pick<StoredRuntimeTarget, 'name' | 'url' | 'observedIdentity'>;
  fetch?: RuntimeIdentityFetch;
  onCredentialUseReady?: (identity: RuntimeTargetObservedIdentity) => void;
}): Promise<VerifiedRuntimeIdentity> {
  const result = await verifyRuntimeIdentityForTarget({ target: input.target, fetch: input.fetch });
  input.onCredentialUseReady?.(result.identity);
  return result;
}

async function defaultFetch(
  url: string,
  init: Parameters<RuntimeIdentityFetch>[1],
): Promise<RuntimeIdentityFetchResponse> {
  if (typeof globalThis.fetch !== 'function') {
    throw new RuntimeTargetIdentityError('identity_fetch_unavailable', 'No fetch implementation is available');
  }
  return (await globalThis.fetch(url, init)) as RuntimeIdentityFetchResponse;
}

function parseRuntimeIdentity(body: unknown): RuntimeTargetObservedIdentity {
  if (!isRecord(body)) {
    throw new RuntimeTargetIdentityError('identity_invalid', 'Runtime identity response must be an object');
  }

  const identity = {
    identityProtocolVersion: body.identityProtocolVersion,
    runtimeScopeId: body.runtimeScopeId,
    externalUrl: body.externalUrl,
    runtimeVersion: body.runtimeVersion,
    serverTime: body.serverTime,
  };

  if (
    identity.identityProtocolVersion !== '1' ||
    typeof identity.runtimeScopeId !== 'string' ||
    identity.runtimeScopeId.length === 0 ||
    typeof identity.externalUrl !== 'string' ||
    identity.externalUrl.length === 0 ||
    typeof identity.runtimeVersion !== 'string' ||
    identity.runtimeVersion.length === 0
  ) {
    throw new RuntimeTargetIdentityError('identity_invalid', 'Runtime identity response is missing required fields');
  }

  return {
    identityProtocolVersion: '1',
    runtimeScopeId: identity.runtimeScopeId,
    externalUrl: identity.externalUrl,
    runtimeVersion: identity.runtimeVersion,
    serverTime: typeof identity.serverTime === 'string' ? identity.serverTime : undefined,
  };
}

function externalUrlWarnings(configuredUrl: string, identity: RuntimeTargetObservedIdentity): RuntimeIdentityWarning[] {
  return configuredUrl.replace(/\/$/, '') === identity.externalUrl.replace(/\/$/, '')
    ? []
    : [
        {
          code: 'warning_external_url_mismatch',
          message: `Runtime identity externalUrl "${identity.externalUrl}" differs from configured URL "${configuredUrl}"`,
        },
      ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
