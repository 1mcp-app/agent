import {
  computeScopeUnion,
  isStrictScopeSuperset,
  auth as modernAuth,
  type OAuthClientProvider as ModernProvider,
  UnauthorizedError as ModernUnauthorizedError,
  SdkErrorCode,
  SdkHttpError,
} from '@modelcontextprotocol/client';

import {
  extractWWWAuthenticateParams,
  auth as legacyAuth,
  UnauthorizedError,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { SDKOAuthClientProvider } from './sdkOAuthClientProvider.js';

interface AuthorizationOptions {
  serverUrl: string | URL;
  authorizationCode?: string;
  iss?: string;
  resourceMetadataUrl?: URL;
  scope?: string;
  forceReauthorization?: boolean;
}

/** Keep SDK retries inside the authority owner, independent of transport instances. */
export function authorizeUpstream(provider: SDKOAuthClientProvider, legacy: boolean, options: AuthorizationOptions) {
  return provider.authorize(
    () => {
      const pending = provider.getPendingAuthorizationUrl();
      const pendingScope = pending ? (new URL(pending).searchParams.get('scope') ?? undefined) : undefined;
      const scope = legacy ? options.scope : computeScopeUnion(provider.tokens()?.scope, pendingScope, options.scope);
      const request = { ...options, scope, fetchFn: provider.fetch };
      return legacy ? legacyAuth(provider, request) : modernAuth(provider as ModernProvider, request);
    },
    options.authorizationCode !== undefined,
    { scope: options.scope, forceReauthorization: options.forceReauthorization },
  );
}

/** SDK transports delegate auth to this boundary so npm and SEA use the same owner. */
export function createCoordinatedOAuthFetch(
  provider: SDKOAuthClientProvider,
  legacy: boolean,
  serverUrl: string | URL,
): typeof fetch {
  return async (input, init) => {
    if (input instanceof Request) {
      const request = new Request(input, init);
      input = request.url;
      init = {
        ...init,
        method: request.method,
        headers: request.headers,
        signal: request.signal,
        body:
          request.method === 'GET' || request.method === 'HEAD'
            ? undefined
            : new Uint8Array(await request.arrayBuffer()),
      };
    }
    const original = input;
    const send = () => {
      const headers = new Headers(init?.headers);
      const token = provider.tokens()?.access_token;
      if (token) headers.set('authorization', `Bearer ${token}`);
      const credential = provider.credentialSnapshot();
      return provider.fetch(original, { ...init, headers }).then((response) => ({ response, credential }));
    };
    let dispatch = await send();
    let refreshes = 0;
    let stepUps = 0;
    let staleReplays = 0;
    for (;;) {
      const { response, credential } = dispatch;
      const challenge = extractWWWAuthenticateParams(response);
      const stepUp = response.status === 403 && challenge.error === 'insufficient_scope';
      if (response.status !== 401 && !stepUp) return response;
      await response.body?.cancel();
      if (response.status === 401) {
        const current = provider.credentialSnapshot();
        const superseded = current?.generation !== credential?.generation || current?.revision !== credential?.revision;
        if (superseded && staleReplays === 0) {
          staleReplays++;
          dispatch = await send();
          continue;
        }
        if (refreshes > 0) {
          await provider.invalidateRejectedTokens(credential);
          throw terminalAuthFailure(legacy, 401, 'Server returned 401 after successful authentication');
        }
        refreshes++;
      }
      if (stepUp) {
        if (stepUps > 0) throw terminalAuthFailure(legacy, 403, 'Server returned 403 after trying upscoping');
        stepUps++;
      }
      const scope = legacy ? challenge.scope : computeScopeUnion(provider.tokens()?.scope, challenge.scope);
      const authorization = authorizeUpstream(provider, legacy, {
        serverUrl,
        resourceMetadataUrl: challenge.resourceMetadataUrl,
        scope,
        forceReauthorization: !legacy && stepUp && isStrictScopeSuperset(scope, provider.tokens()?.scope),
      });
      const result = await waitForAuthorization(authorization, init?.signal);
      init?.signal?.throwIfAborted();
      if (result !== 'AUTHORIZED') throw authorizationRequired(legacy);
      dispatch = await send();
    }
  };
}

export function bindCoordinatedOAuthTransport(
  transport: { start(): Promise<void>; close(): Promise<void> },
  provider: SDKOAuthClientProvider,
  legacy: boolean,
  serverUrl: string | URL,
): void {
  const start = transport.start.bind(transport);
  Object.assign(transport, {
    start: async () => {
      try {
        await start();
      } catch (error) {
        // EventSource wraps fetch errors; preserve the domain outcome at the transport seam.
        if (!provider.getPendingAuthorizationUrl()) throw error;
        await transport.close();
        throw authorizationRequired(legacy);
      }
    },
    finishAuth: async (code: string | URLSearchParams, iss?: string) => {
      const authorizationCode = typeof code === 'string' ? code : (code.get('code') ?? undefined);
      if (!authorizationCode) throw new Error('Missing authorization code');
      const result = await authorizeUpstream(provider, legacy, {
        serverUrl,
        authorizationCode,
        iss: typeof code === 'string' ? iss : (code.get('iss') ?? undefined),
      });
      if (result !== 'AUTHORIZED') throw authorizationRequired(legacy);
    },
  });
}

async function waitForAuthorization<T>(operation: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return operation;
  signal.throwIfAborted();
  let abort!: () => void;
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([operation, stopped]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function authorizationRequired(legacy: boolean): Error {
  return legacy ? new UnauthorizedError() : new ModernUnauthorizedError();
}

function terminalAuthFailure(legacy: boolean, status: 401 | 403, message: string): Error {
  if (legacy) return new StreamableHTTPError(status, message);
  const code = status === 401 ? SdkErrorCode.ClientHttpAuthentication : SdkErrorCode.ClientHttpForbidden;
  return new SdkHttpError(code, message, { status, statusText: status === 401 ? 'Unauthorized' : 'Forbidden' });
}
