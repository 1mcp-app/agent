import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import type { AuthProviderTransport } from '@src/core/types/index.js';

export interface ConnectedClient {
  readonly client: Client;
  readonly transport: AuthProviderTransport;
}
