import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import type { AuthProviderTransport } from './legacyTransport.js';

export interface ConnectedClient {
  readonly client: Client;
  readonly transport: AuthProviderTransport;
}
