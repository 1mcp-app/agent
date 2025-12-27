import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { AuthProviderTransport } from '@src/core/types/index.js';

interface TransportWithUrl {
  _url: URL;
}

export class TransportRecreator {
  public recreateHttpTransport(transport: AuthProviderTransport, serverName?: string): AuthProviderTransport {
    if (!(transport instanceof StreamableHTTPClientTransport) && !(transport instanceof SSEClientTransport)) {
      const name = serverName ? `Transport for ${serverName}` : 'Transport';
      throw new Error(`${name} does not support OAuth (requires HTTP or SSE transport)`);
    }

    const transportUrl = (transport as unknown as TransportWithUrl)._url;
    const authTransport = transport as AuthProviderTransport;
    const oauthProvider = authTransport.oauthProvider;

    const newTransport: AuthProviderTransport =
      transport instanceof StreamableHTTPClientTransport
        ? (new StreamableHTTPClientTransport(transportUrl, { authProvider: oauthProvider }) as AuthProviderTransport)
        : (new SSEClientTransport(transportUrl, { authProvider: oauthProvider }) as AuthProviderTransport);

    newTransport.oauthProvider = oauthProvider;
    newTransport.connectionTimeout = authTransport.connectionTimeout;
    newTransport.requestTimeout = authTransport.requestTimeout;
    newTransport.timeout = authTransport.timeout;
    newTransport.tags = authTransport.tags;

    return newTransport;
  }
}
