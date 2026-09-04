import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js';
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface TransportRecreationState {
  readonly _url: URL;
  readonly _requestInit?: RequestInit;
  readonly _fetch?: StreamableHTTPClientTransportOptions['fetch'];
  readonly _reconnectionOptions?: StreamableHTTPClientTransportOptions['reconnectionOptions'];
  readonly _sessionId?: string;
  readonly _eventSourceInit?: SSEClientTransportOptions['eventSourceInit'];
}
