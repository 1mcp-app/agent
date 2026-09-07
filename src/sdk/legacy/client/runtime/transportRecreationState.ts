import type {
  SSEClientTransportOptions as ModernSSEClientTransportOptions,
  StreamableHTTPClientTransportOptions as ModernStreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/client';

import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js';
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface TransportRecreationState {
  readonly _url: URL;
  readonly _requestInit?: RequestInit;
  readonly _fetch?: StreamableHTTPClientTransportOptions['fetch'] | ModernStreamableHTTPClientTransportOptions['fetch'];
  readonly _reconnectionOptions?:
    | StreamableHTTPClientTransportOptions['reconnectionOptions']
    | ModernStreamableHTTPClientTransportOptions['reconnectionOptions'];
  readonly _reconnectionScheduler?: ModernStreamableHTTPClientTransportOptions['reconnectionScheduler'];
  readonly _sessionId?: string;
  readonly _protocolVersion?: string;
  readonly _eventSourceInit?:
    SSEClientTransportOptions['eventSourceInit'] | ModernSSEClientTransportOptions['eventSourceInit'];
}
