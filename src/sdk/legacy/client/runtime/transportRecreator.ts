import {
  SSEClientTransport as ModernSSEClientTransport,
  StreamableHTTPClientTransport as ModernStreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { AuthProviderTransport } from './legacyTransport.js';
import type { RecreateHttpTransportOptions } from './recreateHttpTransportOptions.js';
import type { TransportRecreationState } from './transportRecreationState.js';

export class TransportRecreator {
  public recreateForRetry(transport: AuthProviderTransport, serverName?: string): AuthProviderTransport {
    if (transport.recreate) {
      return transport.recreate();
    }
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
    if (transport.recreate) {
      return transport.recreate({ preserveSessionId: false });
    }
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

    if (transport.recreate) {
      return transport.recreate(options);
    }

    const preserveSessionId = options?.preserveSessionId ?? true;
    const state = transport as unknown as TransportRecreationState;
    const authTransport = transport as AuthProviderTransport;
    const oauthProvider = authTransport.oauthProvider;

    let newTransport: AuthProviderTransport;
    if (transport instanceof ModernStreamableHTTPClientTransport) {
      newTransport = new ModernStreamableHTTPClientTransport(state._url, {
        authProvider: oauthProvider as never,
        requestInit: state._requestInit,
        fetch: state._fetch as never,
        reconnectionOptions: state._reconnectionOptions,
        reconnectionScheduler: state._reconnectionScheduler,
        sessionId: preserveSessionId ? state._sessionId : undefined,
        protocolVersion: state._protocolVersion,
      }) as AuthProviderTransport;
    } else if (transport instanceof ModernSSEClientTransport) {
      newTransport = new ModernSSEClientTransport(state._url, {
        authProvider: oauthProvider as never,
        requestInit: state._requestInit,
        fetch: state._fetch as never,
        eventSourceInit: state._eventSourceInit as never,
      }) as AuthProviderTransport;
    } else {
      newTransport =
        transport instanceof StreamableHTTPClientTransport
          ? (new StreamableHTTPClientTransport(state._url, {
              authProvider: oauthProvider,
              requestInit: state._requestInit,
              fetch: state._fetch as never,
              reconnectionOptions: state._reconnectionOptions as never,
              sessionId: preserveSessionId ? state._sessionId : undefined,
            }) as AuthProviderTransport)
          : (new SSEClientTransport(state._url, {
              authProvider: oauthProvider,
              requestInit: state._requestInit,
              fetch: state._fetch as never,
              eventSourceInit: state._eventSourceInit as never,
            }) as AuthProviderTransport);
    }

    newTransport.oauthProvider = oauthProvider;
    newTransport.connectionTimeout = authTransport.connectionTimeout;
    newTransport.requestTimeout = authTransport.requestTimeout;
    newTransport.timeout = authTransport.timeout;
    newTransport.tags = authTransport.tags;
    newTransport.outboundProtocolVersion = authTransport.outboundProtocolVersion;

    return newTransport;
  }

  private isHttpTransport(transport: AuthProviderTransport): boolean {
    return (
      transport instanceof StreamableHTTPClientTransport ||
      transport instanceof SSEClientTransport ||
      transport instanceof ModernStreamableHTTPClientTransport ||
      transport instanceof ModernSSEClientTransport
    );
  }
}
