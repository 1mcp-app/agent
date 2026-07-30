import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { AuthProviderTransport } from '@src/core/types/index.js';

import type { TransportRecreationState } from './transportRecreationState.js';

export interface RecreateHttpTransportOptions {
  /**
   * Whether to carry the existing `sessionId` over to the new transport.
   *
   * Defaults to `true`, which is correct for OAuth retries (the session itself
   * is still valid; only auth needs refreshing). Callers recovering from a
   * server-invalidated session (e.g. the backend restarted and lost its
   * in-memory session store) must pass `false` so the new transport performs
   * a full `initialize` handshake and is issued a fresh session ID, instead of
   * immediately failing again with the same stale one.
   */
  preserveSessionId?: boolean;
}

export class TransportRecreator {
  public recreateForRetry(transport: AuthProviderTransport, serverName?: string): AuthProviderTransport {
    if (this.isHttpTransport(transport)) {
      return this.recreateHttpTransport(transport, serverName);
    }

    return transport;
  }

  /**
   * Recreates a transport whose backend session was lost (server restarted or
   * otherwise invalidated the session ID). Unlike {@link recreateForRetry},
   * this never carries the old session ID forward.
   */
  public recreateForSessionLoss(transport: AuthProviderTransport, serverName?: string): AuthProviderTransport {
    return this.recreateHttpTransport(transport, serverName, { preserveSessionId: false });
  }

  public recreateHttpTransport(
    transport: AuthProviderTransport,
    serverName?: string,
    options?: RecreateHttpTransportOptions,
  ): AuthProviderTransport {
    if (!this.isHttpTransport(transport)) {
      const name = serverName ? `Transport for ${serverName}` : 'Transport';
      throw new Error(`${name} does not support OAuth (requires HTTP or SSE transport)`);
    }

    const preserveSessionId = options?.preserveSessionId ?? true;
    const state = transport as unknown as TransportRecreationState;
    const authTransport = transport as AuthProviderTransport;
    const oauthProvider = authTransport.oauthProvider;

    const newTransport: AuthProviderTransport =
      transport instanceof StreamableHTTPClientTransport
        ? (new StreamableHTTPClientTransport(state._url, {
            authProvider: oauthProvider,
            requestInit: state._requestInit,
            fetch: state._fetch,
            reconnectionOptions: state._reconnectionOptions,
            sessionId: preserveSessionId ? state._sessionId : undefined,
          }) as AuthProviderTransport)
        : (new SSEClientTransport(state._url, {
            authProvider: oauthProvider,
            requestInit: state._requestInit,
            fetch: state._fetch,
            eventSourceInit: state._eventSourceInit,
          }) as AuthProviderTransport);

    newTransport.oauthProvider = oauthProvider;
    newTransport.connectionTimeout = authTransport.connectionTimeout;
    newTransport.requestTimeout = authTransport.requestTimeout;
    newTransport.timeout = authTransport.timeout;
    newTransport.tags = authTransport.tags;

    return newTransport;
  }

  private isHttpTransport(transport: AuthProviderTransport): boolean {
    return transport instanceof StreamableHTTPClientTransport || transport instanceof SSEClientTransport;
  }
}
